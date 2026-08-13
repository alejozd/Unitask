import { randomUUID } from "expo-crypto";
import { and, eq, isNotNull } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import { assertTaskEditable } from "@/db/repositories/task-access";
import type { Database } from "@/db/repositories/semester";
import { reminders, type Reminder } from "@/db/schema/reminder";
import { subjects } from "@/db/schema/subject";
import {
  cancelReminderNotification,
  requestNotificationPermission,
  scheduleReminderNotification,
} from "@/lib/notifications";
import {
  computeFireAt,
  rescheduleOnDueDateChange,
  type ReminderOffsetUnit,
  type ReminderSpec,
} from "@/domain/reminder-scheduling";

async function getTaskContext(taskId: string, database: Database) {
  const task = await assertTaskEditable(taskId, database);
  const subjectRows = await database
    .select({ name: subjects.name })
    .from(subjects)
    .where(eq(subjects.id, task.subjectId))
    .limit(1);
  return { task, subjectName: subjectRows[0]?.name ?? "" };
}

async function getReminderOrThrow(id: string, database: Database) {
  const rows = await database.select().from(reminders).where(eq(reminders.id, id)).limit(1);
  const reminder = rows[0];
  if (!reminder) throw new Error(`Reminder not found: ${id}`);
  return reminder;
}

export function toReminderSpec(reminder: Reminder): ReminderSpec {
  if (reminder.kind === "fixed") {
    return { kind: "fixed", fixedDateTime: reminder.fixedDateTime as Date };
  }
  return {
    kind: "relative",
    offsetValue: reminder.offsetValue as number,
    offsetUnit: reminder.offsetUnit as ReminderOffsetUnit,
  };
}

export async function addReminder(
  taskId: string,
  spec: ReminderSpec,
  database: Database = defaultDb,
): Promise<Reminder> {
  const { task, subjectName } = await getTaskContext(taskId, database);
  const computedFireAt = computeFireAt(spec, task.dueDateTime);

  let notificationId: string | null = null;
  if (computedFireAt.getTime() > Date.now()) {
    const permission = await requestNotificationPermission();
    if (permission.granted) {
      notificationId = await scheduleReminderNotification(computedFireAt, {
        taskTitle: task.title,
        subjectName,
        dueDateTime: task.dueDateTime,
      });
    }
  }

  const newReminder: typeof reminders.$inferInsert = {
    id: randomUUID(),
    taskId,
    kind: spec.kind,
    offsetValue: spec.kind === "relative" ? spec.offsetValue : null,
    offsetUnit: spec.kind === "relative" ? spec.offsetUnit : null,
    fixedDateTime: spec.kind === "fixed" ? spec.fixedDateTime : null,
    computedFireAt,
    notificationId,
    createdAt: new Date(),
  };
  await database.insert(reminders).values(newReminder);
  return newReminder as Reminder;
}

export async function removeReminder(id: string, database: Database = defaultDb): Promise<void> {
  const reminder = await getReminderOrThrow(id, database);
  await assertTaskEditable(reminder.taskId, database);

  if (reminder.notificationId) {
    await cancelReminderNotification(reminder.notificationId);
  }
  await database.delete(reminders).where(eq(reminders.id, id));
}

/**
 * Cancels every still-pending (notificationId set) reminder's OS
 * notification for a task and clears notificationId, WITHOUT deleting the
 * rows. Used by task completion (03-business-rules.md §5) and task
 * deletion (§6) — for deletion, the rows themselves are removed a moment
 * later by ON DELETE CASCADE when the task row is deleted, so this
 * function's job there is only the OS-side cancellation.
 */
export async function cancelAllRemindersForTask(
  taskId: string,
  database: Database = defaultDb,
): Promise<void> {
  await assertTaskEditable(taskId, database);

  const pending = await database
    .select()
    .from(reminders)
    .where(and(eq(reminders.taskId, taskId), isNotNull(reminders.notificationId)));

  for (const reminder of pending) {
    await cancelReminderNotification(reminder.notificationId as string);
    await database
      .update(reminders)
      .set({ notificationId: null })
      .where(eq(reminders.id, reminder.id));
  }
}

export interface RescheduleResult {
  removedCount: number;
}

/**
 * Applies 03-business-rules.md §7's due-date-edit rule to every still-
 * pending reminder attached to a task, using the domain's pure
 * `rescheduleOnDueDateChange` for the decision logic. A "keep" action
 * always cancels the old notification and schedules a fresh one — even
 * for a fixed reminder whose fire time didn't actually change — rather
 * than diffing old vs. new fire time to skip a no-op reschedule. Simpler,
 * and the extra cancel+reschedule pair is cheap; not worth the added
 * complexity for this app's scale.
 */
export async function rescheduleRemindersForTask(
  taskId: string,
  newDueDateTime: Date,
  database: Database = defaultDb,
): Promise<RescheduleResult> {
  const { task, subjectName } = await getTaskContext(taskId, database);

  const pending = await database
    .select()
    .from(reminders)
    .where(and(eq(reminders.taskId, taskId), isNotNull(reminders.notificationId)));

  const now = new Date();
  const actions = rescheduleOnDueDateChange(
    pending.map((r) => ({
      id: r.id,
      spec: toReminderSpec(r),
      hasFired: r.computedFireAt.getTime() <= now.getTime(),
    })),
    newDueDateTime,
    now,
  );

  // Permission status doesn't change mid-loop, so request it once up front
  // instead of once per "keep" action.
  const permission = await requestNotificationPermission();

  let removedCount = 0;
  for (const action of actions) {
    const reminder = pending.find((r) => r.id === action.id);
    if (!reminder) continue;

    if (action.action === "remove") {
      if (reminder.notificationId) {
        await cancelReminderNotification(reminder.notificationId);
      }
      await database.delete(reminders).where(eq(reminders.id, reminder.id));
      removedCount += 1;
      continue;
    }

    if (action.action === "keep") {
      if (reminder.notificationId) {
        await cancelReminderNotification(reminder.notificationId);
      }
      let newNotificationId: string | null = null;
      if (permission.granted) {
        newNotificationId = await scheduleReminderNotification(action.newFireAt, {
          taskTitle: task.title,
          subjectName,
          dueDateTime: newDueDateTime,
        });
      }
      await database
        .update(reminders)
        .set({ computedFireAt: action.newFireAt, notificationId: newNotificationId })
        .where(eq(reminders.id, reminder.id));
    }
    // "unchanged" appears for reminders whose computedFireAt is already in
    // the past (already fired, but never reconciled since there is no
    // notification-received listener yet) — left untouched, matching the
    // domain function's contract.
  }

  return { removedCount };
}
