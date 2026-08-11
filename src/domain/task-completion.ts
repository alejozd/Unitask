export interface CompleteTaskInput {
  dueDateTime: Date;
  /** Defaults to the current time when not provided. */
  now?: Date;
  subtasks: { id: string; completed: boolean }[];
  /**
   * If the task is already completed, pass its existing completedAt/
   * completedLate here — completeTask will return them unchanged rather
   * than recomputing, since completedLate must never be recalculated
   * after being set once (03-business-rules.md §4).
   */
  current?: { completed: boolean; completedAt: Date; completedLate: boolean };
}

export interface CompleteTaskResult {
  completed: true;
  completedAt: Date;
  /**
   * Computed once, here, at completion time — never recalculated
   * afterward (03-business-rules.md §4). Not surfaced in MVP UI; persisted
   * for a future on-time-completion-rate statistic.
   */
  completedLate: boolean;
  /** Subtask ids the repository layer must force-set to completed = true. */
  subtaskIdsToCheck: string[];
}

/**
 * Both completion entry points (list checkbox, detail-screen button) must
 * call this same function (03-business-rules.md §5) so their behavior can
 * never drift apart.
 */
export function completeTask(input: CompleteTaskInput): CompleteTaskResult {
  if (input.current?.completed) {
    return {
      completed: true,
      completedAt: input.current.completedAt,
      completedLate: input.current.completedLate,
      subtaskIdsToCheck: input.subtasks
        .filter((subtask) => !subtask.completed)
        .map((subtask) => subtask.id),
    };
  }

  const completedAt = input.now ?? new Date();

  return {
    completed: true,
    completedAt,
    completedLate: completedAt.getTime() > input.dueDateTime.getTime(),
    subtaskIdsToCheck: input.subtasks
      .filter((subtask) => !subtask.completed)
      .map((subtask) => subtask.id),
  };
}
