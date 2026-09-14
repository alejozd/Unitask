import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { buildPayload, applyUpsert, applyDelete } from "../serializers";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("buildPayload", () => {
  it("builds a semesters payload with all fields", async () => {
    const db = freshTestDb();
    await db
      .insert(semesters)
      .values({ id: "sem-1", label: "2026-1", status: "active", createdAt: new Date(1000) });

    const result = await buildPayload("semesters", "sem-1", db);
    expect(result?.payload).toMatchObject({ id: "sem-1", label: "2026-1", status: "active" });
    expect(result?.clientUpdatedAt).toBeGreaterThan(0);
  });

  it("returns null when the entity no longer exists", async () => {
    const db = freshTestDb();
    const result = await buildPayload("semesters", "missing", db);
    expect(result).toBeNull();
  });
});

describe("applyUpsert / applyDelete", () => {
  it("applyUpsert inserts a new semesters row from a pulled payload", async () => {
    const db = freshTestDb();
    await applyUpsert(
      "semesters",
      "sem-2",
      {
        id: "sem-2",
        label: "2026-2",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        closedAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      db,
    );

    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-2"));
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("2026-2");
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("applyUpsert updates an existing row instead of inserting a duplicate", async () => {
    const db = freshTestDb();
    await applyUpsert(
      "semesters",
      "sem-3",
      {
        id: "sem-3",
        label: "V1",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        closedAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      db,
    );
    await applyUpsert(
      "semesters",
      "sem-3",
      {
        id: "sem-3",
        label: "V2",
        status: "closed",
        createdAt: "2026-01-01T00:00:00.000Z",
        closedAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      db,
    );

    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-3"));
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("V2");
    expect(rows[0].status).toBe("closed");
  });

  it("applyDelete removes the row for the given table and id", async () => {
    const db = freshTestDb();
    await applyUpsert(
      "semesters",
      "sem-4",
      {
        id: "sem-4",
        label: "X",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        closedAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      db,
    );
    await applyDelete("semesters", "sem-4", db);

    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-4"));
    expect(rows).toHaveLength(0);
  });

  it("applyUpsert on tasks parses date-string fields into real Date columns", async () => {
    const db = freshTestDb();
    await db
      .insert(semesters)
      .values({ id: "sem-5", label: "2026-1", status: "active", createdAt: new Date() });
    await db.insert(subjects).values({
      id: "subj-1",
      name: "Cálculo",
      courseCode: null,
      professorName: null,
      color: "indigo",
      semesterId: "sem-5",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await applyUpsert(
      "tasks",
      "task-1",
      {
        id: "task-1",
        title: "Entregar informe",
        description: null,
        subjectId: "subj-1",
        dueDateTime: "2026-03-01T10:00:00.000Z",
        priority: "Alta",
        completed: false,
        completedAt: null,
        completedLate: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      db,
    );

    const rows = await db.select().from(tasks).where(eq(tasks.id, "task-1"));
    expect(rows[0].dueDateTime).toBeInstanceOf(Date);
    expect(rows[0].dueDateTime.toISOString()).toBe("2026-03-01T10:00:00.000Z");
  });
});
