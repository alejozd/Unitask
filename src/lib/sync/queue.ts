import { and, eq, inArray } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { syncLog, type SyncLogEntry } from "@/db/schema/sync-log";
import { subtasks } from "@/db/schema/subtask";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";

/**
 * Every domain table's `updatedAt` was added as nullable (Task 1's schema
 * migration, per the Phase C plan's Global Constraints — SQLite can't add a
 * NOT NULL column to a non-empty table). A row from before this phase, or
 * one whose write path hasn't been touched yet, may have neither timestamp.
 */
export function resolveSyncTimestamp(row: {
  updatedAt: Date | null;
  createdAt: Date | null;
}): Date {
  return row.updatedAt ?? row.createdAt ?? new Date();
}

export async function enqueueChange(
  table: string,
  entityId: string,
  operation: "upsert" | "delete",
  database: Database = defaultDb,
): Promise<void> {
  await database
    .insert(syncLog)
    .values({ entityTable: table, entityId, operation, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [syncLog.entityTable, syncLog.entityId],
      set: { operation, updatedAt: new Date() },
    });
}

/**
 * A subject/task delete cascades to subtasks/reminders/attachments via
 * ON DELETE CASCADE at the SQLite level — invisible to the sync outbox
 * unless walked explicitly. Reads the current children BEFORE the caller
 * performs the actual delete (the rows must still exist to enumerate).
 */
export async function enqueueCascadeDeleteForTask(
  taskId: string,
  database: Database = defaultDb,
): Promise<void> {
  const [subtaskRows, reminderRows, attachmentRows] = await Promise.all([
    database.select({ id: subtasks.id }).from(subtasks).where(eq(subtasks.taskId, taskId)),
    database.select({ id: reminders.id }).from(reminders).where(eq(reminders.taskId, taskId)),
    database.select({ id: attachments.id }).from(attachments).where(eq(attachments.taskId, taskId)),
  ]);

  for (const { id } of subtaskRows) {
    await enqueueChange("subtasks", id, "delete", database);
  }
  for (const { id } of reminderRows) {
    await enqueueChange("reminders", id, "delete", database);
  }
  for (const { id } of attachmentRows) {
    await enqueueChange("attachments", id, "delete", database);
  }
  await enqueueChange("tasks", taskId, "delete", database);
}

export async function getPendingChanges(database: Database = defaultDb): Promise<SyncLogEntry[]> {
  return database.select().from(syncLog);
}

export async function clearPendingChanges(
  keys: string[],
  database: Database = defaultDb,
): Promise<void> {
  if (keys.length === 0) return;
  const pairs = keys.map((key) => {
    const separatorIndex = key.indexOf(":");
    return { table: key.slice(0, separatorIndex), entityId: key.slice(separatorIndex + 1) };
  });
  const byTable = new Map<string, string[]>();
  for (const { table, entityId } of pairs) {
    byTable.set(table, [...(byTable.get(table) ?? []), entityId]);
  }
  for (const [table, entityIds] of byTable) {
    await database
      .delete(syncLog)
      .where(and(inArray(syncLog.entityId, entityIds), eq(syncLog.entityTable, table)));
  }
}
