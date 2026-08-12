import { eq } from "drizzle-orm";

import type { Database } from "@/db/repositories/semester";
import { SemesterReadOnlyError } from "@/db/repositories/errors";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks, type Task } from "@/db/schema/task";
import { isSemesterReadOnly } from "@/domain/semester-lifecycle";

/**
 * Shared closed-semester access checks for tasks and everything that
 * hangs off a task (subtasks, reminders). Lives in its own module (not in
 * task.ts, where this originated in Phase 3) so reminder.ts (Phase 4) can
 * import `assertTaskEditable` without creating a task.ts <-> reminder.ts
 * circular import: task.ts itself calls into reminder.ts to trigger
 * scheduling/cancelling side effects, so the reverse edge would cycle.
 * Imports `SemesterReadOnlyError` from `errors.ts`, not `subject.ts`, for
 * the same reason — see this task's "Why TWO extractions" note.
 */
export async function assertSubjectEditable(subjectId: string, database: Database): Promise<void> {
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

export async function assertTaskEditable(taskId: string, database: Database): Promise<Task> {
  const rows = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) throw new Error(`Task not found: ${taskId}`);
  await assertSubjectEditable(task.subjectId, database);
  return task;
}
