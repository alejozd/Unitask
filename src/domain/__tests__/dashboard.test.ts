// 03-business-rules.md §15: Dashboard widget criteria — Pendientes/Hoy/
// Completadas últimos 7 días stat counts, Tareas urgentes, Próximas
// entregas, and the greeting shown at the top of the dashboard.
import type { Task } from "@/db/schema/task";
import { buildDashboardSummary, greetingForHour, type DashboardEntry } from "@/domain/dashboard";
import type { TaskStatus } from "@/domain/task-status";

// "Hoy" is a local calendar-day match, not a UTC one, so `now` and the
// hoyCount fixtures below use the local-time Date constructor (not ISO UTC
// strings) to stay correct regardless of the machine/CI timezone running
// the suite.
const now = new Date(2026, 5, 15, 12, 0, 0);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Task",
    description: null,
    subjectId: "subject-1",
    dueDateTime: new Date("2026-06-20T12:00:00.000Z"),
    priority: "Media",
    completed: false,
    completedAt: null,
    completedLate: false,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function entry(taskOverrides: Partial<Task>, status: TaskStatus): DashboardEntry {
  return { task: makeTask(taskOverrides), status };
}

function hoursFromNow(hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

describe("buildDashboardSummary", () => {
  describe("pendientesCount", () => {
    it("counts only entries with status Pendiente", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "p1" }, "Pendiente"),
        entry({ id: "p2" }, "Pendiente"),
        entry({ id: "ep" }, "En progreso"),
        entry({ id: "v" }, "Vencida"),
        entry({ id: "c", completed: true }, "Completada"),
      ];
      expect(buildDashboardSummary(entries, now).pendientesCount).toBe(2);
    });
  });

  describe("hoyCount", () => {
    it("counts a not-completed task due today regardless of time-of-day already passed", () => {
      const dueEarlierToday = new Date(2026, 5, 15, 6, 0, 0);
      const entries: DashboardEntry[] = [entry({ dueDateTime: dueEarlierToday }, "Vencida")];
      expect(buildDashboardSummary(entries, now).hoyCount).toBe(1);
    });

    it("counts a Vencida-today task (overdue earlier today, still not completed)", () => {
      const dueEarlierToday = new Date(2026, 5, 15, 0, 0, 1);
      const entries: DashboardEntry[] = [entry({ dueDateTime: dueEarlierToday }, "Vencida")];
      expect(buildDashboardSummary(entries, now).hoyCount).toBe(1);
    });

    it("excludes a completed task due today", () => {
      const dueToday = new Date(2026, 5, 15, 18, 0, 0);
      const entries: DashboardEntry[] = [
        entry({ dueDateTime: dueToday, completed: true }, "Completada"),
      ];
      expect(buildDashboardSummary(entries, now).hoyCount).toBe(0);
    });

    it("excludes a task due tomorrow", () => {
      const dueTomorrow = new Date(2026, 5, 16, 1, 0, 0);
      const entries: DashboardEntry[] = [entry({ dueDateTime: dueTomorrow }, "Pendiente")];
      expect(buildDashboardSummary(entries, now).hoyCount).toBe(0);
    });
  });

  describe("completadasUltimos7DiasCount", () => {
    it("counts a task completed exactly 7 days ago (boundary, inclusive)", () => {
      const exactly7DaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const entries: DashboardEntry[] = [
        entry({ completed: true, completedAt: exactly7DaysAgo }, "Completada"),
      ];
      expect(buildDashboardSummary(entries, now).completadasUltimos7DiasCount).toBe(1);
    });

    it("excludes a task completed 7 days + 1 second ago", () => {
      const justOver7DaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000 + 1000));
      const entries: DashboardEntry[] = [
        entry({ completed: true, completedAt: justOver7DaysAgo }, "Completada"),
      ];
      expect(buildDashboardSummary(entries, now).completadasUltimos7DiasCount).toBe(0);
    });

    it("excludes a completed task with a null completedAt", () => {
      const entries: DashboardEntry[] = [
        entry({ completed: true, completedAt: null }, "Completada"),
      ];
      expect(buildDashboardSummary(entries, now).completadasUltimos7DiasCount).toBe(0);
    });
  });

  describe("urgentEntries", () => {
    it("includes a Media-priority task due in 10 hours (within the ≤48h window)", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "t", priority: "Media", dueDateTime: hoursFromNow(10) }, "Pendiente"),
      ];
      const result = buildDashboardSummary(entries, now);
      expect(result.urgentEntries.map((e) => e.task.id)).toEqual(["t"]);
    });

    it("includes a Media-priority task due in 30 hours (within the ≤48h window)", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "t", priority: "Media", dueDateTime: hoursFromNow(30) }, "Pendiente"),
      ];
      const result = buildDashboardSummary(entries, now);
      expect(result.urgentEntries.map((e) => e.task.id)).toEqual(["t"]);
    });

    it("excludes a Media-priority task due in 60 hours (outside the window)", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "t", priority: "Media", dueDateTime: hoursFromNow(60) }, "Pendiente"),
      ];
      expect(buildDashboardSummary(entries, now).urgentEntries).toEqual([]);
    });

    it("includes an Alta-priority task due in 2 weeks (priority-only branch)", () => {
      const dueIn2Weeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const entries: DashboardEntry[] = [
        entry({ id: "t", priority: "Alta", dueDateTime: dueIn2Weeks }, "Pendiente"),
      ];
      const result = buildDashboardSummary(entries, now);
      expect(result.urgentEntries.map((e) => e.task.id)).toEqual(["t"]);
    });

    it("excludes an already-overdue (Vencida) Media-priority task", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "t", priority: "Media", dueDateTime: hoursFromNow(-5) }, "Vencida"),
      ];
      expect(buildDashboardSummary(entries, now).urgentEntries).toEqual([]);
    });

    it("includes an overdue Alta-priority task (priority-only branch still applies)", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "t", priority: "Alta", dueDateTime: hoursFromNow(-5) }, "Vencida"),
      ];
      const result = buildDashboardSummary(entries, now);
      expect(result.urgentEntries.map((e) => e.task.id)).toEqual(["t"]);
    });

    it("sorts by dueDateTime ascending, independent of caller order (overdue Alta ahead of near-due Media)", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "media-soon", priority: "Media", dueDateTime: hoursFromNow(10) }, "Pendiente"),
        entry({ id: "alta-overdue", priority: "Alta", dueDateTime: hoursFromNow(-5) }, "Vencida"),
        entry({ id: "alta-later", priority: "Alta", dueDateTime: hoursFromNow(30) }, "Pendiente"),
      ];
      const result = buildDashboardSummary(entries, now);
      expect(result.urgentEntries.map((e) => e.task.id)).toEqual([
        "alta-overdue",
        "media-soon",
        "alta-later",
      ]);
    });

    it("excludes a completed task that would otherwise match either condition", () => {
      const entries: DashboardEntry[] = [
        entry(
          { id: "t1", priority: "Alta", dueDateTime: hoursFromNow(10), completed: true },
          "Completada",
        ),
        entry(
          { id: "t2", priority: "Media", dueDateTime: hoursFromNow(10), completed: true },
          "Completada",
        ),
      ];
      expect(buildDashboardSummary(entries, now).urgentEntries).toEqual([]);
    });
  });

  describe("proximasEntregas", () => {
    it("returns at most 5 entries sorted by dueDateTime ascending", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "a", dueDateTime: hoursFromNow(120) }, "Pendiente"),
        entry({ id: "b", dueDateTime: hoursFromNow(10) }, "Pendiente"),
        entry({ id: "c", dueDateTime: hoursFromNow(50) }, "Pendiente"),
        entry({ id: "d", dueDateTime: hoursFromNow(30) }, "Pendiente"),
        entry({ id: "e", dueDateTime: hoursFromNow(200) }, "Pendiente"),
        entry({ id: "f", dueDateTime: hoursFromNow(5) }, "Pendiente"),
      ];
      const result = buildDashboardSummary(entries, now);
      expect(result.proximasEntregas).toHaveLength(5);
      expect(result.proximasEntregas.map((e) => e.task.id)).toEqual(["f", "b", "d", "c", "a"]);
    });

    it("excludes completed tasks", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "a", dueDateTime: hoursFromNow(10), completed: true }, "Completada"),
        entry({ id: "b", dueDateTime: hoursFromNow(20) }, "Pendiente"),
      ];
      const result = buildDashboardSummary(entries, now);
      expect(result.proximasEntregas.map((e) => e.task.id)).toEqual(["b"]);
    });

    it("includes a Vencida task if it's among the 5 nearest", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "v", dueDateTime: hoursFromNow(-5) }, "Vencida"),
        entry({ id: "b", dueDateTime: hoursFromNow(20) }, "Pendiente"),
      ];
      const result = buildDashboardSummary(entries, now);
      expect(result.proximasEntregas.map((e) => e.task.id)).toEqual(["v", "b"]);
    });

    it("returns fewer than 5 when fewer than 5 pending tasks exist", () => {
      const entries: DashboardEntry[] = [
        entry({ id: "a", dueDateTime: hoursFromNow(10) }, "Pendiente"),
        entry({ id: "b", dueDateTime: hoursFromNow(20) }, "Pendiente"),
      ];
      const result = buildDashboardSummary(entries, now);
      expect(result.proximasEntregas).toHaveLength(2);
    });
  });
});

describe("greetingForHour", () => {
  // Boundary hours are this task's own assumption (not specified in
  // 03-business-rules.md §15 or 11-roadmap.md): morning is [0, 12),
  // afternoon is [12, 19), evening is [19, 24).
  it("returns the morning greeting just before the morning/afternoon boundary (11)", () => {
    expect(greetingForHour(11)).toBe("Buenos días");
  });

  it("returns the afternoon greeting exactly at the morning/afternoon boundary (12)", () => {
    expect(greetingForHour(12)).toBe("Buenas tardes");
  });

  it("returns the afternoon greeting just before the afternoon/evening boundary (18)", () => {
    expect(greetingForHour(18)).toBe("Buenas tardes");
  });

  it("returns the evening greeting exactly at the afternoon/evening boundary (19)", () => {
    expect(greetingForHour(19)).toBe("Buenas noches");
  });

  it("returns the evening greeting at the end of the day (23)", () => {
    expect(greetingForHour(23)).toBe("Buenas noches");
  });

  it("returns the morning greeting at the start of the day (0)", () => {
    expect(greetingForHour(0)).toBe("Buenos días");
  });
});
