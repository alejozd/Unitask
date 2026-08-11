import { completeTask } from "@/domain/task-completion";

describe("completeTask", () => {
  it("marks completed true and sets completedAt to now when now is not provided", () => {
    const before = Date.now();
    const result = completeTask({
      dueDateTime: new Date("2026-06-01T12:00:00.000Z"),
      subtasks: [],
    });
    const after = Date.now();

    expect(result.completed).toBe(true);
    expect(result.completedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.completedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("sets completedLate to false when completed on or before the due date", () => {
    const dueDateTime = new Date("2026-06-01T12:00:00.000Z");
    const now = new Date("2026-06-01T11:00:00.000Z");
    const result = completeTask({ dueDateTime, now, subtasks: [] });
    expect(result.completedLate).toBe(false);
  });

  it("sets completedLate to true when completed after the due date", () => {
    const dueDateTime = new Date("2026-06-01T12:00:00.000Z");
    const now = new Date("2026-06-02T00:00:00.000Z");
    const result = completeTask({ dueDateTime, now, subtasks: [] });
    expect(result.completedLate).toBe(true);
  });

  it("sets completedLate to false when completed at exactly the due date instant", () => {
    const dueDateTime = new Date("2026-06-01T12:00:00.000Z");
    const now = new Date(dueDateTime.getTime());
    const result = completeTask({ dueDateTime, now, subtasks: [] });
    expect(result.completedLate).toBe(false);
  });

  it("returns the ids of subtasks that still need to be force-checked", () => {
    const result = completeTask({
      dueDateTime: new Date("2026-06-01T12:00:00.000Z"),
      now: new Date("2026-05-01T00:00:00.000Z"),
      subtasks: [
        { id: "st-1", completed: true },
        { id: "st-2", completed: false },
        { id: "st-3", completed: false },
      ],
    });
    expect(result.subtaskIdsToCheck).toEqual(["st-2", "st-3"]);
  });

  it("returns an empty subtaskIdsToCheck array when all subtasks are already completed", () => {
    const result = completeTask({
      dueDateTime: new Date("2026-06-01T12:00:00.000Z"),
      now: new Date("2026-05-01T00:00:00.000Z"),
      subtasks: [{ id: "st-1", completed: true }],
    });
    expect(result.subtaskIdsToCheck).toEqual([]);
  });

  it("returns an empty subtaskIdsToCheck array when the task has no subtasks", () => {
    const result = completeTask({
      dueDateTime: new Date("2026-06-01T12:00:00.000Z"),
      now: new Date("2026-05-01T00:00:00.000Z"),
      subtasks: [],
    });
    expect(result.subtaskIdsToCheck).toEqual([]);
  });
});
