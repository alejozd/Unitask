import { randomUUID } from "expo-crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { db as defaultDb } from "@/db/client";
import * as schema from "@/db/schema";
import { semesters, type Semester } from "@/db/schema/semester";
import { planSemesterCreation } from "@/domain/semester-lifecycle";

/**
 * Driver-agnostic database type so repository functions can be exercised
 * against `drizzle-orm/better-sqlite3` in Jest (no Expo/RN runtime needed)
 * as well as the real `drizzle-orm/expo-sqlite` client on-device.
 */
export type Database = BaseSQLiteDatabase<"async" | "sync", unknown, typeof schema>;

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
