import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { syncLog } from "@/db/schema/sync-log";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("sync_log schema", () => {
  it("inserts and reads back a sync_log row", async () => {
    const db = freshTestDb();
    await db.insert(syncLog).values({
      entityTable: "tasks",
      entityId: "task-1",
      operation: "upsert",
      updatedAt: new Date(1000),
    });

    const rows = await db.select().from(syncLog).where(eq(syncLog.entityId, "task-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe("upsert");
  });

  it("replaces the existing row for the same (entityTable, entityId) instead of duplicating", async () => {
    const db = freshTestDb();
    await db.insert(syncLog).values({
      entityTable: "tasks",
      entityId: "task-2",
      operation: "upsert",
      updatedAt: new Date(1000),
    });
    await db
      .insert(syncLog)
      .values({ entityTable: "tasks", entityId: "task-2", operation: "delete", updatedAt: new Date(2000) })
      .onConflictDoUpdate({
        target: [syncLog.entityTable, syncLog.entityId],
        set: { operation: "delete", updatedAt: new Date(2000) },
      });

    const rows = await db.select().from(syncLog).where(eq(syncLog.entityId, "task-2"));
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe("delete");
  });

  it("allows the new backfill columns to be null on existing tables", async () => {
    const db = freshTestDb();
    const { semesters } = schema;
    await db.insert(semesters).values({
      id: "sem-1",
      label: "2026-1",
      status: "active",
      createdAt: new Date(1000),
    });
    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-1"));
    expect(rows[0].updatedAt).toBeNull();
  });
});
