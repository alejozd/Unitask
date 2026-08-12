import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import {
  completeTaskAction,
  createTask,
  deleteTask,
  getTask,
  updateTask,
} from "@/db/repositories/task";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

async function seedActiveSemesterWithSubject(db: ReturnType<typeof freshTestDb>) {
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
  return { semesterId, subjectId };
}

async function seedClosedSemesterWithSubject(db: ReturnType<typeof freshTestDb>) {
  const semesterId = "sem-closed";
  await db.insert(semesters).values({
    id: semesterId,
    label: "2025-2",
    status: "closed",
    createdAt: new Date(),
    closedAt: new Date(),
  });
  const subjectId = "subj-closed";
  await db.insert(subjects).values({
    id: subjectId,
    name: "Historia",
    color: "rose",
    semesterId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { semesterId, subjectId };
}

const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 1 week from now

describe("task repository", () => {
  it("creates a task with initial subtasks", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);

    const task = await createTask(
      {
        title: "Ensayo final",
        description: "Sobre la Revolución Industrial",
        subjectId,
        dueDateTime: future,
        priority: "Alta",
        subtaskTexts: ["Investigar fuentes", "Escribir borrador"],
      },
      db,
    );

    expect(task.title).toBe("Ensayo final");
    expect(task.completed).toBe(false);
    expect(task.completedLate).toBe(false);

    const fetched = await getTask(task.id, db);
    expect(fetched?.title).toBe("Ensayo final");

    const createdSubtasks = await db.select().from(subtasks).where(eq(subtasks.taskId, task.id));
    expect(createdSubtasks.map((s) => s.text).sort()).toEqual(
      ["Escribir borrador", "Investigar fuentes"].sort(),
    );
    expect(createdSubtasks.map((s) => s.order).sort()).toEqual([0, 1]);
  });

  it("creates a task with zero subtasks when none are given", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);

    const task = await createTask(
      { title: "Leer capítulo 3", subjectId, dueDateTime: future, priority: "Media" },
      db,
    );

    const createdSubtasks = await db.select().from(subtasks).where(eq(subtasks.taskId, task.id));
    expect(createdSubtasks).toHaveLength(0);
  });

  it("blocks creating a task under a closed semester (03-business-rules.md §11)", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedClosedSemesterWithSubject(db);

    await expect(
      createTask({ title: "Tarea", subjectId, dueDateTime: future, priority: "Baja" }, db),
    ).rejects.toThrow(SemesterReadOnlyError);
  });

  it("updates a task's fields, including reassigning its subject", async () => {
    const db = freshTestDb();
    const { subjectId, semesterId } = await seedActiveSemesterWithSubject(db);
    const otherSubjectId = "subj-2";
    await db.insert(subjects).values({
      id: otherSubjectId,
      name: "Física",
      color: "sky",
      semesterId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const task = await createTask(
      { title: "Original", subjectId, dueDateTime: future, priority: "Baja" },
      db,
    );

    await updateTask(
      task.id,
      { title: "Actualizada", subjectId: otherSubjectId, priority: "Alta" },
      db,
    );

    const fetched = await getTask(task.id, db);
    expect(fetched?.title).toBe("Actualizada");
    expect(fetched?.subjectId).toBe(otherSubjectId);
    expect(fetched?.priority).toBe("Alta");
  });

  it("blocks updating a task under a closed semester", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      { title: "Tarea", subjectId, dueDateTime: future, priority: "Media" },
      db,
    );

    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(updateTask(task.id, { title: "Editada" }, db)).rejects.toThrow(
      SemesterReadOnlyError,
    );
  });

  it("blocks reassigning a task into a subject that belongs to a closed semester", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const { subjectId: closedSubjectId } = await seedClosedSemesterWithSubject(db);
    const task = await createTask(
      { title: "Tarea", subjectId, dueDateTime: future, priority: "Media" },
      db,
    );

    // The Subject picker in the real UI never offers a closed semester's
    // subjects as an option (Global Constraints), but the repository layer
    // must not rely on that alone (03-business-rules.md §11: enforced at
    // the business-logic layer, not just hidden in the UI) — a caller that
    // somehow passes a closed-semester subjectId directly must still be
    // rejected.
    await expect(updateTask(task.id, { subjectId: closedSubjectId }, db)).rejects.toThrow(
      SemesterReadOnlyError,
    );
  });

  it("deletes a task and cascades its subtasks", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      {
        title: "Con subtareas",
        subjectId,
        dueDateTime: future,
        priority: "Media",
        subtaskTexts: ["Paso 1"],
      },
      db,
    );

    await deleteTask(task.id, db);

    const fetchedTask = await getTask(task.id, db);
    expect(fetchedTask).toBeUndefined();
    const remainingSubtasks = await db.select().from(subtasks).where(eq(subtasks.taskId, task.id));
    expect(remainingSubtasks).toHaveLength(0);
  });

  it("blocks deleting a task under a closed semester", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      { title: "Tarea", subjectId, dueDateTime: future, priority: "Baja" },
      db,
    );
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(deleteTask(task.id, db)).rejects.toThrow(SemesterReadOnlyError);
  });

  it("completing a task auto-checks all subtasks and stamps completedLate = false when on time", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      {
        title: "Tarea con subtareas",
        subjectId,
        dueDateTime: future,
        priority: "Media",
        subtaskTexts: ["A", "B"],
      },
      db,
    );

    await completeTaskAction(task.id, db);

    const fetched = await getTask(task.id, db);
    expect(fetched?.completed).toBe(true);
    expect(fetched?.completedLate).toBe(false);
    expect(fetched?.completedAt).not.toBeNull();

    const allSubtasks = await db.select().from(subtasks).where(eq(subtasks.taskId, task.id));
    expect(allSubtasks.every((s) => s.completed)).toBe(true);
  });

  it("completing an overdue task stamps completedLate = true", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24); // yesterday
    const task = await createTask(
      { title: "Vencida", subjectId, dueDateTime: past, priority: "Alta" },
      db,
    );

    await completeTaskAction(task.id, db);

    const fetched = await getTask(task.id, db);
    expect(fetched?.completedLate).toBe(true);
  });

  it("blocks completing a task under a closed semester", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      { title: "Tarea", subjectId, dueDateTime: future, priority: "Media" },
      db,
    );
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(completeTaskAction(task.id, db)).rejects.toThrow(SemesterReadOnlyError);
  });
});
