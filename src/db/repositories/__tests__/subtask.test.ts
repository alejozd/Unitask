import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { createTask } from "@/db/repositories/task";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import {
  addSubtask,
  deleteSubtask,
  moveSubtask,
  toggleSubtaskCompleted,
  updateSubtaskText,
} from "@/db/repositories/subtask";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

async function seedTaskInActiveSemester(db: ReturnType<typeof freshTestDb>) {
  const semesterId = "sem-active";
  await db
    .insert(semesters)
    .values({ id: semesterId, label: "2026-1", status: "active", createdAt: new Date() });
  const subjectId = "subj-1";
  await db.insert(subjects).values({
    id: subjectId,
    name: "Cálculo II",
    color: "indigo",
    semesterId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const { task } = await createTask(
    {
      title: "Tarea",
      subjectId,
      dueDateTime: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      priority: "Media",
    },
    db,
  );
  return { semesterId, task };
}

describe("subtask repository", () => {
  it("adds a subtask with the next order value", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);

    const first = await addSubtask(task.id, "Primer paso", db);
    const second = await addSubtask(task.id, "Segundo paso", db);

    expect(first.order).toBe(0);
    expect(second.order).toBe(1);
  });

  it("blocks adding a subtask under a closed semester", async () => {
    const db = freshTestDb();
    const { task, semesterId } = await seedTaskInActiveSemester(db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(addSubtask(task.id, "Paso", db)).rejects.toThrow(SemesterReadOnlyError);
    void semesterId;
  });

  it("updates a subtask's text", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Original", db);

    await updateSubtaskText(subtask.id, "Corregido", db);

    const [fetched] = await db.select().from(subtasks).where(eq(subtasks.id, subtask.id));
    expect(fetched.text).toBe("Corregido");
  });

  it("toggles a subtask's completed flag", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Paso", db);

    await toggleSubtaskCompleted(subtask.id, true, db);
    let [fetched] = await db.select().from(subtasks).where(eq(subtasks.id, subtask.id));
    expect(fetched.completed).toBe(true);

    await toggleSubtaskCompleted(subtask.id, false, db);
    [fetched] = await db.select().from(subtasks).where(eq(subtasks.id, subtask.id));
    expect(fetched.completed).toBe(false);
  });

  it("blocks toggling a subtask under a closed semester", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Paso", db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(toggleSubtaskCompleted(subtask.id, true, db)).rejects.toThrow(
      SemesterReadOnlyError,
    );
  });

  it("deletes a subtask", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Paso", db);

    await deleteSubtask(subtask.id, db);

    const remaining = await db.select().from(subtasks).where(eq(subtasks.id, subtask.id));
    expect(remaining).toHaveLength(0);
  });

  it("blocks deleting a subtask under a closed semester", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Paso", db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(deleteSubtask(subtask.id, db)).rejects.toThrow(SemesterReadOnlyError);
  });

  it("moves a subtask up, swapping order with its predecessor", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const first = await addSubtask(task.id, "Uno", db);
    const second = await addSubtask(task.id, "Dos", db);

    await moveSubtask(second.id, "up", db);

    const rows = await db.select().from(subtasks).where(eq(subtasks.taskId, task.id));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.order]));
    expect(byId[second.id]).toBe(0);
    expect(byId[first.id]).toBe(1);
  });

  it("moving the first subtask up is a no-op", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const first = await addSubtask(task.id, "Uno", db);
    const second = await addSubtask(task.id, "Dos", db);

    await moveSubtask(first.id, "up", db);

    const rows = await db.select().from(subtasks).where(eq(subtasks.taskId, task.id));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.order]));
    expect(byId[first.id]).toBe(0);
    expect(byId[second.id]).toBe(1);
  });

  it("moves a subtask down, swapping order with its successor", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const first = await addSubtask(task.id, "Uno", db);
    const second = await addSubtask(task.id, "Dos", db);

    await moveSubtask(first.id, "down", db);

    const rows = await db.select().from(subtasks).where(eq(subtasks.taskId, task.id));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.order]));
    expect(byId[first.id]).toBe(1);
    expect(byId[second.id]).toBe(0);
  });

  it("moving the last subtask down is a no-op", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const first = await addSubtask(task.id, "Uno", db);
    const second = await addSubtask(task.id, "Dos", db);

    await moveSubtask(second.id, "down", db);

    const rows = await db.select().from(subtasks).where(eq(subtasks.taskId, task.id));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.order]));
    expect(byId[first.id]).toBe(0);
    expect(byId[second.id]).toBe(1);
  });

  it("blocks updating a subtask's text under a closed semester", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Paso", db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(updateSubtaskText(subtask.id, "New text", db)).rejects.toThrow(
      SemesterReadOnlyError,
    );
  });

  it("blocks moving a subtask under a closed semester", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Paso", db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(moveSubtask(subtask.id, "up", db)).rejects.toThrow(SemesterReadOnlyError);
  });
});
