import type { TaskStatus } from "./task-status";

export interface SubjectDeletionCheck {
  allowed: boolean;
  /** Count of Pendiente/En progreso tasks blocking the deletion. */
  blockingTaskCount: number;
  /**
   * Only present when allowed = true: the task ids to cascade-delete along
   * with the subject (their subtasks/reminders/attachments cascade too, at
   * the repository layer). Absent (not an empty array) when allowed =
   * false, since nothing should be deleted in that case.
   */
  cascadeDeleteTaskIds?: string[];
}

/**
 * A subject may be deleted only if it has zero Pendiente/En progreso tasks
 * (03-business-rules.md §12). Completed and Vencida tasks never block —
 * if a subject has only those (or none), deletion is allowed and its
 * tasks cascade-delete with it. Closed-semester blocking (rule §11) is a
 * separate check the repository layer applies before ever calling this
 * function — this function only encodes the task-status-based rule.
 */
export function checkSubjectDeletion(
  tasks: { id: string; status: TaskStatus }[],
): SubjectDeletionCheck {
  const blockingTasks = tasks.filter(
    (task) => task.status === "Pendiente" || task.status === "En progreso",
  );

  if (blockingTasks.length > 0) {
    return { allowed: false, blockingTaskCount: blockingTasks.length };
  }

  return {
    allowed: true,
    blockingTaskCount: 0,
    cascadeDeleteTaskIds: tasks.map((task) => task.id),
  };
}
