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
    await database.update(reminders).set({ notificationId: null }).where(eq(reminders.id, entityId));
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
  const rows = await database.select().from(attachments).where(eq(attachments.id, entityId)).limit(1);
  const attachment = rows[0];
  if (!attachment) return; // just deleted

  if (attachmentFileExists(attachment.storedPath)) return; // already have it locally

  const accessToken = getAccessToken();
  if (!accessToken) return; // shouldn't happen mid-pull, but never crash the pull over one file

  const { storedPath } = await saveDownloadedAttachment(
    attachment.taskId,
    attachment.id,
    attachment.originalFileName,
    `${SYNC_API_BASE_URL}/sync/attachments/${attachment.id}`,
    accessToken,
  );
  await database.update(attachments).set({ storedPath }).where(eq(attachments.id, entityId));
}

export async function pullChanges(database: Database = defaultDb): Promise<PullSummary> {
  let cursor = await getSyncCursor(database);
  let applied = 0;

  while (true) {
    const response = await authenticatedFetch(`/sync/pull?since=${cursor}`);
    const body: { operations: PulledOperation[]; cursor: number } = await response.json();

    for (const op of body.operations) {
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

      applied += 1;
    }

    cursor = body.cursor;
    await setSyncCursor(cursor, database);

    if (body.operations.length === 0) break;
  }

  return { applied };
}
