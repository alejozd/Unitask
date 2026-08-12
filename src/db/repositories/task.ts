import { randomUUID } from "expo-crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks, type Task } from "@/db/schema/task";
import { completeTask } from "@/domain/task-completion";
import { isSemesterReadOnly } from "@/domain/semester-lifecycle";

async function assertSubjectEditable(subjectId: string, database: Database): Promise<void> {
  const rows = await database
    .select({ status: semesters.status })
    .from(subjects)
    .innerJoin(semesters, eq(subjects.semesterId, semesters.id))
    .where(eq(subjects.id, subjectId))
    .limit(1);
  const row = rows[0];
  if (!row || isSemesterReadOnly(row.status)) {
    throw new SemesterReadOnlyError();
  }
}

/**
 * The single place the "is this task's subject/semester open" check lives.
 * Exported so `subtask.ts` (Task 2 of this plan) reuses it instead of
 * re-implementing the same join — a subtask's edibility is always exactly
 * its parent task's editability.
 */
export async function assertTaskEditable(taskId: string, database: Database): Promise<Task> {
  const rows = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) throw new Error(`Task not found: ${taskId}`);
  await assertSubjectEditable(task.subjectId, database);
  return task;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  subjectId: string;
  dueDateTime: Date;
  priority: "Alta" | "Media" | "Baja";
  /** Initial subtasks, created in the same write as the task. Order is the array index. */
  subtaskTexts?: string[];
}

export async function createTask(
  input: CreateTaskInput,
  database: Database = defaultDb,
): Promise<Task> {
  await assertSubjectEditable(input.subjectId, database);

  const now = new Date();
  const newTask: typeof tasks.$inferInsert = {
    id: randomUUID(),
    title: input.title,
    description: input.description ?? null,
    subjectId: input.subjectId,
    dueDateTime: input.dueDateTime,
    priority: input.priority,
    completed: false,
    completedAt: null,
    completedLate: false,
    createdAt: now,
    updatedAt: now,
  };

  const newSubtasks: (typeof subtasks.$inferInsert)[] = (input.subtaskTexts ?? []).map(
    (text, index) => ({
      id: randomUUID(),
      taskId: newTask.id,
      text,
      completed: false,
      order: index,
    }),
  );

  // Synchronous transaction callback + `.run()` — see Task 1's brief note
  // (Phase 2's `createSemester` lesson): an async callback is rejected by
  // both drivers behind the `Database` type.
  await database.transaction((tx) => {
    tx.insert(tasks).values(newTask).run();
    for (const subtask of newSubtasks) {
      tx.insert(subtasks).values(subtask).run();
    }
  });

  return newTask as Task;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  subjectId?: string;
  dueDateTime?: Date;
  priority?: "Alta" | "Media" | "Baja";
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
  database: Database = defaultDb,
): Promise<void> {
  await assertTaskEditable(id, database);

  // If the task is being reassigned to a different subject, that subject's
  // own semester must also be open — the UI's Subject picker only ever
  // offers active-semester subjects (Global Constraints), but §11 requires
  // enforcement at this layer regardless of what any UI happens to show.
  if (input.subjectId !== undefined) {
    await assertSubjectEditable(input.subjectId, database);
  }

  await database
    .update(tasks)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function deleteTask(id: string, database: Database = defaultDb): Promise<void> {
  await assertTaskEditable(id, database);

  // Subtasks (and, from Phase 4/5 onward, reminders/attachments) cascade-
  // delete automatically via ON DELETE CASCADE (Phase 1 schema) now that
  // PRAGMA foreign_keys=ON is active on-device (Phase 2 Task 1) — no manual
  // cleanup needed here. No reminder/attachment records exist yet in this
  // phase (Global Constraints), so there is nothing to cancel/cleanup
  // beyond the cascade.
  await database.delete(tasks).where(eq(tasks.id, id));
}

export async function completeTaskAction(
  id: string,
  database: Database = defaultDb,
): Promise<void> {
  const task = await assertTaskEditable(id, database);

  const subtaskRows = await database
    .select({ id: subtasks.id, completed: subtasks.completed })
    .from(subtasks)
    .where(eq(subtasks.taskId, id));

  const result = completeTask({
    dueDateTime: task.dueDateTime,
    subtasks: subtaskRows,
    current: task.completed
      ? {
          completed: task.completed,
          completedAt: task.completedAt as Date,
          completedLate: task.completedLate,
        }
      : undefined,
  });

  await database.transaction((tx) => {
    tx.update(tasks)
      .set({
        completed: true,
        completedAt: result.completedAt,
        completedLate: result.completedLate,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .run();

    for (const subtaskId of result.subtaskIdsToCheck) {
      tx.update(subtasks).set({ completed: true }).where(eq(subtasks.id, subtaskId)).run();
    }
  });
}

// Referenced only by tests and potential future CLI/tooling use — no screen
// consumes this. Screens read tasks reactively via `useLiveQuery(db.select()...)`
// directly in the component (Rule 1, docs/07-architecture.md). Do not "fix"
// a screen to route through this instead.
export async function getTask(
  id: string,
  database: Database = defaultDb,
): Promise<Task | undefined> {
  const rows = await database.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return rows[0];
}
