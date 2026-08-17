/**
 * 03-business-rules.md §16: Calendar day indicators. §16 leaves exact
 * multi-task-per-day visual treatment as an implementation decision; this
 * module's resolved choice: one dot per distinct priority present that day
 * (Alta > Media > Baja, deduped — not one dot per task). §16 also states no
 * completed-task exclusion for the day indicator/panel, unlike §15's
 * Dashboard widgets — so entries include completed tasks. Week starts on
 * Monday (ISO 8601 convention; not specified by §16 or the roadmap).
 */
import { buildCalendarMonth } from "../calendar";
import type { DashboardEntry } from "../dashboard";
import type { Task } from "@/db/schema/task";

let taskCounter = 0;

function makeTask(overrides: Partial<Task> = {}): Task {
  taskCounter += 1;
  return {
    id: overrides.id ?? `task-${taskCounter}`,
    title: overrides.title ?? "Tarea",
    description: null,
    subjectId: "subject-1",
    dueDateTime: overrides.dueDateTime ?? new Date(2026, 7, 15, 10, 0),
    priority: overrides.priority ?? "Media",
    completed: overrides.completed ?? false,
    completedAt: overrides.completedAt ?? null,
    completedLate: false,
    createdAt: new Date(2026, 7, 1),
    updatedAt: new Date(2026, 7, 1),
  };
}

function entry(task: Task, status: DashboardEntry["status"] = "Pendiente"): DashboardEntry {
  return { task, status };
}

describe("buildCalendarMonth", () => {
  it("returns a grid starting on Monday, with leading days from the prior month marked isCurrentMonth: false", () => {
    // August 2026 (month index 7) starts on a Saturday.
    const days = buildCalendarMonth([], 2026, 7);
    expect(days[0].date.getDay()).toBe(1); // Monday
    expect(days[0].date.getMonth()).toBe(6); // July (leading day)
    expect(days[0].isCurrentMonth).toBe(false);
  });

  it("ends the grid on a Sunday, with trailing days from the next month completing the last week", () => {
    const days = buildCalendarMonth([], 2026, 7);
    const last = days[days.length - 1];
    expect(last.date.getDay()).toBe(0); // Sunday
    expect(days.length % 7).toBe(0);
  });

  it("produces exactly 28 cells (4 weeks) when the month starts on a Monday and has exactly 4 weeks of days", () => {
    // February 2027 (month index 1): 28 days, starts on a Monday.
    const days = buildCalendarMonth([], 2027, 1);
    expect(days.length).toBe(28);
  });

  it("produces 42 cells (6 weeks) when the month needs a 6th row", () => {
    // August 2026 (month index 7): 31 days, starts on a Saturday.
    const days = buildCalendarMonth([], 2026, 7);
    expect(days.length).toBe(42);
  });

  it("assigns one dot per distinct priority present that day, ordered Alta > Media > Baja, deduped across multiple same-priority tasks", () => {
    const entries = [
      entry(makeTask({ dueDateTime: new Date(2026, 7, 15, 8, 0), priority: "Media" })),
      entry(makeTask({ dueDateTime: new Date(2026, 7, 15, 9, 0), priority: "Media" })),
      entry(makeTask({ dueDateTime: new Date(2026, 7, 15, 20, 0), priority: "Alta" })),
    ];
    const days = buildCalendarMonth(entries, 2026, 7);
    const cell = days.find((d) => d.isCurrentMonth && d.date.getDate() === 15)!;
    expect(cell.priorityDots).toEqual(["Alta", "Media"]);
    expect(cell.entries).toHaveLength(3);
  });

  it("gives a day with no tasks an empty dots array and empty entries", () => {
    const days = buildCalendarMonth([], 2026, 7);
    const cell = days.find((d) => d.isCurrentMonth && d.date.getDate() === 15)!;
    expect(cell.priorityDots).toEqual([]);
    expect(cell.entries).toEqual([]);
  });

  it("includes a completed task in a day's dots and entries (no completion filter, unlike the Dashboard's widgets)", () => {
    const entries = [
      entry(
        makeTask({
          dueDateTime: new Date(2026, 7, 15, 10, 0),
          priority: "Baja",
          completed: true,
          completedAt: new Date(2026, 7, 15, 11, 0),
        }),
        "Completada",
      ),
    ];
    const days = buildCalendarMonth(entries, 2026, 7);
    const cell = days.find((d) => d.isCurrentMonth && d.date.getDate() === 15)!;
    expect(cell.priorityDots).toEqual(["Baja"]);
    expect(cell.entries).toHaveLength(1);
  });

  it("assigns a task due on the last day of the previous month to that leading grid cell, not to the 1st of the current month", () => {
    // July 31, 2026 is a Friday — a leading cell in August 2026's grid.
    const entries = [
      entry(makeTask({ dueDateTime: new Date(2026, 6, 31, 23, 0), priority: "Alta" })),
    ];
    const days = buildCalendarMonth(entries, 2026, 7);
    const leadingCell = days.find((d) => d.date.getMonth() === 6 && d.date.getDate() === 31)!;
    const firstOfMonth = days.find((d) => d.isCurrentMonth && d.date.getDate() === 1)!;
    expect(leadingCell.isCurrentMonth).toBe(false);
    expect(leadingCell.priorityDots).toEqual(["Alta"]);
    expect(firstOfMonth.entries).toEqual([]);
  });

  it("sorts a day's entries by dueDateTime ascending", () => {
    const entries = [
      entry(makeTask({ id: "late", dueDateTime: new Date(2026, 7, 15, 20, 0) })),
      entry(makeTask({ id: "early", dueDateTime: new Date(2026, 7, 15, 8, 0) })),
    ];
    const days = buildCalendarMonth(entries, 2026, 7);
    const cell = days.find((d) => d.isCurrentMonth && d.date.getDate() === 15)!;
    expect(cell.entries.map((e) => e.task.id)).toEqual(["early", "late"]);
  });
});
