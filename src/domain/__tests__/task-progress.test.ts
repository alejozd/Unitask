import { calculateTaskProgress } from "@/domain/task-progress";

describe("calculateTaskProgress", () => {
  it("returns 0 for a task with zero subtasks and not completed", () => {
    expect(calculateTaskProgress([], false)).toBe(0);
  });

  it("returns 100 for a task with zero subtasks and completed", () => {
    expect(calculateTaskProgress([], true)).toBe(100);
  });

  it("returns 0 when no subtasks are completed", () => {
    const subtasks = [{ completed: false }, { completed: false }];
    expect(calculateTaskProgress(subtasks, false)).toBe(0);
  });

  it("returns 100 when all subtasks are completed", () => {
    const subtasks = [{ completed: true }, { completed: true }];
    expect(calculateTaskProgress(subtasks, false)).toBe(100);
  });

  it("returns a rounded percentage for partial completion", () => {
    // 1 of 3 = 33.33...% -> rounds to 33
    const subtasks = [{ completed: true }, { completed: false }, { completed: false }];
    expect(calculateTaskProgress(subtasks, false)).toBe(33);
  });

  it("rounds 2 of 3 (66.66...%) up to 67", () => {
    const subtasks = [{ completed: true }, { completed: true }, { completed: false }];
    expect(calculateTaskProgress(subtasks, false)).toBe(67);
  });
});
