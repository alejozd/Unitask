/**
 * Progress is always derived from subtask completion (03-business-rules.md
 * §2) — never a manual/independent field. A task with zero subtasks is
 * binary: 0% until completed, then 100%.
 */
export function calculateTaskProgress(
  subtasks: { completed: boolean }[],
  taskCompleted: boolean,
): number {
  if (subtasks.length === 0) {
    return taskCompleted ? 100 : 0;
  }
  const completedCount = subtasks.filter((subtask) => subtask.completed).length;
  return Math.round((completedCount / subtasks.length) * 100);
}
