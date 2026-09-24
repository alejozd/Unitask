import { randomUUID } from "expo-crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { db as defaultDb } from "@/db/client";
import * as schema from "@/db/schema";
import { cancelAllRemindersForTask } from "@/db/repositories/reminder";
import { enqueueChange } from "@/lib/sync/queue";
import { semesters, type Semester } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import {
  planActiveSemesterReconciliation,
  planSemesterCreation,
} from "@/domain/semester-lifecycle";

/**
 * Driver-agnostic database type so repository functions can be exercised
 * against `drizzle-orm/better-sqlite3` in Jest (no Expo/RN runtime needed)
 * as well as the real `drizzle-orm/expo-sqlite` client on-device.
 */
export type Database = BaseSQLiteDatabase<"async" | "sync", unknown, typeof schema>;

/**
 * Cancels every pending OS notification for every task under a semester's
 * subjects — mirrors how `deleteSubject`'s cascade-delete cancels its
 * tasks' reminders before the delete. Must run while the semester is still
 * active: `cancelAllRemindersForTask` calls `assertTaskEditable`, which
 * throws once the semester is closed, so this has to happen BEFORE the
 * semester's status flips to "closed", not after.
 */
async function cancelRemindersForSemester(semesterId: string, database: Database): Promise<void> {
  const taskRows = await database
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(subjects, eq(tasks.subjectId, subjects.id))
    .where(eq(subjects.semesterId, semesterId));
  for (const { id } of taskRows) {
    await cancelAllRemindersForTask(id, database);
  }
}

/**
 * Creates a new semester as active. If another semester is currently
 * active, it is auto-closed as part of the same operation
 * (03-business-rules.md §10) — the caller never has to close the old one
 * manually first.
 */
export async function createSemester(
  label: string,
  database: Database = defaultDb,
): Promise<Semester> {
  const existing = await database
    .select({ id: semesters.id, status: semesters.status })
    .from(semesters);
  const plan = planSemesterCreation(existing);

  const now = new Date();
  const newSemester: typeof semesters.$inferInsert = {
    id: randomUUID(),
    label,
    status: "active",
    createdAt: now,
    updatedAt: null,
  };

  // Cancel the reminders of every semester about to be auto-closed BEFORE
  // the transaction below flips their status — cancelAllRemindersForTask
  // (via assertTaskEditable) requires the semester to still be active. This
  // has to happen outside `database.transaction(...)` because that callback
  // must stay synchronous (see the note above its call).
  for (const id of plan.semesterIdsToClose) {
    await cancelRemindersForSemester(id, database);
  }

  // Both drivers behind the `Database` type (better-sqlite3 and expo-sqlite)
  // run transactions synchronously: the callback passed to `.transaction()`
  // must not be `async` (an async function always returns a Promise, which
  // better-sqlite3 explicitly rejects — "Transaction function cannot return
  // a promise"). Statements are executed with `.run()` instead of `await`.
  await database.transaction((tx) => {
    for (const id of plan.semesterIdsToClose) {
      tx.update(semesters)
        .set({ status: "closed", closedAt: now, updatedAt: now })
        .where(eq(semesters.id, id))
        .run();
    }
    tx.insert(semesters).values(newSemester).run();
  });

  for (const id of plan.semesterIdsToClose) {
    await enqueueChange("semesters", id, "upsert", database);
  }
  await enqueueChange("semesters", newSemester.id, "upsert", database);

  return { ...newSemester, closedAt: null, updatedAt: null };
}

export async function closeSemester(id: string, database: Database = defaultDb): Promise<void> {
  // Must run before the status update below — see cancelRemindersForSemester's note.
  await cancelRemindersForSemester(id, database);

  await database
    .update(semesters)
    .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
    .where(eq(semesters.id, id));
  await enqueueChange("semesters", id, "upsert", database);
}

export interface ReconcileActiveSemestersResult {
  closedSemesterIds: string[];
}

/**
 * Repairs 03-business-rules.md §10's single-active-semester invariant
 * after a sync pull may have violated it — each of two devices sharing one
 * sync account can independently create its own "active" semester before
 * ever linking, and pulling the other device's semester then leaves both
 * simultaneously active locally. Deterministic (see
 * planActiveSemesterReconciliation's own doc comment): every device
 * reconciling the same already-synced data reaches the same decision, so
 * this never needs to be driven by anything but the local pull itself —
 * called from runSync() right after pullChanges completes.
 */
export async function reconcileActiveSemesters(
  database: Database = defaultDb,
): Promise<ReconcileActiveSemestersResult> {
  const activeRows = await database
    .select({
      id: semesters.id,
      status: semesters.status,
      updatedAt: semesters.updatedAt,
      createdAt: semesters.createdAt,
    })
    .from(semesters)
    .where(eq(semesters.status, "active"));

  const plan = planActiveSemesterReconciliation(activeRows);
  if (plan.semesterIdsToClose.length === 0) {
    return { closedSemesterIds: [] };
  }

  // Must run before the status update below — see cancelRemindersForSemester's note.
  for (const id of plan.semesterIdsToClose) {
    await cancelRemindersForSemester(id, database);
  }

  const now = new Date();
  for (const id of plan.semesterIdsToClose) {
    await database
      .update(semesters)
      .set({ status: "closed", closedAt: now, updatedAt: now })
      .where(eq(semesters.id, id));
    await enqueueChange("semesters", id, "upsert", database);
  }

  return { closedSemesterIds: plan.semesterIdsToClose };
}

export async function getActiveSemester(
  database: Database = defaultDb,
): Promise<Semester | undefined> {
  const rows = await database
    .select()
    .from(semesters)
    .where(eq(semesters.status, "active"))
    .limit(1);
  return rows[0];
}

export async function listSemestersQuery(database: Database = defaultDb): Promise<Semester[]> {
  // `createdAt` is stored with second-level precision (Drizzle's `mode:
  // "timestamp"` truncates to whole seconds), so two semesters created
  // within the same second tie on `createdAt` alone. SQLite's implicit
  // `rowid` always increases with insertion order, so it breaks the tie
  // deterministically in the same "newest first" direction.
  return database
    .select()
    .from(semesters)
    .orderBy(desc(semesters.createdAt), desc(sql`rowid`));
}
