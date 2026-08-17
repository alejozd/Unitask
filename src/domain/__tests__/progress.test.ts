/**
 * 01-product.md: "Progress screen: statistics derived from task/subtask
 * completion." 11-roadmap.md's Phase 8 section. No 03-business-rules.md
 * section number exists for this screen specifically — statuses reused
 * here (Pendiente/En progreso/Completada/Vencida) are governed by §1.
 */
import { buildProgressSummary, encouragementMessage } from "../progress";
import type { DashboardEntry } from "../dashboard";
import type { Task } from "@/db/schema/task";
import type { Subject } from "@/db/schema/subject";

let taskCounter = 0;

function makeTask(overrides: Partial<Task> = {}): Task {
  taskCounter += 1;
  return {
    id: overrides.id ?? `task-${taskCounter}`,
    title: overrides.title ?? "Tarea",
    description: null,
    subjectId: overrides.subjectId ?? "subject-1",
    dueDateTime: overrides.dueDateTime ?? new Date(2026, 7, 15, 10, 0),
    priority: overrides.priority ?? "Media",
    completed: overrides.completed ?? false,
    completedAt: overrides.completedAt ?? null,
    completedLate: false,
    createdAt: new Date(2026, 7, 1),
    updatedAt: new Date(2026, 7, 1),
  };
}

function entry(task: Task, status: DashboardEntry["status"]): DashboardEntry {
  return { task, status };
}

function makeSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: overrides.id ?? "subject-1",
    name: overrides.name ?? "Materia",
    courseCode: null,
    professorName: null,
    color: overrides.color ?? "indigo",
    semesterId: "semester-1",
    createdAt: new Date(2026, 7, 1),
    updatedAt: new Date(2026, 7, 1),
  };
}

describe("buildProgressSummary", () => {
  it("counts each status bucket independently from a mixed set", () => {
    const entries = [
      entry(makeTask({ subjectId: "s1" }), "Completada"),
      entry(makeTask({ subjectId: "s1" }), "Completada"),
      entry(makeTask({ subjectId: "s1" }), "En progreso"),
      entry(makeTask({ subjectId: "s1" }), "Pendiente"),
      entry(makeTask({ subjectId: "s1" }), "Vencida"),
    ];
    const summary = buildProgressSummary(entries, [makeSubject({ id: "s1" })]);
    expect(summary.completadasCount).toBe(2);
    expect(summary.enProgresoCount).toBe(1);
    expect(summary.pendientesCount).toBe(1);
    expect(summary.vencidasCount).toBe(1);
    expect(summary.totalCount).toBe(5);
  });

  it("computes overallCompletionRate as a rounded percentage of completed over total", () => {
    const entries = [
      entry(makeTask({ subjectId: "s1" }), "Completada"),
      entry(makeTask({ subjectId: "s1" }), "Pendiente"),
      entry(makeTask({ subjectId: "s1" }), "Pendiente"),
    ];
    const summary = buildProgressSummary(entries, [makeSubject({ id: "s1" })]);
    expect(summary.overallCompletionRate).toBe(33); // 1/3 = 33.33... -> 33
  });

  it("returns exactly 0 (never NaN) for overallCompletionRate when there are zero tasks", () => {
    const summary = buildProgressSummary([], [makeSubject({ id: "s1" })]);
    expect(summary.overallCompletionRate).toBe(0);
    expect(Number.isNaN(summary.overallCompletionRate)).toBe(false);
    expect(summary.totalCount).toBe(0);
  });

  it("groups bySubject with correct per-subject counts and rounded rates", () => {
    const entries = [
      entry(makeTask({ subjectId: "s1" }), "Completada"),
      entry(makeTask({ subjectId: "s1" }), "Completada"),
      entry(makeTask({ subjectId: "s1" }), "Pendiente"),
      entry(makeTask({ subjectId: "s2" }), "Completada"),
    ];
    const subjects = [
      makeSubject({ id: "s1", name: "Cálculo II", color: "indigo" }),
      makeSubject({ id: "s2", name: "Física", color: "amber" }),
    ];
    const summary = buildProgressSummary(entries, subjects);
    const calculo = summary.bySubject.find((s) => s.subjectId === "s1")!;
    expect(calculo.completedCount).toBe(2);
    expect(calculo.totalCount).toBe(3);
    expect(calculo.completionRate).toBe(67); // 2/3 = 66.66... -> 67
    const fisica = summary.bySubject.find((s) => s.subjectId === "s2")!;
    expect(fisica.completedCount).toBe(1);
    expect(fisica.totalCount).toBe(1);
    expect(fisica.completionRate).toBe(100);
  });

  it("excludes a subject with zero tasks from bySubject", () => {
    const entries = [entry(makeTask({ subjectId: "s1" }), "Completada")];
    const subjects = [
      makeSubject({ id: "s1", name: "Cálculo II" }),
      makeSubject({ id: "s2", name: "Sin tareas" }),
    ];
    const summary = buildProgressSummary(entries, subjects);
    expect(summary.bySubject).toHaveLength(1);
    expect(summary.bySubject[0].subjectId).toBe("s1");
  });

  it("sorts bySubject alphabetically by subject name", () => {
    const entries = [
      entry(makeTask({ subjectId: "s1" }), "Pendiente"),
      entry(makeTask({ subjectId: "s2" }), "Pendiente"),
      entry(makeTask({ subjectId: "s3" }), "Pendiente"),
    ];
    const subjects = [
      makeSubject({ id: "s1", name: "Zoología" }),
      makeSubject({ id: "s2", name: "Álgebra" }),
      makeSubject({ id: "s3", name: "Historia" }),
    ];
    const summary = buildProgressSummary(entries, subjects);
    expect(summary.bySubject.map((s) => s.subjectName)).toEqual([
      "Álgebra",
      "Historia",
      "Zoología",
    ]);
  });
});

describe("encouragementMessage", () => {
  it("shows a no-tasks-yet message when totalCount is 0, regardless of the (always-0) rate", () => {
    expect(encouragementMessage(0, 0)).toBe(
      "Aún no tienes tareas registradas. ¡Empieza creando tu primera tarea!",
    );
  });

  it("shows a high-performance message at and above 80% (with at least one task)", () => {
    expect(encouragementMessage(80, 10)).toBe("¡Excelente ritmo! Sigue así.");
    expect(encouragementMessage(100, 5)).toBe("¡Excelente ritmo! Sigue así.");
  });

  it("shows a mid-performance message between 50% and 79%", () => {
    expect(encouragementMessage(50, 10)).toBe(
      "¡Vas por buen camino! Tómate un respiro antes de continuar con tus pendientes.",
    );
    expect(encouragementMessage(79, 10)).toBe(
      "¡Vas por buen camino! Tómate un respiro antes de continuar con tus pendientes.",
    );
  });

  it("shows a low-performance encouragement message below 50% when there IS at least one task (0% with real tasks differs from 0 tasks tracked)", () => {
    expect(encouragementMessage(0, 3)).toBe(
      "Aún te queda camino por recorrer, pero cada tarea completada suma. ¡Tú puedes!",
    );
    expect(encouragementMessage(49, 10)).toBe(
      "Aún te queda camino por recorrer, pero cada tarea completada suma. ¡Tú puedes!",
    );
  });
});
