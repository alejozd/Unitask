import { randomUUID } from "expo-crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { assertSubjectEditable, assertTaskEditable } from "@/db/repositories/task-access";
import { deleteAttachmentFilesForTask } from "@/db/repositories/attachment";
import {
  addReminder,
  cancelAllRemindersForTask,
  rescheduleRemindersForTask,
} from "@/db/repositories/reminder";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks, type Task } from "@/db/schema/task";
import { completeTask } from "@/domain/task-completion";
import type { ReminderSpec } from "@/domain/reminder-scheduling";
import { requestNotificationPermission, scheduleDueNotification } from "@/lib/notifications";

export { assertTaskEditable };

export interface CreateTaskInput {
  title: string;
  description?: string;
  subjectId: string;
  dueDateTime: Date;
  priority: "Alta" | "Media" | "Baja";
  /** Initial subtasks, created in the same write as the task. Order is the array index. */
  subtaskTexts?: string[];
  /**
   * Reminders to create alongside the task. Omitted/empty means zero
   * reminders — the "1 día antes" default (03-business-rules.md §7) is a
   * UI-layer default (Nueva Tarea's initial draft state), not a
   * repository-level one, exactly mirroring how `subtaskTexts` works.
   */
  reminderSpecs?: ReminderSpec[];
}

export interface CreateTaskResult {
  task: Task;
  /** Count of reminders whose `addReminder` call came back with `notificationId: null`. */
  remindersUnscheduled: number;
}

export async function createTask(
  input: CreateTaskInput,
  database: Database = defaultDb,
): Promise<CreateTaskResult> {
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

  let remindersUnscheduled = 0;
  for (const spec of input.reminderSpecs ?? []) {
    const reminder = await addReminder(newTask.id, spec, database);
    if (reminder.notificationId === null) {
      remindersUnscheduled += 1;
    }
  }

  // Phase 10.6: every task gets its own due-time notification
  // ("¡Es para ahora!"), independent of whatever reminders (if any) were
  // just created above — a task with zero reminders still benefits from
  // being told when it's actually due.
  if (input.dueDateTime.getTime() > Date.now()) {
    const permission = await requestNotificationPermission();
    if (permission.granted) {
      const subjectRows = await database
        .select({ name: subjects.name })
        .from(subjects)
        .where(eq(subjects.id, input.subjectId))
        .limit(1);
      await scheduleDueNotification(newTask.id, input.dueDateTime, {
        taskTitle: input.title,
        subjectName: subjectRows[0]?.name ?? "",
      });
    }
  }

  return { task: newTask as Task, remindersUnscheduled };
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  subjectId?: string;
  dueDateTime?: Date;
  priority?: "Alta" | "Media" | "Baja";
}

export interface UpdateTaskResult {
  remindersRemoved: number;
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
  database: Database = defaultDb,
): Promise<UpdateTaskResult> {
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

  let remindersRemoved = 0;
  if (input.dueDateTime !== undefined) {
    const result = await rescheduleRemindersForTask(id, input.dueDateTime, database);
    remindersRemoved = result.removedCount;
  }

  return { remindersRemoved };
}

export async function deleteTask(id: string, database: Database = defaultDb): Promise<void> {
  await assertTaskEditable(id, database);

  // Cancel pending OS notifications before the cascade-delete removes the
  // reminder rows themselves — cancelAllRemindersForTask needs the rows
  // to still exist to know their notificationIds.
  await cancelAllRemindersForTask(id, database);

  // Delete copied attachment files before the cascade-delete removes the
  // attachment rows themselves — same ordering reason as reminders above.
  await deleteAttachmentFilesForTask(id, database);

  // Subtasks, reminders, and attachments cascade-delete automatically via
  // ON DELETE CASCADE (Phase 1 schema) now that PRAGMA foreign_keys=ON is
  // active on-device (Phase 2 Task 1) — no manual row cleanup needed here.
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
    current:
      task.completed && task.completedAt
        ? {
            completed: task.completed,
            completedAt: task.completedAt,
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

  await cancelAllRemindersForTask(id, database);
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
