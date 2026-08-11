import { deriveTaskStatus } from "@/domain/task-status";

describe("deriveTaskStatus", () => {
  const future = new Date("2026-06-01T12:00:00.000Z");
  const past = new Date("2026-01-01T12:00:00.000Z");
  const now = new Date("2026-03-01T12:00:00.000Z");

  it("returns Completada when completed is true, regardless of due date or progress", () => {
    expect(deriveTaskStatus({ completed: true, dueDateTime: past, progress: 0, now })).toBe(
      "Completada",
    );
    expect(deriveTaskStatus({ completed: true, dueDateTime: future, progress: 50, now })).toBe(
      "Completada",
    );
  });

  it("returns Vencida when not completed and due date is in the past", () => {
    expect(deriveTaskStatus({ completed: false, dueDateTime: past, progress: 0, now })).toBe(
      "Vencida",
    );
  });

  it("returns Vencida even with partial progress — Vencida takes priority over En progreso", () => {
    expect(deriveTaskStatus({ completed: false, dueDateTime: past, progress: 60, now })).toBe(
      "Vencida",
    );
  });

  it("returns Pendiente when not completed, due date is in the future, and progress is 0", () => {
    expect(deriveTaskStatus({ completed: false, dueDateTime: future, progress: 0, now })).toBe(
      "Pendiente",
    );
  });

  it("returns En progreso when not completed, due date is in the future, and progress is between 0 and 100", () => {
    expect(deriveTaskStatus({ completed: false, dueDateTime: future, progress: 40, now })).toBe(
      "En progreso",
    );
  });

  it("treats dueDateTime exactly equal to now as NOT overdue (boundary condition)", () => {
    const exactlyNow = new Date(now.getTime());
    expect(deriveTaskStatus({ completed: false, dueDateTime: exactlyNow, progress: 0, now })).toBe(
      "Pendiente",
    );
  });

  it("defaults `now` to the current time when not provided", () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
    expect(deriveTaskStatus({ completed: false, dueDateTime: farFuture, progress: 0 })).toBe(
      "Pendiente",
    );
  });
});
