import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { db as defaultDb } from "@/db/client";
import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import { settings } from "@/db/schema/settings";
import {
  cancelReminderNotification,
  requestNotificationPermission,
  scheduleReminderNotification,
} from "@/lib/notifications";
import { serializeBackup, type BackupTables } from "@/domain/backup";

export type Database = BaseSQLiteDatabase<"async" | "sync", unknown, typeof schema>;

/** Reads every row of every table — the export side is pure reads, no writes. */
async function readAllTables(database: Database): Promise<BackupTables> {
  return {
    semesters: await database.select().from(semesters),
    subjects: await database.select().from(subjects),
    tasks: await database.select().from(tasks),
    subtasks: await database.select().from(subtasks),
    reminders: await database.select().from(reminders),
    attachments: await database.select().from(attachments),
    settings: await database.select().from(settings),
  };
}

/** Pretty-printed per this plan's Global Constraints — human-inspectable. */
export async function exportBackupJson(database: Database = defaultDb): Promise<string> {
  const tables = await readAllTables(database);
  return JSON.stringify(serializeBackup(tables), null, 2);
}

export interface ImportResult {
  remindersScheduled: number;
  remindersUnscheduled: number;
}

/**
 * Full-replace import (03-business-rules.md §14 / 04-user-flows.md flow 7):
 * cancels every currently-scheduled OS notification, wipes all 7 tables,
 * inserts every imported row verbatim (original ids/timestamps preserved —
 * a true replace, not an id-regenerating import), then reschedules a fresh
 * OS notification for every imported reminder still due in the future.
 * Deliberately bypasses assertTaskEditable/closed-semester enforcement for
 * every table (docs/superpowers/plans/2026-08-17-phase9-settings-export-import.md's
 * Global Constraints) — import is a full-system replace, not a per-entity
 * edit, so a backup taken while a semester was closed must still restore
 * that semester's tasks correctly.
 */
export async function importBackup(
  tables: BackupTables,
  database: Database = defaultDb,
): Promise<ImportResult> {
  // Cancel existing notifications BEFORE the wipe — must be a separate async
  // pass; the transaction callback below must stay synchronous (see
  // semester.ts's identical note on this constraint).
  const existingReminders = await database
    .select({ notificationId: reminders.notificationId })
    .from(reminders);
  for (const { notificationId } of existingReminders) {
    if (notificationId) {
      await cancelReminderNotification(notificationId);
    }
  }

  // Child-to-parent delete order, parent-to-child insert order — explicit,
  // not relying on ON DELETE CASCADE quirks for a full-table wipe.
  // Imported reminders are inserted with notificationId forced to null —
  // the real value is never trustworthy across devices/reinstalls.
  await database.transaction((tx) => {
    tx.delete(attachments).run();
    tx.delete(reminders).run();
    tx.delete(subtasks).run();
    tx.delete(tasks).run();
    tx.delete(subjects).run();
    tx.delete(semesters).run();
    tx.delete(settings).run();

    if (tables.semesters.length > 0) tx.insert(semesters).values(tables.semesters).run();
    if (tables.subjects.length > 0) tx.insert(subjects).values(tables.subjects).run();
    if (tables.tasks.length > 0) tx.insert(tasks).values(tables.tasks).run();
    if (tables.subtasks.length > 0) tx.insert(subtasks).values(tables.subtasks).run();
    if (tables.reminders.length > 0) {
      tx.insert(reminders)
        .values(tables.reminders.map((r) => ({ ...r, notificationId: null })))
        .run();
    }
    if (tables.attachments.length > 0) tx.insert(attachments).values(tables.attachments).run();
    if (tables.settings.length > 0) tx.insert(settings).values(tables.settings).run();
  });

  // Reschedule fresh notifications for every still-future reminder.
  const permission = await requestNotificationPermission();
  let remindersScheduled = 0;
  let remindersUnscheduled = 0;
  const now = Date.now();
  for (const reminder of tables.reminders) {
    if (reminder.computedFireAt.getTime() <= now) continue; // already due/past — leave unscheduled

    if (!permission.granted) {
      remindersUnscheduled += 1;
      continue;
    }

    const task = tables.tasks.find((t) => t.id === reminder.taskId);
    const subject = task ? tables.subjects.find((s) => s.id === task.subjectId) : undefined;
    const notificationId = await scheduleReminderNotification(reminder.computedFireAt, {
      taskTitle: task?.title ?? "",
      subjectName: subject?.name ?? "",
      dueDateTime: task?.dueDateTime ?? reminder.computedFireAt,
    });
    await database.update(reminders).set({ notificationId }).where(eq(reminders.id, reminder.id));
    remindersScheduled += 1;
  }

  return { remindersScheduled, remindersUnscheduled };
}
