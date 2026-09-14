import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import { enqueueChange } from "./queue";
import { pushChanges } from "./push";
import { pullChanges } from "./pull";
import { isLoggedIn, restoreSession } from "./client";

export class SyncNotConfiguredError extends Error {
  constructor() {
    super("No hay una sesión de sincronización activa");
    this.name = "SyncNotConfiguredError";
  }
}

export interface SyncResult {
  pushed: number;
  rejected: number;
  pulled: number;
}

export function isSyncConfigured(): boolean {
  return isLoggedIn();
}

export async function runSync(database: Database = defaultDb): Promise<SyncResult> {
  if (!isLoggedIn()) {
    const restored = await restoreSession();
    if (!restored) throw new SyncNotConfiguredError();
  }

  const pushResult = await pushChanges(database);
  const pullResult = await pullChanges(database);

  return { pushed: pushResult.pushed, rejected: pushResult.rejected, pulled: pullResult.applied };
}

const SYNCED_TABLE_DEFS = [
  { name: "semesters" as const, table: semesters },
  { name: "subjects" as const, table: subjects },
  { name: "tasks" as const, table: tasks },
  { name: "subtasks" as const, table: subtasks },
  { name: "reminders" as const, table: reminders },
  { name: "attachments" as const, table: attachments },
];

/**
 * Called once, right after a device's first successful login/register
 * (Configuración's "Sincronizar" section) — the server has no record yet of
 * this device's pre-existing local data, so every row across every synced
 * table is queued as an upsert, exactly the same way any other edit gets
 * queued. No separate "initial sync" code path in push.ts itself.
 */
export async function enqueueEverythingForInitialPush(
  database: Database = defaultDb,
): Promise<void> {
  for (const { name, table } of SYNCED_TABLE_DEFS) {
    const rows = await database.select({ id: (table as any).id }).from(table as any);
    for (const { id } of rows) {
      await enqueueChange(name, id, "upsert", database);
    }
  }
}
