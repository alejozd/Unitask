/**
 * Progress is always derived from subtask completion (03-business-rules.md
 * §2) — never a manual/independent field. A task with zero subtasks is
 * binary: 0% until completed, then 100%.
 */
export function calculateTaskProgress(
  subtasks: { completed: boolean }[],
  taskCompleted: boolean,
): number {
  // taskCompleted only matters for the zero-subtask case below — with real
  // subtasks, the ratio is always authoritative (task-completion.ts
  // guarantees a completed task has every subtask checked, so this never
  // actually diverges in practice).
  if (subtasks.length === 0) {
    return taskCompleted ? 100 : 0;
  }
  const completedCount = subtasks.filter((subtask) => subtask.completed).length;
  return Math.round((completedCount / subtasks.length) * 100);
}
