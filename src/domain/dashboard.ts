import type { Task } from "@/db/schema/task";
import type { TaskStatus } from "@/domain/task-status";

/** 03-business-rules.md §15: Completadas últimos 7 días is a rolling window,
 * not a fixed calendar week. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Resolved interpretation of "Tareas urgentes" (03-business-rules.md §15,
 * confirmed with product): due within the next 48 hours, one-sided
 * (`now < dueDateTime <= now + 48h`), OR priority is Alta regardless of the
 * time window (including already-overdue Alta tasks). */
const URGENT_WINDOW_MS = 48 * 60 * 60 * 1000;

/** 03-business-rules.md §15: Próximas entregas shows the N nearest pending
 * tasks by due date, N = 5. */
const PROXIMAS_ENTREGAS_LIMIT = 5;

export interface DashboardEntry {
  task: Task;
  status: TaskStatus;
}

export interface DashboardSummary {
  pendientesCount: number;
  hoyCount: number;
  completadasUltimos7DiasCount: number;
  urgentEntries: DashboardEntry[];
  proximasEntregas: DashboardEntry[];
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Builds the dashboard's stat counts and task lists from already-derived
 * entries (03-business-rules.md §15). Callers are responsible for deriving
 * `status` (via `deriveTaskStatus`/`calculateTaskProgress`) and for scoping
 * `entries` to the active semester before calling this — this module does
 * neither DB access nor status derivation, it only aggregates.
 */
export function buildDashboardSummary(
  entries: DashboardEntry[],
  now: Date = new Date(),
): DashboardSummary {
  const pendientesCount = entries.filter((entry) => entry.status === "Pendiente").length;

  // 03-business-rules.md §15: Hoy = due today (calendar-day match), not
  // completed. Deliberately not gated on status, so an overdue-but-due-today
  // (Vencida) task still counts.
  const hoyCount = entries.filter(
    (entry) => !entry.task.completed && isSameCalendarDay(entry.task.dueDateTime, now),
  ).length;

  // 03-business-rules.md §15: rolling 7-day window ending now, inclusive —
  // `now - 7 days <= completedAt <= now`.
  const completadasUltimos7DiasCount = entries.filter((entry) => {
    if (!entry.task.completed || entry.task.completedAt === null) {
      return false;
    }
    const completedAtMs = entry.task.completedAt.getTime();
    return completedAtMs >= now.getTime() - SEVEN_DAYS_MS && completedAtMs <= now.getTime();
  }).length;

  const urgentEntries = entries
    .filter((entry) => {
      if (entry.task.completed) {
        return false;
      }
      if (entry.task.priority === "Alta") {
        return true;
      }
      const dueMs = entry.task.dueDateTime.getTime();
      return dueMs > now.getTime() && dueMs <= now.getTime() + URGENT_WINDOW_MS;
    })
    .sort((a, b) => a.task.dueDateTime.getTime() - b.task.dueDateTime.getTime());

  const proximasEntregas = entries
    .filter((entry) => !entry.task.completed)
    .sort((a, b) => a.task.dueDateTime.getTime() - b.task.dueDateTime.getTime())
    .slice(0, PROXIMAS_ENTREGAS_LIMIT);

  return {
    pendientesCount,
    hoyCount,
    completadasUltimos7DiasCount,
    urgentEntries,
    proximasEntregas,
  };
}

/**
 * Greeting shown at the top of the dashboard, keyed to the hour of day.
 * Boundary hours are this task's own assumption — not specified in
 * 03-business-rules.md §15 or 11-roadmap.md: morning is [0, 12), afternoon
 * is [12, 19), evening is [19, 24).
 */
export function greetingForHour(hour: number): string {
  if (hour < 12) {
    return "Buenos días";
  }
  if (hour < 19) {
    return "Buenas tardes";
  }
  return "Buenas noches";
}
