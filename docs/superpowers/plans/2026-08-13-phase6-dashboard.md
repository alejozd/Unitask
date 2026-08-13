# Phase 6 — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Home tab (`app/(tabs)/index.tsx`) with the real dashboard: a time-of-day greeting, 3 stat tiles (Pendientes / Hoy / Completadas últimos 7 días), a "Tareas urgentes" horizontal list, and a "Próximas entregas" vertical list — each computed exactly per `03-business-rules.md` §15.

**Architecture:** A pure `src/domain/dashboard.ts` module computes every widget's data from already-derived `{ task, status }` entries (the same status-derivation the Home screen performs itself, mirroring `app/(tabs)/tareas/index.tsx`'s `enrichedTasks` pattern) — no DB/query code in the domain layer, matching every prior phase's domain/UI split. The Home screen (`app/(tabs)/index.tsx`) fetches tasks + subjects via `useLiveQuery` scoped to the active semester (identical fetch-all-then-join-in-JS pattern as `tareas/index.tsx`), derives status per task, calls the domain function, and renders. No new schema, no new repository, no new native dependency — this phase is entirely additive UI + domain logic over data structures that already exist.

**Tech Stack:** Drizzle ORM `useLiveQuery` (existing pattern), Jest (TDD for the domain layer), React Native `StyleSheet` + `@/theme` tokens (existing pattern) — no new packages.

## Global Constraints

- **Scope: active semester only**, same assumption and same reasoning as `tareas/index.tsx` and `03-business-rules.md` §15's own explicit assumption note ("closed semesters are historical/read-only and not part of 'what do I have to do'"). Fetch subjects, filter to `semesterId === activeSemesterId`, filter tasks to `activeSubjectIds.has(task.subjectId)` — copy this exact three-query join pattern from `tareas/index.tsx` rather than inventing a new one.
- **Resolved interpretation of §15's "Tareas urgentes" time condition**: `03-business-rules.md` §15 defines "Tareas urgentes" as the union of "`dueDateTime` is within the next 24–48 hours" OR "`priority == Alta`". Confirmed with the user: this is a **one-sided ≤48h window** (`now < dueDateTime <= now + 48h`), not a literal 24–48h band — a Media/Baja-priority task due in 10 hours DOES appear (it's within the next 48h), matching the intuitive reading of "urgent." The "24" in the rule text is descriptive framing, not a lower bound to enforce in code.
- **"Hoy" counts by calendar-day match, not a 24h rolling window** — `dueDateTime`'s calendar day (local time) equals today's calendar day, `completed === false`. A task due today but already past its time-of-day (Vencida) still counts — the rule only excludes `completed`, not `Vencida` status.
- **"Completadas últimos 7 días" is a rolling window recomputed on every read** (`now - 7 days <= completedAt <= now`), never reset on a fixed calendar boundary (not Monday–Sunday) — per §15 explicitly. `completedAt` is nullable in the schema; a completed task with a null `completedAt` (shouldn't happen per existing completion-flow invariants, but the domain function must not crash on it) is excluded, not counted.
- **"Tareas urgentes" excludes completed tasks**, full stop, regardless of the time/priority union match.
- **"Próximas entregas" = the 5 nearest pending (not completed) tasks by `dueDateTime` ascending, no day-window cutoff** — even if the nearest pending task is 3 weeks out, it still appears. Includes Vencida tasks (the rule excludes only `completed`, same as urgentes).
- **Accessibility (§18, cross-cutting, applies to this phase's new UI)**: priority is never shown as a color dot alone — pair every priority indicator with a text label, matching how `tareas/index.tsx` already renders `priorityColors` dots (it also shows `item.task.priority` as text next to the dot — reuse that exact pairing, don't regress to color-only in the new widgets).
- **Theming**: every color in the new UI comes from `@/theme` (`colors`, `priorityColors`, `subjectPalette`) — zero hardcoded hex values, matching every existing screen.
- **No new component test convention**: matching this codebase's established pattern (no `.tsx` test files anywhere — `ReminderPicker`, `TaskForm`, `AttachmentList` all verified via domain/repository tests + on-device only), the Home screen itself is verified via Task 2's Definition-of-Done on-device pass, not a component test. The domain layer (Task 1) is TDD'd exactly like `task-progress.ts`/`task-status.ts` were.
- **Tapping a task in either list navigates to its detail screen** (`router.push(\`/tarea/${task.id}\`)`), matching `tareas/index.tsx`'s existing card-tap behavior — the Dashboard is a summary view, not a second place to edit/complete tasks.

---

### Task 1: Dashboard domain selectors (TDD)

**Files:**
- Create: `src/domain/dashboard.ts`
- Create: `src/domain/__tests__/dashboard.test.ts`

**Interfaces:**
- Consumes: `type Task` from `@/db/schema/task`; `type TaskStatus` from `@/domain/task-status` (status is derived by the caller, exactly like `tareas/index.tsx` already does via `deriveTaskStatus` + `calculateTaskProgress` — this module does not re-derive it).
- Produces (from `@/domain/dashboard`): `type DashboardEntry = { task: Task; status: TaskStatus }`, `type DashboardSummary = { pendientesCount: number; hoyCount: number; completadasUltimos7DiasCount: number; urgentEntries: DashboardEntry[]; proximasEntregas: DashboardEntry[] }`, `buildDashboardSummary(entries: DashboardEntry[], now?: Date): DashboardSummary`, `greetingForHour(hour: number): string`.

- [ ] **Step 1: Write the failing tests**

Create `src/domain/__tests__/dashboard.test.ts` covering, at minimum: Pendientes counts only `status === "Pendiente"` entries (not En progreso/Vencida/Completada); Hoy counts a not-completed task due today regardless of time-of-day already passed (calendar-day match, including a Vencida-today case), excludes a completed task due today, excludes a task due tomorrow; Completadas últimos 7 días counts a task completed exactly 7 days ago (boundary, inclusive) and excludes one completed 7 days + 1 second ago, excludes a completed task with a null `completedAt`; urgentEntries includes a Media-priority task due in 10 hours and a Media-priority task due in 30 hours (both within the ≤48h window, per the resolved interpretation above), excludes a Media-priority task due in 60 hours (outside the window), includes an Alta-priority task due in 2 weeks (priority-only branch), excludes an already-overdue (Vencida) Media-priority task (its `dueDateTime` is in the past, not "within the next 48 hours") while still including an overdue Alta-priority task (priority-only branch still applies), excludes a completed task that would otherwise match either condition; proximasEntregas returns at most 5 entries sorted by `dueDateTime` ascending, excludes completed tasks, includes a Vencida task if it's among the 5 nearest, and correctly returns fewer than 5 when fewer than 5 pending tasks exist; `greetingForHour` returns the correct greeting at each boundary hour (document the exact boundary hours you choose — e.g. \<12 morning, \<19 afternoon, else evening — in a code comment, since §15/roadmap don't specify exact cutoffs; this is this plan's own assumption, flag it in the task report).

Cite `03-business-rules.md` §15 in the test file's header comment, matching every other domain test file's citation convention in this codebase.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/dashboard.test.ts
```

Expected: FAIL — `Cannot find module '@/domain/dashboard'`.

- [ ] **Step 3: Implement**

Create `src/domain/dashboard.ts`, citing §15 in a header comment above each constant/threshold (25 MB-style citation convention from Phase 5's `attachment-validation.ts`). Implement `buildDashboardSummary` using plain array `.filter()`/`.sort()`/`.slice()` over the `entries` param — no DB access, no `Date.now()` default hidden inside a helper that can't be tested deterministically (accept `now` as a parameter, default `new Date()`, exactly like `deriveTaskStatus`'s own `now?: Date` parameter in `task-status.ts`).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/dashboard.test.ts
```

- [ ] **Step 5: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check src/domain/dashboard.ts src/domain/__tests__/dashboard.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/dashboard.ts src/domain/__tests__/dashboard.test.ts
git commit -m "feat: add dashboard summary domain selectors (TDD)"
```

---

### Task 2: Wire the Home screen

**Files:**
- Modify: `app/(tabs)/index.tsx` (currently a placeholder — full replacement)

**Interfaces:**
- Consumes: `buildDashboardSummary`, `greetingForHour`, `type DashboardEntry` from `@/domain/dashboard` (Task 1); `deriveTaskStatus` from `@/domain/task-status`; `calculateTaskProgress` from `@/domain/task-progress`; `db`, schema tables (`semesters`, `subjects`, `tasks`, `subtasks`) — same imports as `tareas/index.tsx`; `colors`, `priorityColors`, `subjectPalette` from `@/theme`; `router` from `expo-router`.
- Produces: nothing consumed elsewhere (leaf screen).

- [ ] **Step 1: Fetch and enrich, reusing `tareas/index.tsx`'s exact pattern**

Copy the active-semester → active-subjects → tasks/subtasks `useLiveQuery` + `loaded` boolean + `enrichedTasks` (task/status/progress/subject) construction verbatim from `tareas/index.tsx` (do not diverge into a new join style). Build `DashboardEntry[]` from `enrichedTasks` (`{ task, status }`), call `buildDashboardSummary(entries)`.

- [ ] **Step 2: Greeting header**

`greetingForHour(new Date().getHours())` + a `Text` header. No live-updating clock needed (a stale greeting across a long-open session is cosmetic, unlike Vencida-status staleness which Phase 3 already handles via `tareas/index.tsx`'s 60s tick — do not copy that tick into this screen, it's not needed here).

- [ ] **Step 3: Stat tiles**

3 tiles (Pendientes / Hoy / Completadas últimos 7 días) in a row, each showing the count from `buildDashboardSummary`'s result. Reuse `styles.card`-equivalent tokens from `tareas/index.tsx` (`colors.surface` background, `colors.border` border, `colors.text`/`colors.textMuted`) rather than inventing new visual tokens.

- [ ] **Step 4: "Tareas urgentes" horizontal list**

Horizontally-scrolling `FlatList` (or `ScrollView horizontal`) over `summary.urgentEntries`, each item showing title, subject color dot + name, priority color dot + **priority text label** (accessibility constraint above), tappable → `router.push(\`/tarea/${entry.task.id}\`)`. Empty state: a muted "No hay tareas urgentes." text, not a hidden/collapsed section (matches `tareas/index.tsx`'s empty-state convention).

- [ ] **Step 5: "Próximas entregas" vertical list**

Same enrichment/tap behavior as Step 4, vertical, over `summary.proximasEntregas`, each item additionally showing the formatted due date/time. Empty state text: "No tienes próximas entregas."

- [ ] **Step 6: Verify TypeScript, lint, and prettier are clean**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check "app/(tabs)/index.tsx"
```

- [ ] **Step 7: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat: wire the Home dashboard screen"
```

---

### Task 3: Full Phase 6 Definition of Done verification

**Files:** none (verification-only task, matching every prior phase's precedent).

- [ ] **Step 1: Run the full combined check**

```bash
npm test
npx tsc --noEmit
npm run lint
npx prettier --check .
```

Expected: all green, no regressions in any suite from Phases 0-5.

- [ ] **Step 2: On-device walkthrough**

1. Open the Home tab. Confirm the greeting matches the current time of day.
2. Confirm the 3 stat tiles show correct counts against real on-device data (cross-check Pendientes/Hoy by eye against the Mis Tareas tab's filter chips for the same semester).
3. Confirm a task due within the urgent window or with Alta priority appears in "Tareas urgentes"; confirm a completed task never appears there even if it would otherwise match.
4. Confirm "Próximas entregas" shows at most 5 tasks, nearest-first.
5. Tap a task in each list, confirm it navigates to that task's detail screen.
6. Close the active semester (or switch to a state with no active semester, if that's reachable) and confirm the dashboard behaves sensibly (empty widgets, not a crash) — this exercises the "no active semester" edge case §17's first-run bootstrap already guards elsewhere, but the Dashboard itself must not assume `activeSemesterId` is always defined.

- [ ] **Step 3: Write the Phase 6 DoD report**

Write `.superpowers/sdd/task-3-report.md` (check first whether a stale one exists from an earlier phase's Task 3 — this project has hit that collision before — overwrite if so).

- [ ] **Step 4: No commit expected**

Verification-only, unless Steps 1-2 surface a real bug, in which case fix, re-verify, and commit the fix.
