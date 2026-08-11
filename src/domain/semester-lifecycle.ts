export const SEMESTER_STATUSES = ["active", "closed"] as const;
export type SemesterStatus = (typeof SEMESTER_STATUSES)[number];

export interface SemesterForLifecycle {
  id: string;
  status: SemesterStatus;
}

export interface CreateSemesterPlan {
  /**
   * Ids of currently-active semesters the repository layer must close
   * (status = "closed", closedAt = now) as part of the same write that
   * activates the new semester — creating a new semester auto-closes the
   * previous one (03-business-rules.md §10), never requiring the user to
   * close it manually first.
   */
  semesterIdsToClose: string[];
}

export function planSemesterCreation(
  existingSemesters: SemesterForLifecycle[],
): CreateSemesterPlan {
  return {
    semesterIdsToClose: existingSemesters
      .filter((semester) => semester.status === "active")
      .map((semester) => semester.id),
  };
}

/**
 * A closed semester and everything under it (subjects, tasks, subtasks,
 * reminders, attachments) is read-only: no create/edit/delete anywhere in
 * its tree (03-business-rules.md §11). This is the one place `=== "closed"`
 * is checked for read-only purposes, so no *external* call site needs to
 * hardcode that specific comparison.
 */
export function isSemesterReadOnly(status: SemesterStatus): boolean {
  return status === "closed";
}
