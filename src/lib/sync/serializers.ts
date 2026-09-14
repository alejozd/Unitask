import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import { resolveSyncTimestamp } from "./queue";

export const SYNCED_TABLES = [
  "semesters",
  "subjects",
  "tasks",
  "subtasks",
  "reminders",
  "attachments",
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

// Every table here has date-typed columns that must round-trip through JSON
// as ISO strings (server payload is `unknown` JSONB — see the design spec)
// and back into real `Date` objects for SQLite. JSON.stringify already
// handles the Date->string direction for free (buildPayload needs no
// special handling); only the incoming direction (applyUpsert) needs a
// manual parse, driven by this table.
const DATE_FIELDS_BY_TABLE: Record<SyncedTable, string[]> = {
  semesters: ["createdAt", "closedAt", "updatedAt"],
  subjects: ["createdAt", "updatedAt"],
  tasks: ["dueDateTime", "completedAt", "createdAt", "updatedAt"],
  subtasks: ["createdAt", "updatedAt"],
  reminders: ["fixedDateTime", "computedFireAt", "createdAt", "updatedAt"],
  attachments: ["createdAt", "updatedAt", "syncedAt"],
};

const TABLES = {
  semesters,
  subjects,
  tasks,
  subtasks,
  reminders,
  attachments,
} as const;

function tableFor(table: string) {
  const found = (TABLES as Record<string, (typeof TABLES)[SyncedTable]>)[table];
  if (!found) throw new Error(`Unknown synced table: ${table}`);
  return found;
}

function parseDates(table: SyncedTable, payload: Record<string, unknown>): Record<string, unknown> {
  const result = { ...payload };
  for (const field of DATE_FIELDS_BY_TABLE[table]) {
    const value = result[field];
    if (typeof value === "string") {
      result[field] = new Date(value);
    }
  }
  return result;
}

export async function buildPayload(
  table: SyncedTable,
  entityId: string,
  database: Database = defaultDb,
): Promise<{ payload: unknown; clientUpdatedAt: number } | null> {
  const schemaTable = tableFor(table);
  const rows = await database
    .select()
    .from(schemaTable as any)
    .where(eq((schemaTable as any).id, entityId))
    .limit(1);
  const row = rows[0] as
    (Record<string, unknown> & { updatedAt: Date | null; createdAt: Date | null }) | undefined;
  if (!row) return null;

  const clientUpdatedAt = resolveSyncTimestamp(row).getTime();
  return { payload: row, clientUpdatedAt };
}

export async function applyUpsert(
  table: string,
  entityId: string,
  payload: unknown,
  database: Database = defaultDb,
): Promise<void> {
  if (!(SYNCED_TABLES as readonly string[]).includes(table)) return; // forward-compatible: ignore unknown tables
  const syncedTable = table as SyncedTable;
  const schemaTable = tableFor(syncedTable);
  const row = parseDates(syncedTable, payload as Record<string, unknown>);

  const existing = await database
    .select({ id: (schemaTable as any).id })
    .from(schemaTable as any)
    .where(eq((schemaTable as any).id, entityId))
    .limit(1);

  if (existing.length > 0) {
    await database
      .update(schemaTable as any)
      .set(row)
      .where(eq((schemaTable as any).id, entityId));
  } else {
    await database.insert(schemaTable as any).values(row);
  }
}

export async function applyDelete(
  table: string,
  entityId: string,
  database: Database = defaultDb,
): Promise<void> {
  if (!(SYNCED_TABLES as readonly string[]).includes(table)) return;
  const schemaTable = tableFor(table as SyncedTable);
  await database.delete(schemaTable as any).where(eq((schemaTable as any).id, entityId));
}
