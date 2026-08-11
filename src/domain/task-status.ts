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
 * 100% progress with completed still false resolves to "En progreso", not
 * "Completada" — only the explicit completion action (03-business-rules.md
 * §5) produces Completada.
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
