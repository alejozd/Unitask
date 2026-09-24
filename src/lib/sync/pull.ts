import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { getSyncCursor, setSyncCursor } from "@/db/repositories/settings";
import { tasks } from "@/db/schema/task";
import { subjects } from "@/db/schema/subject";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import {
  scheduleReminderNotification,
  cancelReminderNotification,
  requestNotificationPermission,
} from "@/lib/notifications";
import { saveDownloadedAttachment, attachmentFileExists } from "@/lib/files";
import { applyUpsert, applyDelete } from "./serializers";
import { authenticatedFetch, getAccessToken, SYNC_API_BASE_URL } from "./client";

export interface PullSummary {
  applied: number;
}

interface PulledOperation {
  table: string;
  entityId: string;
  operation: "upsert" | "delete";
  payload: Record<string, unknown> | null;
  clientUpdatedAt: number;
}

async function applyReminderSideEffects(
  entityId: string,
  previousNotificationId: string | null,
  database: Database,
): Promise<void> {
  if (previousNotificationId) {
    await cancelReminderNotification(previousNotificationId);
  }

  const rows = await database.select().from(reminders).where(eq(reminders.id, entityId)).limit(1);
  const reminder = rows[0];
  if (!reminder) return; // just deleted, nothing left to (re)schedule

  if (reminder.computedFireAt.getTime() <= Date.now()) {
    await database
      .update(reminders)
      .set({ notificationId: null })
      .where(eq(reminders.id, entityId));
    return;
  }

  const taskRows = await database
    .select({ title: tasks.title, subjectId: tasks.subjectId, dueDateTime: tasks.dueDateTime })
    .from(tasks)
    .where(eq(tasks.id, reminder.taskId))
    .limit(1);
  const task = taskRows[0];
  if (!task) return;

  const subjectRows = await database
    .select({ name: subjects.name })
    .from(subjects)
    .where(eq(subjects.id, task.subjectId))
    .limit(1);

  const permission = await requestNotificationPermission();
  let notificationId: string | null = null;
  if (permission.granted) {
    notificationId = await scheduleReminderNotification(reminder.computedFireAt, {
      taskTitle: task.title,
      subjectName: subjectRows[0]?.name ?? "",
      dueDateTime: task.dueDateTime,
    });
  }
  await database.update(reminders).set({ notificationId }).where(eq(reminders.id, entityId));
}

async function applyAttachmentSideEffects(entityId: string, database: Database): Promise<void> {
  const rows = await database
    .select()
    .from(attachments)
    .where(eq(attachments.id, entityId))
    .limit(1);
  const attachment = rows[0];
  if (!attachment) return; // just deleted

  if (attachmentFileExists(attachment.storedPath)) return; // already have it locally

  const accessToken = getAccessToken();
  if (!accessToken) return; // shouldn't happen mid-pull, but never crash the pull over one file

  try {
    const { storedPath } = await saveDownloadedAttachment(
      attachment.taskId,
      attachment.id,
      attachment.originalFileName,
      `${SYNC_API_BASE_URL}/sync/attachments/${attachment.id}`,
      accessToken,
    );
    await database.update(attachments).set({ storedPath }).where(eq(attachments.id, entityId));
  } catch {
    // Best-effort, same philosophy as push.ts's uploadPendingAttachmentFiles:
    // one attachment's file being unavailable (a 404 — e.g. the source
    // device's own upload never actually succeeded — or a network hiccup)
    // must never abort the whole pull. The row's storedPath is left as
    // whatever the payload set it to; the local file simply doesn't exist
    // yet, and the next pull retries the same download attempt.
  }
}

async function applyOperation(op: PulledOperation, database: Database): Promise<void> {
  // Must be read BEFORE applying the operation — applyUpsert overwrites
  // the row (including notificationId) with the incoming payload, and
  // applyDelete removes it outright, so this is the only chance to know
  // what OS notification (if any) needs cancelling.
  let previousReminderNotificationId: string | null = null;
  if (op.table === "reminders") {
    const existing = await database
      .select({ notificationId: reminders.notificationId })
      .from(reminders)
      .where(eq(reminders.id, op.entityId))
      .limit(1);
    previousReminderNotificationId = existing[0]?.notificationId ?? null;
  }

  if (op.operation === "delete") {
    await applyDelete(op.table, op.entityId, database);
  } else {
    await applyUpsert(op.table, op.entityId, op.payload, database);
  }

  if (op.table === "reminders") {
    await applyReminderSideEffects(op.entityId, previousReminderNotificationId, database);
  }
  if (op.table === "attachments" && op.operation === "upsert") {
    await applyAttachmentSideEffects(op.entityId, database);
  }
}

export async function pullChanges(database: Database = defaultDb): Promise<PullSummary> {
  let cursor = await getSyncCursor(database);
  let applied = 0;

  while (true) {
    const response = await authenticatedFetch(`/sync/pull?since=${cursor}`);
    const body: { operations: PulledOperation[]; cursor: number } = await response.json();

    // Operations SHOULD arrive in an order that respects foreign-key
    // dependencies (parent before child) — task.ts's own repository hooks
    // guarantee this for anything pushed going forward. But data pushed by
    // an older, buggy build can already sit on the server out of order
    // (e.g. a reminder with a lower serverSeq than its own task), and every
    // future pull of that historical page would otherwise fail forever.
    // Retry whatever fails in a fixed-point loop — each pass either makes
    // progress (something that depended on an operation applied earlier in
    // THIS pass now succeeds) or it doesn't, in which case the remaining
    // failures are genuinely unresolvable within this page (not just
    // out of order) and are skipped rather than retried forever.
    let pending = body.operations;
    while (pending.length > 0) {
      const stillFailing: PulledOperation[] = [];
      for (const op of pending) {
        try {
          await applyOperation(op, database);
          applied += 1;
        } catch {
          stillFailing.push(op);
        }
      }
      if (stillFailing.length === pending.length) break; // no progress this pass
      pending = stillFailing;
    }

    cursor = body.cursor;
    await setSyncCursor(cursor, database);

    if (body.operations.length === 0) break;
  }

  return { applied };
}
