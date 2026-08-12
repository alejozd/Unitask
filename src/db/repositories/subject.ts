import { randomUUID } from "expo-crypto";
import { eq, inArray } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { SemesterReadOnlyError } from "@/db/repositories/errors";
import { semesters } from "@/db/schema/semester";
import { subjects, SUBJECT_COLORS, type Subject } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks } from "@/db/schema/task";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus, type TaskStatus } from "@/domain/task-status";
import { isSemesterReadOnly } from "@/domain/semester-lifecycle";
import { checkSubjectDeletion } from "@/domain/subject-deletion";

export type SubjectColor = (typeof SUBJECT_COLORS)[number];

export { SemesterReadOnlyError } from "@/db/repositories/errors";

export class SubjectDeletionBlockedError extends Error {
  constructor(public blockingTaskCount: number) {
    super(`No se puede eliminar: hay ${blockingTaskCount} tarea(s) pendiente(s) o en progreso.`);
    this.name = "SubjectDeletionBlockedError";
  }
}

async function assertSemesterEditable(semesterId: string, database: Database): Promise<void> {
  const rows = await database
    .select({ status: semesters.status })
    .from(semesters)
    .where(eq(semesters.id, semesterId))
    .limit(1);
  const semester = rows[0];
  if (!semester || isSemesterReadOnly(semester.status)) {
    throw new SemesterReadOnlyError();
  }
}

async function getTaskStatusesForSubject(
  subjectId: string,
  database: Database,
): Promise<{ id: string; status: TaskStatus }[]> {
  const subjectTasks = await database
    .select({ id: tasks.id, completed: tasks.completed, dueDateTime: tasks.dueDateTime })
    .from(tasks)
    .where(eq(tasks.subjectId, subjectId));

  if (subjectTasks.length === 0) return [];

  const taskIds = subjectTasks.map((task) => task.id);
  const allSubtasks = await database
    .select({ taskId: subtasks.taskId, completed: subtasks.completed })
    .from(subtasks)
    .where(inArray(subtasks.taskId, taskIds));

  return subjectTasks.map((task) => {
    const taskSubtasks = allSubtasks.filter((subtask) => subtask.taskId === task.id);
    const progress = calculateTaskProgress(taskSubtasks, task.completed);
    const status = deriveTaskStatus({
      completed: task.completed,
      dueDateTime: task.dueDateTime,
      progress,
    });
    return { id: task.id, status };
  });
}

export interface CreateSubjectInput {
  name: string;
  courseCode?: string;
  professorName?: string;
  color: SubjectColor;
  semesterId: string;
}

export async function createSubject(
  input: CreateSubjectInput,
  database: Database = defaultDb,
): Promise<Subject> {
  await assertSemesterEditable(input.semesterId, database);

  const now = new Date();
  const newSubject: typeof subjects.$inferInsert = {
    id: randomUUID(),
    name: input.name,
    courseCode: input.courseCode ?? null,
    professorName: input.professorName ?? null,
    color: input.color,
    semesterId: input.semesterId,
    createdAt: now,
    updatedAt: now,
  };

  await database.insert(subjects).values(newSubject);
  return newSubject as Subject;
}

export interface UpdateSubjectInput {
  name?: string;
  courseCode?: string | null;
  professorName?: string | null;
  color?: SubjectColor;
}

export async function updateSubject(
  id: string,
  input: UpdateSubjectInput,
  database: Database = defaultDb,
): Promise<void> {
  const rows = await database
    .select({ semesterId: subjects.semesterId })
    .from(subjects)
    .where(eq(subjects.id, id))
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error(`Subject not found: ${id}`);

  await assertSemesterEditable(existing.semesterId, database);

  await database
    .update(subjects)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(subjects.id, id));
}

export async function deleteSubject(id: string, database: Database = defaultDb): Promise<void> {
  const rows = await database
    .select({ semesterId: subjects.semesterId })
    .from(subjects)
    .where(eq(subjects.id, id))
    .limit(1);
  const subject = rows[0];
  if (!subject) throw new Error(`Subject not found: ${id}`);

  await assertSemesterEditable(subject.semesterId, database);

  const taskStatuses = await getTaskStatusesForSubject(id, database);
  const check = checkSubjectDeletion(taskStatuses);
  if (!check.allowed) {
    throw new SubjectDeletionBlockedError(check.blockingTaskCount);
  }

  // Any remaining (non-blocking) tasks and their subtasks/reminders/
  // attachments cascade-delete automatically via ON DELETE CASCADE
  // (Phase 1) now that PRAGMA foreign_keys=ON is active (this phase's
  // Task 1) — no manual cleanup needed here.
  await database.delete(subjects).where(eq(subjects.id, id));
}

// Referenced only by tests and potential future CLI/tooling use — no screen
// consumes this. Screens read subjects reactively via `useLiveQuery(db.select()...)`
// directly in the component (Rule 1, docs/07-architecture.md), since
// `useLiveQuery` needs a reactive query object, not an async function call.
// Do not "fix" a screen to route through this instead.
export async function getSubject(
  id: string,
  database: Database = defaultDb,
): Promise<Subject | undefined> {
  const rows = await database.select().from(subjects).where(eq(subjects.id, id)).limit(1);
  return rows[0];
}

// Referenced only by tests and potential future CLI/tooling use — no screen
// consumes this. Screens read subjects reactively via `useLiveQuery(db.select()...)`
// directly in the component (Rule 1, docs/07-architecture.md), since
// `useLiveQuery` needs a reactive query object, not an async function call.
// Do not "fix" a screen to route through this instead.
export async function listSubjectsForSemesterQuery(
  semesterId: string,
  database: Database = defaultDb,
): Promise<Subject[]> {
  const results = await database.select().from(subjects).where(eq(subjects.semesterId, semesterId));

  // SQLite's default BINARY collation sorts by raw UTF-8 byte value, which
  // puts accented characters (e.g. "Á") after unaccented ones later in the
  // alphabet (e.g. "Z") — wrong for Spanish subject names. `.orderBy()` at
  // the SQL layer can't fix this without a custom collation, so the final
  // sort happens here in JS with locale-aware comparison instead.
  return results.sort((a, b) => a.name.localeCompare(b.name, "es"));
}
