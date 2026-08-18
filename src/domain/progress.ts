import type { Subject } from "@/db/schema/subject";
import type { DashboardEntry } from "./dashboard";

/**
 * 01-product.md / 11-roadmap.md Phase 8: Progress screen statistics.
 * No 03-business-rules.md section number exists for this screen
 * specifically; the 4 status buckets reused here are governed by §1.
 */
export interface SubjectProgressEntry {
  subjectId: string;
  subjectName: string;
  subjectColor: Subject["color"];
  completedCount: number;
  totalCount: number;
  completionRate: number;
}

export interface ProgressSummary {
  totalCount: number;
  completadasCount: number;
  enProgresoCount: number;
  pendientesCount: number;
  vencidasCount: number;
  overallCompletionRate: number;
  bySubject: SubjectProgressEntry[];
}

export function buildProgressSummary(
  entries: DashboardEntry[],
  subjects: Subject[],
): ProgressSummary {
  const completadasCount = entries.filter((e) => e.status === "Completada").length;
  const enProgresoCount = entries.filter((e) => e.status === "En progreso").length;
  const pendientesCount = entries.filter((e) => e.status === "Pendiente").length;
  const vencidasCount = entries.filter((e) => e.status === "Vencida").length;
  const totalCount = entries.length;
  // Guard the division before it can ever produce NaN — with zero tasks
  // tracked, the rate is exactly 0, never NaN and never null (confirmed
  // with the human: this is a pure math contract, independent of the
  // screen's separate decision to show an empty state instead of a stat
  // grid full of zeros when totalCount is 0 — see app/(tabs)/progreso).
  const overallCompletionRate =
    totalCount === 0 ? 0 : Math.round((completadasCount / totalCount) * 100);

  const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]));
  const countsBySubjectId = new Map<string, { completed: number; total: number }>();
  for (const item of entries) {
    const current = countsBySubjectId.get(item.task.subjectId) ?? { completed: 0, total: 0 };
    current.total += 1;
    if (item.status === "Completada") {
      current.completed += 1;
    }
    countsBySubjectId.set(item.task.subjectId, current);
  }

  // Assumption (confirmed with the human, not a spec requirement): a
  // subject with zero tasks in the active semester is excluded from
  // bySubject entirely — nothing meaningful to show for a 0/0 subject.
  const bySubject: SubjectProgressEntry[] = [];
  for (const [subjectId, counts] of countsBySubjectId) {
    const subject = subjectsById.get(subjectId);
    if (!subject) {
      continue;
    }
    bySubject.push({
      subjectId,
      subjectName: subject.name,
      subjectColor: subject.color,
      completedCount: counts.completed,
      totalCount: counts.total,
      completionRate: Math.round((counts.completed / counts.total) * 100),
    });
  }
  bySubject.sort((a, b) => a.subjectName.localeCompare(b.subjectName, "es"));

  return {
    totalCount,
    completadasCount,
    enProgresoCount,
    pendientesCount,
    vencidasCount,
    overallCompletionRate,
    bySubject,
  };
}

/**
 * Boundary thresholds are this plan's own assumption — not specified in
 * 03-business-rules.md or 11-roadmap.md: high performance is >= 80%, mid
 * performance is [50, 80), everything else (including 0) is low
 * performance. `totalCount === 0` (zero tasks tracked) is its own
 * distinct message, checked independently of the rate value — a real 0%
 * with actual tasks tracked gets the low-performance message, not the
 * no-tasks-yet one.
 */
const HIGH_PERFORMANCE_THRESHOLD = 80;
const MID_PERFORMANCE_THRESHOLD = 50;

// Phase 9.5: each range is a pool of 2-3 variants (this plan's own
// assumption on wording/count) instead of one fixed string, so the same
// range doesn't always show the identical message on every visit.
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

/**
 * `random` defaults to `Math.random` but is injectable so tests can force
 * a specific pool index instead of asserting on real randomness. Clamped
 * to the pool's last index so a boundary value of exactly 1 (never
 * produced by `Math.random` itself, but a test double could pass it)
 * can't index past the end of the array.
 */
export function encouragementMessage(
  overallCompletionRate: number,
  totalCount: number,
  random: () => number = Math.random,
): string {
  const pool =
    totalCount === 0
      ? NO_TASKS_MESSAGES
      : overallCompletionRate >= HIGH_PERFORMANCE_THRESHOLD
        ? HIGH_PERFORMANCE_MESSAGES
        : overallCompletionRate >= MID_PERFORMANCE_THRESHOLD
          ? MID_PERFORMANCE_MESSAGES
          : LOW_PERFORMANCE_MESSAGES;
  const index = Math.min(Math.floor(random() * pool.length), pool.length - 1);
  return pool[index];
}
