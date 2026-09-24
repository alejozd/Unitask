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

export interface ActiveSemesterForReconciliation {
  id: string;
  status: SemesterStatus;
  updatedAt: Date | null;
  createdAt: Date;
}

export interface ReconcileActiveSemestersPlan {
  /**
   * Ids of active semesters to close so that at most one remains active —
   * restoring 03-business-rules.md §10's invariant after a sync pull may
   * have introduced a second "active" row (each of two devices can create
   * its own active semester independently before ever linking accounts).
   * The most recently updated (or, absent an edit, most recently created)
   * semester is kept active; every other active semester is closed.
   */
  semesterIdsToClose: string[];
}

/**
 * Deterministic by design: every device reconciling the exact same
 * (already-synced) set of active semesters must reach the exact same
 * winner, or devices would keep flip-flopping which one is "active" back
 * and forth via sync forever. Ties on timestamp break by `id` (a UUID,
 * identical across devices once synced) rather than input array order.
 */
export function planActiveSemesterReconciliation(
  semesters: ActiveSemesterForReconciliation[],
): ReconcileActiveSemestersPlan {
  const active = semesters.filter((semester) => semester.status === "active");
  if (active.length <= 1) {
    return { semesterIdsToClose: [] };
  }

  const sorted = [...active].sort((a, b) => {
    const aTime = (a.updatedAt ?? a.createdAt).getTime();
    const bTime = (b.updatedAt ?? b.createdAt).getTime();
    if (aTime !== bTime) return bTime - aTime; // most recent first
    return a.id.localeCompare(b.id); // deterministic tie-break
  });

  const [, ...losers] = sorted;
  return { semesterIdsToClose: losers.map((semester) => semester.id) };
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
