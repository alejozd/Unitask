import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import {
  resolveSyncTimestamp,
  enqueueChange,
  enqueueCascadeDeleteForTask,
  getPendingChanges,
  clearPendingChanges,
} from "../queue";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("resolveSyncTimestamp", () => {
  it("prefers updatedAt when present", () => {
    expect(resolveSyncTimestamp({ updatedAt: new Date(2000), createdAt: new Date(1000) })).toEqual(
      new Date(2000),
    );
  });

  it("falls back to createdAt when updatedAt is null", () => {
    expect(resolveSyncTimestamp({ updatedAt: null, createdAt: new Date(1000) })).toEqual(new Date(1000));
  });

  it("falls back to the current time when both are null", () => {
    const before = Date.now();
    const result = resolveSyncTimestamp({ updatedAt: null, createdAt: null });
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("enqueueChange / getPendingChanges / clearPendingChanges", () => {
  it("records a new pending change", async () => {
    const db = freshTestDb();
    await enqueueChange("tasks", "task-1", "upsert", db);

    const pending = await getPendingChanges(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ entityTable: "tasks", entityId: "task-1", operation: "upsert" });
  });

  it("replaces the pending entry for the same entity instead of duplicating", async () => {
    const db = freshTestDb();
    await enqueueChange("tasks", "task-2", "upsert", db);
    await enqueueChange("tasks", "task-2", "delete", db);

    const pending = await getPendingChanges(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("delete");
  });

  it("clearPendingChanges removes only the given keys", async () => {
    const db = freshTestDb();
    await enqueueChange("tasks", "task-3", "upsert", db);
    await enqueueChange("tasks", "task-4", "upsert", db);

    await clearPendingChanges(["tasks:task-3"], db);

    const pending = await getPendingChanges(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].entityId).toBe("task-4");
  });
});

describe("enqueueCascadeDeleteForTask", () => {
  it("enqueues a delete for the task and every one of its subtasks/reminders/attachments", async () => {
    const db = freshTestDb();
    await db.insert(semesters).values({ id: "sem-1", label: "2026-1", status: "active", createdAt: new Date() });
    await db.insert(subjects).values({
      id: "subj-1",
      name: "Física",
      courseCode: null,
      professorName: null,
      color: "indigo",
      semesterId: "sem-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(tasks).values({
      id: "task-5",
      title: "T",
      description: null,
      subjectId: "subj-1",
      dueDateTime: new Date(),
      priority: "Alta",
      completed: false,
      completedAt: null,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(subtasks).values({ id: "st-1", taskId: "task-5", text: "x", completed: false, order: 0 });
    await db.insert(reminders).values({
      id: "rem-1",
      taskId: "task-5",
      kind: "fixed",
      offsetValue: null,
      offsetUnit: null,
      fixedDateTime: new Date(5000),
      computedFireAt: new Date(5000),
      notificationId: null,
      createdAt: new Date(1000),
    });
    await db.insert(attachments).values({
      id: "att-1",
      taskId: "task-5",
      originalFileName: "a.pdf",
      storedPath: "/x/a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      createdAt: new Date(1000),
    });

    await enqueueCascadeDeleteForTask("task-5", db);

    const pending = await getPendingChanges(db);
    const keys = pending.map((p) => `${p.entityTable}:${p.entityId}`).sort();
    expect(keys).toEqual(["attachments:att-1", "reminders:rem-1", "subtasks:st-1", "tasks:task-5"].sort());
    expect(pending.every((p) => p.operation === "delete")).toBe(true);
  });

  it("still enqueues the task delete even when it has no children", async () => {
    const db = freshTestDb();
    await enqueueCascadeDeleteForTask("task-6", db);
    const pending = await getPendingChanges(db);
    expect(pending).toEqual([expect.objectContaining({ entityTable: "tasks", entityId: "task-6" })]);
  });
});
