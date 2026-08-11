export type ReminderOffsetUnit = "minutes" | "hours" | "days";

export interface RelativeReminder {
  kind: "relative";
  offsetValue: number;
  offsetUnit: ReminderOffsetUnit;
}

export interface FixedReminder {
  kind: "fixed";
  fixedDateTime: Date;
}

export type ReminderSpec = RelativeReminder | FixedReminder;

const OFFSET_UNIT_TO_MS: Record<ReminderOffsetUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/**
 * For "relative": dueDateTime - offset. For "fixed": the fixed datetime,
 * unchanged (03-business-rules.md §7).
 */
export function computeFireAt(reminder: ReminderSpec, dueDateTime: Date): Date {
  if (reminder.kind === "fixed") {
    return new Date(reminder.fixedDateTime.getTime());
  }
  const offsetMs = reminder.offsetValue * OFFSET_UNIT_TO_MS[reminder.offsetUnit];
  return new Date(dueDateTime.getTime() - offsetMs);
}

/**
 * Every new task gets this reminder automatically unless the user removes
 * it (03-business-rules.md §7's "1 día antes" default).
 */
export function defaultReminder(): RelativeReminder {
  return { kind: "relative", offsetValue: 1, offsetUnit: "days" };
}

export interface ReschedulableReminder {
  id: string;
  spec: ReminderSpec;
  /** Already-fired reminders are historical and left untouched by an edit. */
  hasFired: boolean;
}

export type RescheduleAction =
  | { action: "keep"; id: string; newFireAt: Date }
  | {
      action: "remove";
      id: string;
      reason: "fire-time-in-past" | "at-or-after-due-date" | "already-in-past";
    }
  | { action: "unchanged"; id: string };

/**
 * Applies 03-business-rules.md §7's due-date-edit reschedule rule to every
 * still-pending reminder attached to a task. Pure — the caller (repository
 * layer, Phase 4) is responsible for actually cancelling/rescheduling the
 * underlying OS notifications and updating/deleting reminder rows based on
 * each returned action.
 */
export function rescheduleOnDueDateChange(
  reminders: ReschedulableReminder[],
  newDueDateTime: Date,
  now: Date,
): RescheduleAction[] {
  return reminders.map((reminder): RescheduleAction => {
    if (reminder.hasFired) {
      return { action: "unchanged", id: reminder.id };
    }

    if (reminder.spec.kind === "relative") {
      const newFireAt = computeFireAt(reminder.spec, newDueDateTime);
      if (newFireAt.getTime() <= now.getTime()) {
        return { action: "remove", id: reminder.id, reason: "fire-time-in-past" };
      }
      return { action: "keep", id: reminder.id, newFireAt };
    }

    // Fixed reminder: absolute, doesn't move with the due date, but is
    // validated against it.
    const { fixedDateTime } = reminder.spec;
    if (fixedDateTime.getTime() <= now.getTime()) {
      return { action: "remove", id: reminder.id, reason: "already-in-past" };
    }
    if (fixedDateTime.getTime() >= newDueDateTime.getTime()) {
      return { action: "remove", id: reminder.id, reason: "at-or-after-due-date" };
    }
    return { action: "keep", id: reminder.id, newFireAt: new Date(fixedDateTime.getTime()) };
  });
}
