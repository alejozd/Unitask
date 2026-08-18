# Phase 8 — Progress screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Progreso tab (`app/(tabs)/progreso/index.tsx`) with a real, read-only statistics screen: an overall completion-rate summary, a 4-stat breakdown (Completadas/En progreso/Pendientes/Vencidas), a per-subject completion breakdown, and an encouragement message — all derived live from stored task/subtask data, per `01-product.md`'s "Progress screen: statistics derived from task/subtask completion" and `11-roadmap.md`'s Phase 8 section.

**Architecture:** A pure `src/domain/progress.ts` module aggregates already-derived `{ task, status }` entries (reusing Phase 6's `DashboardEntry` type from `src/domain/dashboard.ts`) plus the active semester's subject list into a `ProgressSummary` — no DB/query code in the domain layer, matching every prior phase's domain/UI split. The screen (`app/(tabs)/progreso/index.tsx`) fetches tasks/subjects via `useLiveQuery` scoped to the active semester (the same query pattern as `tareas/index.tsx`, the Phase 6 Home screen, and the Phase 7 Calendario screen), calls the domain function, and renders. No new schema, no new repository, no new native dependency, no CRUD affordances (read-only screen, per the roadmap's explicit acceptance criteria).

**Tech Stack:** Drizzle ORM `useLiveQuery` (existing pattern), Jest (TDD for the domain layer), React Native `StyleSheet` + `@/theme` tokens (existing pattern) — no new packages.

## Global Constraints

- **Visual guidance ("guía, no spec"):** `Documentacion/Design-stitch/mi_progreso_unitask.png` and `DESIGN.md` inform structure/hierarchy, translated to this project's real `@/theme` tokens, Spanish copy, and existing component conventions — never copied literally.
- **Deliberate deviation from the mockup — no circular progress ring.** The mockup shows "Rendimiento General" as a circular donut chart. This project has no SVG/chart library installed (`react-native-svg` or similar), and adding one would be a native dependency requiring a rebuild — directly against this project's consistent "no new dependencies, no rebuild" constraint (enforced in every phase since Phase 6). A true circular arc isn't achievable in pure React Native `View`/`StyleSheet` without disproportionate complexity for a decorative element. Instead, "Rendimiento General" renders as a large percentage number + a horizontal progress bar, reusing the exact same `progressTrack`/`progressFill` pattern already established on the Dashboard's urgentes cards (`app/(tabs)/index.tsx`). Disclose this as an intentional deviation, not a gap, in Task 2's report.
- **Deliberate deviation from the mockup — 4 stat cards, not 3.** The mockup shows exactly 3 buckets (Completadas / En progreso / Pendientes). This app's actual task-status model (`03-business-rules.md` §1) has 4 states: Pendiente, En progreso, Completada, Vencida. Silently folding Vencida into Pendientes (or dropping it) would make the 4 counts not sum to the total, and would hide overdue tasks from a screen whose whole purpose is honest statistics. Add a 4th "Vencidas" stat card (red/danger, matching this app's existing Vencida color convention everywhere else) in a 2×2 grid instead of the mockup's 1×3 column, reusing the Dashboard's KPI-card visual language (icon-left + value-right row, label below — the same pattern established in Phase 6.5b/6.5c).
- **Scope: active semester only**, reusing `app/(tabs)/tareas/index.tsx`'s exact active-semester → subjects → tasks/subtasks `useLiveQuery` join pattern (also used by the Phase 6 Home screen and the Phase 7 Calendario screen) — copy it verbatim, do not reinvent.
- **All statistics — overall rate, the 4 stat counts, and each subject's breakdown — are computed over ALL tasks in the active semester, not time-windowed** (unlike the Dashboard's §15 widgets, which use rolling/48h windows for specific widgets). This is a lifetime-of-the-semester view, matching `01-product.md`'s framing of this screen as "statistics derived from task/subtask completion" with no time-window qualifier.
- **Read-only screen — no create/edit/delete affordances**, per the roadmap's explicit acceptance criteria. No FAB, no swipe actions, no checkboxes.
- **Per-subject breakdown excludes subjects with zero tasks** in the active semester — nothing meaningful to show for a 0/0 subject, and rendering "0 de 0 tareas — NaN%" would be a real bug, not a legitimate empty state. Subjects are sorted alphabetically (`localeCompare("es")`, matching this codebase's existing subject-sort convention in `app/tarea/nueva.tsx`). **This exclusion is an assumption, not a spec requirement — Task 1's report must explicitly document it as such** (confirmed with the human when approving this plan's execution).
- **`overallCompletionRate` is ALWAYS a plain `number` (0-100), never `NaN` and never `null`, even with zero tasks tracked** (confirmed with the human when approving this plan's execution — this replaces an earlier draft of this plan that used `number | null`). With zero tasks, `overallCompletionRate` is `0` by definition (`totalCount === 0 ? 0 : Math.round(...)`), guarding the division before it can produce `NaN`. This is a pure math contract, separate from the UI decision below — cover it with an explicit test ("zero entries → rate is exactly 0, not NaN").
- **The screen shows a friendly empty state, not a row of stray zeros, when the active semester has zero tasks.** This is a UI-level decision driven by `summary.totalCount === 0` (NOT by the rate value, which is always a valid number per the constraint above) — when true, the screen renders a single empty-state message ("Aún no hay tareas este semestre todavía") instead of the stat grid / subject breakdown / encouragement card. `encouragementMessage` still needs `totalCount` as a second parameter to choose its own zero-tasks message independently of the screen's empty-state branch (see Task 1) — cover this with an explicit test too.
- **Encouragement message is a pure, testable domain function** (`encouragementMessage`), not inline UI logic — mirrors `greetingForHour`'s precedent in `src/domain/dashboard.ts` (a pure text-generation function based on a numeric threshold, TDD'd with explicit boundary tests). Threshold values (80/50) are this plan's own assumption — not specified in `03-business-rules.md` or `11-roadmap.md` — document them in the module's header comment and flag as an assumption in the Task 1 report, same as `greetingForHour`'s hour-boundary precedent.
- **Accessibility (§18):** this screen shows no priority indicators (it's status/subject statistics, not a task list), so §18's "dot + text, never color alone" rule doesn't directly apply here — but every stat card's color-coding is still paired with a text label (e.g. the danger-red Vencidas card also says "Vencidas" in text, never a bare colored number), consistent with the spirit of never relying on color alone.
- **Theming:** every color in the new UI comes from `@/theme` (`colors`, `priorityColors`, `subjectPalette`) — zero hardcoded hex values, except the same pre-existing, already-backlogged `"#FFFFFF"`-on-solid-color pattern used everywhere else in this codebase (icon tints on colored backgrounds) — do not invent a new hex value beyond that established pattern.
- **No new component test convention**: matching this codebase's established pattern for non-pilot phases (Phase 7's 2-test component pilot was a bounded, one-time exception, not a new default), this screen is verified via domain tests (Task 1) + the on-device DoD pass (Task 3) only — no `.tsx` test file.

---

### Task 1: Progress domain selectors (TDD)

**Files:**
- Create: `src/domain/progress.ts`
- Create: `src/domain/__tests__/progress.test.ts`

**Interfaces:**
- Consumes: `type DashboardEntry` from `@/domain/dashboard` (status is derived by the caller exactly like every other screen already does, via `deriveTaskStatus`/`calculateTaskProgress` — this module does not re-derive it); `type Subject` from `@/db/schema/subject`.
- Produces (from `@/domain/progress`): `interface SubjectProgressEntry { subjectId: string; subjectName: string; subjectColor: Subject["color"]; completedCount: number; totalCount: number; completionRate: number }`, `interface ProgressSummary { totalCount: number; completadasCount: number; enProgresoCount: number; pendientesCount: number; vencidasCount: number; overallCompletionRate: number; bySubject: SubjectProgressEntry[] }`, `buildProgressSummary(entries: DashboardEntry[], subjects: Subject[]): ProgressSummary`, `encouragementMessage(overallCompletionRate: number, totalCount: number): string`.

- [ ] **Step 1: Write the failing tests**

Create `src/domain/__tests__/progress.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/progress.test.ts
```

Expected: FAIL — `Cannot find module '../progress'`.

- [ ] **Step 3: Implement**

Create `src/domain/progress.ts`:

```ts
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

export function encouragementMessage(overallCompletionRate: number, totalCount: number): string {
  if (totalCount === 0) {
    return "Aún no tienes tareas registradas. ¡Empieza creando tu primera tarea!";
  }
  if (overallCompletionRate >= HIGH_PERFORMANCE_THRESHOLD) {
    return "¡Excelente ritmo! Sigue así.";
  }
  if (overallCompletionRate >= MID_PERFORMANCE_THRESHOLD) {
    return "¡Vas por buen camino! Tómate un respiro antes de continuar con tus pendientes.";
  }
  return "Aún te queda camino por recorrer, pero cada tarea completada suma. ¡Tú puedes!";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/progress.test.ts
```

- [ ] **Step 5: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check src/domain/progress.ts src/domain/__tests__/progress.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/progress.ts src/domain/__tests__/progress.test.ts
git commit -m "feat: add progress summary domain selectors (TDD)"
```

---

### Task 2: Wire the Progreso screen

**Files:**
- Modify: `app/(tabs)/progreso/index.tsx` (currently a placeholder — full replacement)

**Interfaces:**
- Consumes: `buildProgressSummary`, `encouragementMessage`, `type ProgressSummary` from `@/domain/progress` (Task 1); `deriveTaskStatus` from `@/domain/task-status`; `calculateTaskProgress` from `@/domain/task-progress`; `type DashboardEntry` from `@/domain/dashboard`; `db`, schema tables (`semesters`, `subjects`, `tasks`, `subtasks`) — same imports as `tareas/index.tsx`; `colors`, `priorityColors`, `subjectPalette` from `@/theme`; `Ionicons` from `@expo/vector-icons`.
- Produces: nothing consumed elsewhere (leaf screen).

- [ ] **Step 1: Fetch and enrich, reusing the established active-semester pattern verbatim**

Copy the active-semester → active-subjects → tasks/subtasks `useLiveQuery` + `loaded` boolean construction from `app/(tabs)/tareas/index.tsx` / `app/(tabs)/index.tsx` (do not diverge into a new join style). Build `DashboardEntry[]` from the enriched tasks (`{ task, status }`), and pass BOTH `entries` and the active-semester-scoped `activeSubjects` array (not all subjects) to `buildProgressSummary`.

```tsx
import { Ionicons } from "@expo/vector-icons";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { StyleSheet, Text, View } from "react-native";

import { db } from "@/db/client";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks } from "@/db/schema/task";
import { buildProgressSummary, encouragementMessage } from "@/domain/progress";
import type { DashboardEntry } from "@/domain/dashboard";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus } from "@/domain/task-status";
import { colors, priorityColors, subjectPalette } from "@/theme";

export default function ProgresoScreen() {
  const { data: activeSemesterRows, updatedAt: semesterUpdatedAt } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;

  const { data: subjectRows, updatedAt: subjectsUpdatedAt } = useLiveQuery(
    db.select().from(subjects),
  );
  const activeSubjects = (subjectRows ?? []).filter(
    (subject) => subject.semesterId === activeSemesterId,
  );
  const activeSubjectIds = new Set(activeSubjects.map((subject) => subject.id));

  const { data: taskRows, updatedAt: tasksUpdatedAt } = useLiveQuery(db.select().from(tasks));
  const { data: subtaskRows, updatedAt: subtasksUpdatedAt } = useLiveQuery(
    db.select().from(subtasks),
  );

  const loaded =
    semesterUpdatedAt !== undefined &&
    subjectsUpdatedAt !== undefined &&
    tasksUpdatedAt !== undefined &&
    subtasksUpdatedAt !== undefined;

  const entries: DashboardEntry[] = (taskRows ?? [])
    .filter((task) => activeSubjectIds.has(task.subjectId))
    .map((task) => {
      const taskSubtasks = (subtaskRows ?? []).filter((subtask) => subtask.taskId === task.id);
      const progress = calculateTaskProgress(taskSubtasks, task.completed);
      const status = deriveTaskStatus({
        completed: task.completed,
        dueDateTime: task.dueDateTime,
        progress,
      });
      return { task, status };
    });

  const summary = buildProgressSummary(entries, activeSubjects);
  const message = encouragementMessage(summary.overallCompletionRate, summary.totalCount);

  // continued in Step 2-4 below
```

- [ ] **Step 2: "Rendimiento General" card and the 2×2 stat grid**

```tsx
  if (!loaded) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.emptyText}>Cargando…</Text>
        </View>
      </View>
    );
  }

  // Empty state is driven by totalCount, NOT by the rate (which is always
  // a valid 0-100 number per src/domain/progress.ts's contract — never
  // NaN, never null). Showing a stat grid full of zeros when the active
  // semester genuinely has no tasks yet would be technically accurate but
  // uninviting; a single friendly message is the deliberate UI choice
  // here (confirmed with the human when approving this plan's execution).
  if (summary.totalCount === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Tu Progreso</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.emptyStateText}>Aún no hay tareas este semestre todavía.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tu Progreso</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.overallCard}>
          <Text style={styles.overallTitle}>Rendimiento General</Text>
          <Text style={styles.overallValue}>{summary.overallCompletionRate}%</Text>
          <Text style={styles.overallCaption}>tareas completadas</Text>
          <View style={styles.progressTrack}>
            <View
              style={[styles.progressFill, { width: `${summary.overallCompletionRate}%` }]}
            />
          </View>
        </View>

        <View style={styles.statGrid}>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.primaryTint }]}>
                <Ionicons name="checkmark-circle-outline" size={18} color={priorityColors.Baja} />
              </View>
              <Text style={styles.statValue}>{summary.completadasCount}</Text>
              <Text style={styles.statLabel}>Completadas</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.primaryTint }]}>
                <Ionicons name="sync-outline" size={18} color={priorityColors.Media} />
              </View>
              <Text style={styles.statValue}>{summary.enProgresoCount}</Text>
              <Text style={styles.statLabel}>En progreso</Text>
            </View>
          </View>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.primaryTint }]}>
                <Ionicons name="list-outline" size={18} color={colors.primary} />
              </View>
              <Text style={styles.statValue}>{summary.pendientesCount}</Text>
              <Text style={styles.statLabel}>Pendientes</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.dangerTint }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              </View>
              <Text style={styles.statValue}>{summary.vencidasCount}</Text>
              <Text style={styles.statLabel}>Vencidas</Text>
            </View>
          </View>
        </View>
```

- [ ] **Step 3: "Desglose por Materia" section**

```tsx
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Desglose por Materia</Text>
          {summary.bySubject.length === 0 ? (
            <Text style={styles.emptyText}>No tienes materias con tareas registradas.</Text>
          ) : (
            <View style={styles.subjectList}>
              {summary.bySubject.map((item) => (
                <View
                  key={item.subjectId}
                  style={[
                    styles.subjectCard,
                    { borderLeftColor: subjectPalette[item.subjectColor] },
                  ]}
                >
                  <View style={styles.subjectHeaderRow}>
                    <Text style={styles.subjectName}>{item.subjectName}</Text>
                    <Text
                      style={[styles.subjectRate, { color: subjectPalette[item.subjectColor] }]}
                    >
                      {item.completionRate}%
                    </Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${item.completionRate}%`,
                          backgroundColor: subjectPalette[item.subjectColor],
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.subjectCaption}>
                    {item.completedCount} de {item.totalCount} tareas completadas
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
```

- [ ] **Step 4: Encouragement card, close out the component, and styles**

```tsx
        <View style={styles.encouragementCard}>
          <View style={styles.encouragementIconCircle}>
            <Ionicons name="cafe-outline" size={28} color={colors.primary} />
          </View>
          <Text style={styles.encouragementText}>{message}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  emptyStateText: { color: colors.textMuted, textAlign: "center", fontSize: 15 },
  content: { padding: 20, paddingTop: 0, gap: 20 },

  overallCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: "center",
    gap: 4,
  },
  overallTitle: { fontSize: 15, fontWeight: "600", color: colors.text, alignSelf: "flex-start" },
  overallValue: { fontSize: 40, fontWeight: "700", color: colors.primary, marginTop: 8 },
  overallCaption: { fontSize: 13, color: colors.textMuted, marginBottom: 12 },

  statGrid: { gap: 10 },
  statRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 6,
  },
  statIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: { fontSize: 22, fontWeight: "700", color: colors.text },
  statLabel: { fontSize: 12, color: colors.textMuted },

  section: { gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  subjectList: { gap: 12 },
  subjectCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: 14,
    gap: 8,
  },
  subjectHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  subjectName: { fontSize: 15, fontWeight: "600", color: colors.text },
  subjectRate: { fontSize: 14, fontWeight: "700" },
  subjectCaption: { fontSize: 12, color: colors.textMuted },

  progressTrack: {
    width: "100%",
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: colors.primary },

  encouragementCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 12,
  },
  encouragementIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  encouragementText: { fontSize: 14, color: colors.text, textAlign: "center" },
});
```

Assemble Steps 1-4 into the single final `app/(tabs)/progreso/index.tsx` file (the numbered steps above are how you build it up; the file itself is one continuous component + one `StyleSheet.create` call, not four separate pieces).

- [ ] **Step 5: Verify TypeScript, lint, and prettier are clean**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check "app/(tabs)/progreso/index.tsx"
```

- [ ] **Step 6: Commit**

```bash
git add "app/(tabs)/progreso/index.tsx"
git commit -m "feat: wire the Progreso statistics screen"
```

---

### Task 3: Full Phase 8 Definition of Done verification

**Files:** none (verification-only task).

**Verification split (matching Phase 6.6/6.5b/6.5c/Phase 7's established pattern — do not spend tokens driving an emulator for this phase):** run the automated combined check only; produce an on-device checklist for the human to walk through themselves.

- [ ] **Step 1: Run the full combined check**

```bash
npm test
npx tsc --noEmit
npm run lint
npx prettier --check .
```

Expected: all green, no regressions in any suite from Phases 0-7. If anything fails, fix it, re-verify, and commit the fix before proceeding.

- [ ] **Step 2: Write the on-device checklist for the human**

Write `.superpowers/sdd/phase8-device-checklist.md` — a short, numbered checklist. Base it on:

1. Open the Progreso tab. Confirm "Rendimiento General" shows a percentage and a horizontal progress bar (not a circular ring — this is a deliberate, disclosed deviation from the design mockup, not a bug).
2. Confirm the 4 stat cards (Completadas / En progreso / Pendientes / Vencidas) show correct counts — cross-check by eye against the "Mis Tareas" tab's filter chips for the same semester.
3. Confirm "Desglose por Materia" lists every active-semester subject that has at least one task, each with the correct completion percentage, a colored progress bar matching that subject's own color (same color used elsewhere in the app for that subject), and "X de Y tareas completadas" text.
4. Confirm a subject with zero tasks does NOT appear in the breakdown.
5. Confirm the encouragement message at the bottom changes sensibly as the overall completion rate changes (if easy to test — e.g. completing a task and watching the message/percentage update live).
6. Confirm the screen has no create/edit/delete affordances anywhere (read-only, per the roadmap's acceptance criteria).
7. If reachable without destructive action: check the screen's behavior with no active semester (or zero tasks in the active semester) — should show the single friendly empty-state message ("Aún no hay tareas este semestre todavía.") instead of a stat grid full of zeros, and definitely not a crash or a broken `NaN%`.

- [ ] **Step 3: Write the Phase 8 implementation report**

Write `.superpowers/sdd/task-3-report.md` (check first whether a stale report from an earlier phase's differently-numbered final task exists at a colliding path — this project has hit that collision before — overwrite if so). Include the combined-check output and a pointer to the checklist file from Step 2.

- [ ] **Step 4: No commit expected for the checklist itself**

Only commit if Step 1 surfaced and required a real fix.
