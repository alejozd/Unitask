export type TaskStatus = "Pendiente" | "En progreso" | "Completada" | "Vencida";

export interface TaskStatusInput {
  completed: boolean;
  dueDateTime: Date;
  /** 0-100, from calculateTaskProgress in ./task-progress. */
  progress: number;
  now?: Date;
}

/**
 * Status is never stored — always computed at read time
 * (03-business-rules.md §1, §3). Evaluation order matters: completed wins
 * first, then overdue, then the progress-based Pendiente/En progreso split.
 * An incomplete overdue task is always "Vencida" even with partial
 * progress — Vencida takes priority over En progreso.
 */
export function deriveTaskStatus(input: TaskStatusInput): TaskStatus {
  const now = input.now ?? new Date();

  if (input.completed) {
    return "Completada";
  }
  if (input.dueDateTime.getTime() < now.getTime()) {
    return "Vencida";
  }
  if (input.progress > 0) {
    return "En progreso";
  }
  return "Pendiente";
}
