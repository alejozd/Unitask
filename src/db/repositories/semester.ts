import { randomUUID } from "expo-crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { db as defaultDb } from "@/db/client";
import * as schema from "@/db/schema";
import { cancelAllRemindersForTask } from "@/db/repositories/reminder";
import { semesters, type Semester } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { planSemesterCreation } from "@/domain/semester-lifecycle";

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
        .set({ status: "closed", closedAt: now })
        .where(eq(semesters.id, id))
        .run();
    }
    tx.insert(semesters).values(newSemester).run();
  });

  return { ...newSemester, closedAt: null };
}

export async function closeSemester(id: string, database: Database = defaultDb): Promise<void> {
  // Must run before the status update below — see cancelRemindersForSemester's note.
  await cancelRemindersForSemester(id, database);

  await database
    .update(semesters)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(semesters.id, id));
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
