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
  // Phase 9.5: each range now has a pool of 2-3 messages, chosen via an
  // injectable `random` function (defaults to Math.random) so tests can
  // force a specific pick instead of asserting on real randomness.
  const NO_TASKS_MESSAGES = [
    "Aún no tienes tareas registradas. ¡Empieza creando tu primera tarea!",
    "Tu semestre está listo para comenzar. ¡Agrega tu primera tarea!",
  ];
  const HIGH_PERFORMANCE_MESSAGES = [
    "¡Excelente ritmo! Sigue así.",
    "¡Vas muy bien! Tu constancia se nota.",
    "¡Impresionante! Estás dominando tus tareas.",
  ];
  const MID_PERFORMANCE_MESSAGES = [
    "¡Vas por buen camino! Tómate un respiro antes de continuar con tus pendientes.",
    "Buen avance. Sigue empujando tus pendientes.",
  ];
  const LOW_PERFORMANCE_MESSAGES = [
    "Aún te queda camino por recorrer, pero cada tarea completada suma. ¡Tú puedes!",
    "Un paso a la vez. Cada tarea que completes cuenta.",
    "No te desanimes, siempre puedes retomar el ritmo.",
  ];

  it("picks the first pool entry when random() returns 0, for each range", () => {
    expect(encouragementMessage(0, 0, () => 0)).toBe(NO_TASKS_MESSAGES[0]);
    expect(encouragementMessage(90, 10, () => 0)).toBe(HIGH_PERFORMANCE_MESSAGES[0]);
    expect(encouragementMessage(60, 10, () => 0)).toBe(MID_PERFORMANCE_MESSAGES[0]);
    expect(encouragementMessage(20, 10, () => 0)).toBe(LOW_PERFORMANCE_MESSAGES[0]);
  });

  it("picks the last pool entry when random() returns just under 1, for each range", () => {
    expect(encouragementMessage(0, 0, () => 0.999)).toBe(
      NO_TASKS_MESSAGES[NO_TASKS_MESSAGES.length - 1],
    );
    expect(encouragementMessage(90, 10, () => 0.999)).toBe(
      HIGH_PERFORMANCE_MESSAGES[HIGH_PERFORMANCE_MESSAGES.length - 1],
    );
    expect(encouragementMessage(60, 10, () => 0.999)).toBe(
      MID_PERFORMANCE_MESSAGES[MID_PERFORMANCE_MESSAGES.length - 1],
    );
    expect(encouragementMessage(20, 10, () => 0.999)).toBe(
      LOW_PERFORMANCE_MESSAGES[LOW_PERFORMANCE_MESSAGES.length - 1],
    );
  });

  it("clamps a random() of exactly 1 to the last pool entry instead of going out of bounds", () => {
    expect(encouragementMessage(90, 10, () => 1)).toBe(
      HIGH_PERFORMANCE_MESSAGES[HIGH_PERFORMANCE_MESSAGES.length - 1],
    );
  });

  it("selects a middle entry for a mid-range random() value (proves real index math, not always first/last)", () => {
    // 3-item pool, random() = 0.5 -> floor(0.5 * 3) = index 1
    expect(encouragementMessage(90, 10, () => 0.5)).toBe(HIGH_PERFORMANCE_MESSAGES[1]);
  });

  it("selects from the high-performance pool at and above 80% (with at least one task)", () => {
    expect(HIGH_PERFORMANCE_MESSAGES).toContain(encouragementMessage(80, 10));
    expect(HIGH_PERFORMANCE_MESSAGES).toContain(encouragementMessage(100, 5));
  });

  it("selects from the mid-performance pool between 50% and 79%", () => {
    expect(MID_PERFORMANCE_MESSAGES).toContain(encouragementMessage(50, 10));
    expect(MID_PERFORMANCE_MESSAGES).toContain(encouragementMessage(79, 10));
  });

  it("selects from the low-performance pool below 50% when there IS at least one task (0% with real tasks differs from 0 tasks tracked)", () => {
    expect(LOW_PERFORMANCE_MESSAGES).toContain(encouragementMessage(0, 3));
    expect(LOW_PERFORMANCE_MESSAGES).toContain(encouragementMessage(49, 10));
  });

  it("selects from the no-tasks pool when totalCount is 0, regardless of the (always-0) rate, using the default random source", () => {
    expect(NO_TASKS_MESSAGES).toContain(encouragementMessage(0, 0));
  });
});
