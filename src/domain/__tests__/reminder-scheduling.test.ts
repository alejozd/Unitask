import {
  computeFireAt,
  defaultReminder,
  rescheduleOnDueDateChange,
} from "@/domain/reminder-scheduling";

describe("computeFireAt", () => {
  const dueDateTime = new Date("2026-06-10T12:00:00.000Z");

  it("computes a relative reminder's fire time as dueDateTime minus the offset (days)", () => {
    const fireAt = computeFireAt(
      { kind: "relative", offsetValue: 1, offsetUnit: "days" },
      dueDateTime,
    );
    expect(fireAt).toEqual(new Date("2026-06-09T12:00:00.000Z"));
  });

  it("computes a relative reminder's fire time in hours", () => {
    const fireAt = computeFireAt(
      { kind: "relative", offsetValue: 2, offsetUnit: "hours" },
      dueDateTime,
    );
    expect(fireAt).toEqual(new Date("2026-06-10T10:00:00.000Z"));
  });

  it("computes a relative reminder's fire time in minutes", () => {
    const fireAt = computeFireAt(
      { kind: "relative", offsetValue: 15, offsetUnit: "minutes" },
      dueDateTime,
    );
    expect(fireAt).toEqual(new Date("2026-06-10T11:45:00.000Z"));
  });

  it("returns the fixed datetime unchanged for a fixed reminder", () => {
    const fixedDateTime = new Date("2026-06-05T09:00:00.000Z");
    const fireAt = computeFireAt({ kind: "fixed", fixedDateTime }, dueDateTime);
    expect(fireAt).toEqual(fixedDateTime);
  });
});

describe("defaultReminder", () => {
  it("returns a relative reminder of 1 day before", () => {
    expect(defaultReminder()).toEqual({ kind: "relative", offsetValue: 1, offsetUnit: "days" });
  });
});

describe("rescheduleOnDueDateChange", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const newDueDateTime = new Date("2026-06-10T12:00:00.000Z");

  it("leaves already-fired reminders unchanged", () => {
    const actions = rescheduleOnDueDateChange(
      [
        {
          id: "r-1",
          spec: { kind: "relative", offsetValue: 1, offsetUnit: "days" },
          hasFired: true,
        },
      ],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([{ action: "unchanged", id: "r-1" }]);
  });

  it("recomputes and keeps a relative reminder whose new fire time is still in the future", () => {
    const actions = rescheduleOnDueDateChange(
      [
        {
          id: "r-2",
          spec: { kind: "relative", offsetValue: 1, offsetUnit: "days" },
          hasFired: false,
        },
      ],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([
      { action: "keep", id: "r-2", newFireAt: new Date("2026-06-09T12:00:00.000Z") },
    ]);
  });

  it("removes a relative reminder whose recomputed fire time is now in the past", () => {
    // now = 2026-06-01, new due date = 2026-06-02, offset = 3 days before
    // -> new fire time = 2026-05-30, which is before `now`.
    const soonDueDateTime = new Date("2026-06-02T00:00:00.000Z");
    const actions = rescheduleOnDueDateChange(
      [
        {
          id: "r-3",
          spec: { kind: "relative", offsetValue: 3, offsetUnit: "days" },
          hasFired: false,
        },
      ],
      soonDueDateTime,
      now,
    );
    expect(actions).toEqual([{ action: "remove", id: "r-3", reason: "fire-time-in-past" }]);
  });

  it("keeps a fixed reminder that is still before the new due date and still in the future", () => {
    const fixedDateTime = new Date("2026-06-05T00:00:00.000Z");
    const actions = rescheduleOnDueDateChange(
      [{ id: "r-4", spec: { kind: "fixed", fixedDateTime }, hasFired: false }],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([{ action: "keep", id: "r-4", newFireAt: fixedDateTime }]);
  });

  it("removes a fixed reminder that is at/after the new due date", () => {
    const fixedDateTime = new Date("2026-06-11T00:00:00.000Z"); // after newDueDateTime
    const actions = rescheduleOnDueDateChange(
      [{ id: "r-5", spec: { kind: "fixed", fixedDateTime }, hasFired: false }],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([{ action: "remove", id: "r-5", reason: "at-or-after-due-date" }]);
  });

  it("removes a fixed reminder that is already in the past relative to now", () => {
    const fixedDateTime = new Date("2026-05-01T00:00:00.000Z"); // before `now`
    const actions = rescheduleOnDueDateChange(
      [{ id: "r-6", spec: { kind: "fixed", fixedDateTime }, hasFired: false }],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([{ action: "remove", id: "r-6", reason: "already-in-past" }]);
  });

  it("processes multiple reminders independently in one call", () => {
    const actions = rescheduleOnDueDateChange(
      [
        {
          id: "r-7",
          spec: { kind: "relative", offsetValue: 1, offsetUnit: "days" },
          hasFired: false,
        },
        {
          id: "r-8",
          spec: { kind: "fixed", fixedDateTime: new Date("2026-05-01T00:00:00.000Z") },
          hasFired: false,
        },
      ],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([
      { action: "keep", id: "r-7", newFireAt: new Date("2026-06-09T12:00:00.000Z") },
      { action: "remove", id: "r-8", reason: "already-in-past" },
    ]);
  });
});
