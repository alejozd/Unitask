import { checkSubjectDeletion } from "@/domain/subject-deletion";

describe("checkSubjectDeletion", () => {
  it("allows deletion when the subject has no tasks at all", () => {
    const result = checkSubjectDeletion([]);
    expect(result.allowed).toBe(true);
    expect(result.blockingTaskCount).toBe(0);
    expect(result.cascadeDeleteTaskIds).toEqual([]);
  });

  it("allows deletion when the subject has only Completada tasks, and cascades their deletion", () => {
    const result = checkSubjectDeletion([
      { id: "t-1", status: "Completada" },
      { id: "t-2", status: "Completada" },
    ]);
    expect(result.allowed).toBe(true);
    expect(result.blockingTaskCount).toBe(0);
    expect(result.cascadeDeleteTaskIds).toEqual(["t-1", "t-2"]);
  });

  it("blocks deletion when the subject has a Pendiente task, and reports the correct count", () => {
    const result = checkSubjectDeletion([
      { id: "t-1", status: "Completada" },
      { id: "t-2", status: "Pendiente" },
    ]);
    expect(result.allowed).toBe(false);
    expect(result.blockingTaskCount).toBe(1);
    expect(result.cascadeDeleteTaskIds).toBeUndefined();
  });

  it("blocks deletion when the subject has an En progreso task", () => {
    const result = checkSubjectDeletion([{ id: "t-1", status: "En progreso" }]);
    expect(result.allowed).toBe(false);
    expect(result.blockingTaskCount).toBe(1);
  });

  it("does NOT block deletion for a Vencida task — only Pendiente/En progreso block (03-business-rules.md §12)", () => {
    const result = checkSubjectDeletion([{ id: "t-1", status: "Vencida" }]);
    expect(result.allowed).toBe(true);
    expect(result.blockingTaskCount).toBe(0);
    expect(result.cascadeDeleteTaskIds).toEqual(["t-1"]);
  });

  it("counts every blocking task, not just whether any exist", () => {
    const result = checkSubjectDeletion([
      { id: "t-1", status: "Pendiente" },
      { id: "t-2", status: "En progreso" },
      { id: "t-3", status: "Pendiente" },
      { id: "t-4", status: "Completada" },
    ]);
    expect(result.allowed).toBe(false);
    expect(result.blockingTaskCount).toBe(3);
  });
});
