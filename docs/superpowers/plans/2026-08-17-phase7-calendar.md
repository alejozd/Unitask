# Phase 7 — Calendar (month view) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Calendario tab (`app/(tabs)/calendario/index.tsx`) with a real month-view calendar: a Monday-first month grid with priority-colored dot indicators per day, month navigation, an inline day panel listing the selected day's tasks, and a contextual "Añadir tarea" FAB that pre-fills the selected day's date — all per `03-business-rules.md` §16.

**Architecture:** A pure `src/domain/calendar.ts` module builds the month grid (including leading/trailing days from adjacent months) and groups already-derived `{ task, status }` entries (reusing Phase 6's `DashboardEntry` type from `src/domain/dashboard.ts`) by calendar day, computing each day's priority dots. Two small presentational components (`src/components/CalendarDayPanel.tsx`, `src/components/CalendarAddTaskFab.tsx`) render the day panel and the contextual FAB. The screen (`app/(tabs)/calendario/index.tsx`) fetches tasks/subjects via `useLiveQuery` scoped to the active semester (the same query pattern as `app/(tabs)/tareas/index.tsx` and the Phase 6 Home screen), calls the domain function, and renders the grid + panel + FAB. `app/tarea/nueva.tsx` gains support for an optional `dueDate` route param so the FAB's pre-fill actually reaches the form (`TaskForm` already accepts `initialValues.dueDate` — no change needed there). No new schema, no new repository, no new native dependency.

**Tech Stack:** Drizzle ORM `useLiveQuery` (existing pattern), Jest (TDD for the domain layer), `@testing-library/react-native` (already an installed-but-unused devDependency — see Global Constraint on the scoped component-test pilot), React Native `StyleSheet` + `@/theme` tokens (existing pattern) — no new packages.

## Global Constraints

- **Visual guidance ("guía, no spec" — added when the human approved execution):** `Documentacion/Design-stitch/calendario_unitask.png` and `DESIGN.md` inform structure/hierarchy, translated to this project's real `@/theme` tokens and existing conventions, never copied literally. Adopted from the mockup: a Monday-first weekday-letter header row above the grid (L M M J V S D — see Task 4), and a "N Pendiente(s)" count badge next to the day panel's date header (see Task 2). **Deliberately NOT adopted** (disclose as intentional deviations, not gaps, in each task's report): (1) the mockup's "Mes / Semana / Día" segmented toggle — `03-business-rules.md`/`11-roadmap.md`'s Phase 7 acceptance criteria explicitly ship month view only, week/day toggle is an explicit fast-follow, not this phase; (2) a checkbox on each day-panel task card for quick-complete-from-calendar — this is new *behavior*, not a visual tweak, and isn't in Phase 7's roadmap feature list; (3) a priority-color-only left stripe as the sole priority indicator — would violate §18's "never color alone" rule on its own, and this plan already satisfies §18 via the existing dot+text meta-chip, so a redundant stripe adds visual complexity without functional benefit for a first pass.
- **No new dependencies.** Build the month grid with plain `Date` arithmetic — no calendar library. Matches Phase 6's "no new packages" precedent; month-grid math is straightforward without one.
- **Week starts on Monday** (ISO 8601 / common `es`-locale convention). This is this plan's own assumption — not specified in `03-business-rules.md` §16 or `11-roadmap.md`. Document it in `src/domain/calendar.ts`'s header comment.
- **Multi-priority-per-day dot rendering (resolves §16's explicitly-open assumption):** one dot per **distinct priority present that day** (maximum 3: Alta/Media/Baja), ordered Alta → Media → Baja, deduplicated — **not** one dot per task. §16's own text says this exact choice ("stacked dots vs. single highest-priority dot... capped at a small fixed number") is left to the implementation phase, not a product-level rule — this plan's choice is "one dot per distinct priority," flagged as an assumption in the Task 1 report.
- **Day entries/dots include ALL tasks due that day, regardless of completion status.** Unlike `03-business-rules.md` §15's Dashboard widgets (which explicitly exclude completed tasks), §16 states no such exclusion for the calendar's day indicator/panel — so none is applied. Flag this reading as an assumption in the Task 1 report so it can be challenged in review if wrong.
- **Scope: active semester only**, reusing `app/(tabs)/tareas/index.tsx`'s exact active-semester → subjects → tasks/subtasks `useLiveQuery` join pattern (also used by the Phase 6 Home screen) — copy it verbatim, do not reinvent.
- **Recompute tick required from the start.** Include the same 60-second `forceStatusRecompute` interval pattern already used in `tareas/index.tsx` (and added to the Phase 6 Home screen after its whole-branch review flagged the omission as an Important finding). The day panel displays task `status` (including Vencida), which is time-derived — do not ship this screen without the tick and rediscover the same finding.
- **Accessibility (§18):** every priority indicator in the day panel shows a color dot **and** a text label, never color alone. The month grid's small per-day dots are a compact visual index into that day (not the primary display of any single task's priority — the day panel's list is the primary display and carries the text label), consistent with how a calendar's day markers conventionally work as a summary affordance rather than a full data display.
- **Theming:** every color in the new UI comes from `@/theme` (`colors`, `priorityColors`, `subjectPalette`) — zero hardcoded hex values.
- **Selecting a day never navigates away from Calendario** — the day panel renders inline in the same screen; selecting a day only updates local component state, never a route push.
- **Tapping a task in the day panel navigates to its detail screen** (`router.push(\`/tarea/${task.id}\`)`), matching every other task list in the app.
- **"Añadir tarea" pre-fills only the selected day's DATE, not a time.** The FAB passes the selected day as an ISO-string `dueDate` route param on `/tarea/nueva`; `app/tarea/nueva.tsx` parses it and passes `initialValues={{ dueDate }}` to `TaskForm` (which already supports that prop — no change needed inside `TaskForm.tsx` itself).
- **Scoped component-test pilot (confirmed with the user — read carefully, this is a bounded exception, not a new blanket convention):** exactly **two** new `.tsx` test suites are permitted for this phase, using `@testing-library/react-native` (already an installed devDependency, previously unused in this codebase):
  1. `src/components/__tests__/CalendarDayPanel.test.tsx` — render behavior (title/subject/priority text label/empty state).
  2. `src/components/__tests__/CalendarAddTaskFab.test.tsx` — press-navigates-with-correct-params behavior.

  This does **not** change the codebase's general convention for anything else in this phase or any future one — every other piece of Phase 7 UI (the month grid itself, the screen-level wiring) is verified via domain tests + the on-device DoD pass only, exactly like every prior phase. Register this pilot explicitly in the progress ledger when Tasks 2 and 3 complete. **If the Jest/RTL setup for either suite hits unexpected friction** (transform errors, persistent `act()` warnings, or anything beyond a standard `jest.mock("expo-router", ...)` call), the implementer must **STOP and report** rather than spending extended effort fighting the test environment — this is a bounded pilot, not a mandate to solve arbitrary RTL configuration problems.

---

### Task 1: Calendar domain selectors (TDD)

**Files:**
- Create: `src/domain/calendar.ts`
- Create: `src/domain/__tests__/calendar.test.ts`
- Modify: `src/domain/dashboard.ts` — export the existing private `isSameCalendarDay` helper (add the `export` keyword; no other change) so `calendar.ts` can reuse it instead of duplicating calendar-day-match logic.
- Modify: `app/(tabs)/index.tsx` — remove the local private `isSameCalendarDay` duplicate added during Phase 6.5/6.6 (it existed specifically because this export didn't exist yet) and import the now-exported version from `@/domain/dashboard` instead. (Added per the human's explicit instruction when approving this plan's execution.)

**Interfaces:**
- Consumes: `type DashboardEntry` and `isSameCalendarDay` from `@/domain/dashboard` (this task adds the export); `type Task` from `@/db/schema/task` (for the `Priority` type alias only).
- Produces (from `@/domain/calendar`): `interface CalendarDay { date: Date; isCurrentMonth: boolean; priorityDots: Array<"Alta" | "Media" | "Baja">; entries: DashboardEntry[] }`, `buildCalendarMonth(entries: DashboardEntry[], year: number, month: number): CalendarDay[]` (`month` is 0-indexed, JS `Date` convention: January = 0).

- [ ] **Step 1: Export `isSameCalendarDay` from `dashboard.ts`**

In `src/domain/dashboard.ts`, change:

```ts
function isSameCalendarDay(a: Date, b: Date): boolean {
```

to:

```ts
export function isSameCalendarDay(a: Date, b: Date): boolean {
```

No other change to that file. Run `npx jest src/domain/__tests__/dashboard.test.ts` to confirm this one-line change didn't break anything (expect the same pass count as before).

- [ ] **Step 2: Write the failing tests**

Create `src/domain/__tests__/calendar.test.ts`:

```ts
/**
 * 03-business-rules.md §16: Calendar day indicators. §16 leaves exact
 * multi-task-per-day visual treatment as an implementation decision; this
 * module's resolved choice: one dot per distinct priority present that day
 * (Alta > Media > Baja, deduped — not one dot per task). §16 also states no
 * completed-task exclusion for the day indicator/panel, unlike §15's
 * Dashboard widgets — so entries include completed tasks. Week starts on
 * Monday (ISO 8601 convention; not specified by §16 or the roadmap).
 */
import { buildCalendarMonth } from "../calendar";
import type { DashboardEntry } from "../dashboard";
import type { Task } from "@/db/schema/task";

let taskCounter = 0;

function makeTask(overrides: Partial<Task> = {}): Task {
  taskCounter += 1;
  return {
    id: overrides.id ?? `task-${taskCounter}`,
    title: overrides.title ?? "Tarea",
    description: null,
    subjectId: "subject-1",
    dueDateTime: overrides.dueDateTime ?? new Date(2026, 7, 15, 10, 0),
    priority: overrides.priority ?? "Media",
    completed: overrides.completed ?? false,
    completedAt: overrides.completedAt ?? null,
    completedLate: false,
    createdAt: new Date(2026, 7, 1),
    updatedAt: new Date(2026, 7, 1),
  };
}

function entry(task: Task, status: DashboardEntry["status"] = "Pendiente"): DashboardEntry {
  return { task, status };
}

describe("buildCalendarMonth", () => {
  it("returns a grid starting on Monday, with leading days from the prior month marked isCurrentMonth: false", () => {
    // August 2026 (month index 7) starts on a Saturday.
    const days = buildCalendarMonth([], 2026, 7);
    expect(days[0].date.getDay()).toBe(1); // Monday
    expect(days[0].date.getMonth()).toBe(6); // July (leading day)
    expect(days[0].isCurrentMonth).toBe(false);
  });

  it("ends the grid on a Sunday, with trailing days from the next month completing the last week", () => {
    const days = buildCalendarMonth([], 2026, 7);
    const last = days[days.length - 1];
    expect(last.date.getDay()).toBe(0); // Sunday
    expect(days.length % 7).toBe(0);
  });

  it("produces exactly 28 cells (4 weeks) when the month starts on a Monday and has exactly 4 weeks of days", () => {
    // February 2027 (month index 1): 28 days, starts on a Monday.
    const days = buildCalendarMonth([], 2027, 1);
    expect(days.length).toBe(28);
  });

  it("produces 42 cells (6 weeks) when the month needs a 6th row", () => {
    // August 2026 (month index 7): 31 days, starts on a Saturday.
    const days = buildCalendarMonth([], 2026, 7);
    expect(days.length).toBe(42);
  });

  it("assigns one dot per distinct priority present that day, ordered Alta > Media > Baja, deduped across multiple same-priority tasks", () => {
    const entries = [
      entry(makeTask({ dueDateTime: new Date(2026, 7, 15, 8, 0), priority: "Media" })),
      entry(makeTask({ dueDateTime: new Date(2026, 7, 15, 9, 0), priority: "Media" })),
      entry(makeTask({ dueDateTime: new Date(2026, 7, 15, 20, 0), priority: "Alta" })),
    ];
    const days = buildCalendarMonth(entries, 2026, 7);
    const cell = days.find((d) => d.isCurrentMonth && d.date.getDate() === 15)!;
    expect(cell.priorityDots).toEqual(["Alta", "Media"]);
    expect(cell.entries).toHaveLength(3);
  });

  it("gives a day with no tasks an empty dots array and empty entries", () => {
    const days = buildCalendarMonth([], 2026, 7);
    const cell = days.find((d) => d.isCurrentMonth && d.date.getDate() === 15)!;
    expect(cell.priorityDots).toEqual([]);
    expect(cell.entries).toEqual([]);
  });

  it("includes a completed task in a day's dots and entries (no completion filter, unlike the Dashboard's widgets)", () => {
    const entries = [
      entry(
        makeTask({
          dueDateTime: new Date(2026, 7, 15, 10, 0),
          priority: "Baja",
          completed: true,
          completedAt: new Date(2026, 7, 15, 11, 0),
        }),
        "Completada",
      ),
    ];
    const days = buildCalendarMonth(entries, 2026, 7);
    const cell = days.find((d) => d.isCurrentMonth && d.date.getDate() === 15)!;
    expect(cell.priorityDots).toEqual(["Baja"]);
    expect(cell.entries).toHaveLength(1);
  });

  it("assigns a task due on the last day of the previous month to that leading grid cell, not to the 1st of the current month", () => {
    // July 31, 2026 is a Friday — a leading cell in August 2026's grid.
    const entries = [
      entry(makeTask({ dueDateTime: new Date(2026, 6, 31, 23, 0), priority: "Alta" })),
    ];
    const days = buildCalendarMonth(entries, 2026, 7);
    const leadingCell = days.find((d) => d.date.getMonth() === 6 && d.date.getDate() === 31)!;
    const firstOfMonth = days.find((d) => d.isCurrentMonth && d.date.getDate() === 1)!;
    expect(leadingCell.isCurrentMonth).toBe(false);
    expect(leadingCell.priorityDots).toEqual(["Alta"]);
    expect(firstOfMonth.entries).toEqual([]);
  });

  it("sorts a day's entries by dueDateTime ascending", () => {
    const entries = [
      entry(makeTask({ id: "late", dueDateTime: new Date(2026, 7, 15, 20, 0) })),
      entry(makeTask({ id: "early", dueDateTime: new Date(2026, 7, 15, 8, 0) })),
    ];
    const days = buildCalendarMonth(entries, 2026, 7);
    const cell = days.find((d) => d.isCurrentMonth && d.date.getDate() === 15)!;
    expect(cell.entries.map((e) => e.task.id)).toEqual(["early", "late"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/calendar.test.ts
```

Expected: FAIL — `Cannot find module '../calendar'`.

- [ ] **Step 4: Implement**

Create `src/domain/calendar.ts`:

```ts
import type { Task } from "@/db/schema/task";
import { isSameCalendarDay, type DashboardEntry } from "./dashboard";

type Priority = Task["priority"];

const PRIORITY_ORDER: Priority[] = ["Alta", "Media", "Baja"];

export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  priorityDots: Priority[];
  entries: DashboardEntry[];
}

/**
 * 03-business-rules.md §16: builds a Monday-first month grid (leading/
 * trailing days from adjacent months fill out partial weeks). Each day's
 * `priorityDots` is one dot per distinct priority present that day (Alta >
 * Media > Baja, deduped) — §16 explicitly leaves multi-task visual
 * treatment as an implementation decision; this is the resolved choice,
 * not a product-level rule. `entries` includes ALL tasks due that day
 * regardless of completion status — unlike the Dashboard's widgets (§15),
 * §16 does not state a completed-task exclusion for the day indicator.
 */
export function buildCalendarMonth(
  entries: DashboardEntry[],
  year: number,
  month: number,
): CalendarDay[] {
  const firstOfMonth = new Date(year, month, 1);
  const mondayFirstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayFirstWeekday);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((mondayFirstWeekday + daysInMonth) / 7) * 7;

  const days: CalendarDay[] = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dayEntries = entries
      .filter((item) => isSameCalendarDay(item.task.dueDateTime, date))
      .sort((a, b) => a.task.dueDateTime.getTime() - b.task.dueDateTime.getTime());
    const priorityDots = PRIORITY_ORDER.filter((priority) =>
      dayEntries.some((item) => item.task.priority === priority),
    );
    days.push({
      date,
      isCurrentMonth: date.getMonth() === month,
      priorityDots,
      entries: dayEntries,
    });
  }
  return days;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/calendar.test.ts src/domain/__tests__/dashboard.test.ts
```

- [ ] **Step 6: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check src/domain/calendar.ts src/domain/__tests__/calendar.test.ts src/domain/dashboard.ts
```

- [ ] **Step 7: Remove the local `isSameCalendarDay` duplicate from the Home screen**

In `app/(tabs)/index.tsx`, `dashboard.ts`'s `isSameCalendarDay` is now genuinely exported (Step 1 above), so the local private duplicate added during Phase 6.5/6.6 is no longer needed. Delete this whole block:

```ts
// Duplicated from src/domain/dashboard.ts's private helper of the same
// name (not exported there — exporting it is Phase 7's own Task 1, a
// separate, not-yet-executed change; this task must not touch
// dashboard.ts's exports per Hard Constraint #1, so this 4-line helper is
// intentionally duplicated here rather than imported).
function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
```

And change the import line from:

```ts
import { buildDashboardSummary, greetingForHour, type DashboardEntry } from "@/domain/dashboard";
```

to:

```ts
import {
  buildDashboardSummary,
  greetingForHour,
  isSameCalendarDay,
  type DashboardEntry,
} from "@/domain/dashboard";
```

Every call site of `isSameCalendarDay` inside `app/(tabs)/index.tsx` (in `formatDueLabel`) stays exactly as it is — only the function's origin changes, from a local duplicate to the real import.

- [ ] **Step 8: Run the full combined check again (now covering the Home screen too)**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check src/domain/calendar.ts src/domain/__tests__/calendar.test.ts src/domain/dashboard.ts "app/(tabs)/index.tsx"
npm test
```

`npm test` should stay at 166/166 (18 suites) — this is a pure refactor (same logic, different origin), no test should need to change.

- [ ] **Step 9: Commit**

```bash
git add src/domain/calendar.ts src/domain/__tests__/calendar.test.ts src/domain/dashboard.ts "app/(tabs)/index.tsx"
git commit -m "feat: add calendar month-grid domain selectors (TDD)"
```

---

### Task 2: `CalendarDayPanel` presentational component (pilot component test #1)

**Files:**
- Create: `src/components/CalendarDayPanel.tsx`
- Create: `src/components/__tests__/CalendarDayPanel.test.tsx`

**Interfaces:**
- Consumes: `type SubjectColor` from `@/db/repositories/subject`; `type TaskStatus` from `@/domain/task-status`; `colors`, `priorityColors`, `subjectPalette` from `@/theme`.
- Produces: `interface CalendarDayPanelEntry { taskId: string; title: string; subjectName: string | undefined; subjectColor: SubjectColor | undefined; priority: "Alta" | "Media" | "Baja"; status: TaskStatus }`, `CalendarDayPanel({ date, entries, onTaskPress }: { date: Date; entries: CalendarDayPanelEntry[]; onTaskPress: (taskId: string) => void })` — a presentational component (zero `@/db` or `@/db/repositories/*` value imports beyond the `SubjectColor` type-only import, matching `AttachmentList.tsx`'s presentation-only boundary).

- [ ] **Step 1: Write the failing component tests**

Create `src/components/__tests__/CalendarDayPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { CalendarDayPanel } from "../CalendarDayPanel";

describe("CalendarDayPanel", () => {
  it("renders each task's title, subject name, and priority as a dot plus text label (03-business-rules.md §18: never color alone)", () => {
    render(
      <CalendarDayPanel
        date={new Date(2026, 7, 20)}
        entries={[
          {
            taskId: "t1",
            title: "Entregar ensayo",
            subjectName: "Historia",
            subjectColor: "indigo",
            priority: "Alta",
            status: "Pendiente",
          },
        ]}
        onTaskPress={jest.fn()}
      />,
    );

    expect(screen.getByText("Entregar ensayo")).toBeTruthy();
    expect(screen.getByText("Historia")).toBeTruthy();
    expect(screen.getByText("Alta")).toBeTruthy();
  });

  it("shows a 'N Pendientes' badge counting only entries with status Pendiente (visual cue borrowed from calendario_unitask.png, guía-not-spec)", () => {
    render(
      <CalendarDayPanel
        date={new Date(2026, 7, 20)}
        entries={[
          {
            taskId: "t1",
            title: "Tarea pendiente",
            subjectName: "Historia",
            subjectColor: "indigo",
            priority: "Alta",
            status: "Pendiente",
          },
          {
            taskId: "t2",
            title: "Tarea completada",
            subjectName: "Historia",
            subjectColor: "indigo",
            priority: "Media",
            status: "Completada",
          },
        ]}
        onTaskPress={jest.fn()}
      />,
    );

    expect(screen.getByText("1 Pendiente")).toBeTruthy();
  });

  it("shows an empty-state message when the day has no tasks", () => {
    render(<CalendarDayPanel date={new Date(2026, 7, 20)} entries={[]} onTaskPress={jest.fn()} />);

    expect(screen.getByText("No hay tareas para este día.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/components/__tests__/CalendarDayPanel.test.tsx
```

Expected: FAIL — `Cannot find module '../CalendarDayPanel'`.

- [ ] **Step 3: Implement**

Create `src/components/CalendarDayPanel.tsx`:

```tsx
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { SubjectColor } from "@/db/repositories/subject";
import type { TaskStatus } from "@/domain/task-status";
import { colors, priorityColors, subjectPalette } from "@/theme";

export interface CalendarDayPanelEntry {
  taskId: string;
  title: string;
  subjectName: string | undefined;
  subjectColor: SubjectColor | undefined;
  priority: "Alta" | "Media" | "Baja";
  status: TaskStatus;
}

interface CalendarDayPanelProps {
  date: Date;
  entries: CalendarDayPanelEntry[];
  onTaskPress: (taskId: string) => void;
}

function formatDayHeader(date: Date): string {
  return date.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}

export function CalendarDayPanel({ date, entries, onTaskPress }: CalendarDayPanelProps) {
  const pendientesCount = entries.filter((item) => item.status === "Pendiente").length;
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>{formatDayHeader(date)}</Text>
        {entries.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {pendientesCount} {pendientesCount === 1 ? "Pendiente" : "Pendientes"}
            </Text>
          </View>
        )}
      </View>
      {entries.length === 0 ? (
        <Text style={styles.emptyText}>No hay tareas para este día.</Text>
      ) : (
        entries.map((item) => (
          <TouchableOpacity
            key={item.taskId}
            style={styles.row}
            onPress={() => onTaskPress(item.taskId)}
          >
            <View style={styles.rowBody}>
              <Text style={styles.title}>{item.title}</Text>
              <View style={styles.metaRow}>
                {item.subjectName && item.subjectColor && (
                  <View style={styles.metaChip}>
                    <View
                      style={[styles.dot, { backgroundColor: subjectPalette[item.subjectColor] }]}
                    />
                    <Text style={styles.metaText}>{item.subjectName}</Text>
                  </View>
                )}
                <View style={styles.metaChip}>
                  <View style={[styles.dot, { backgroundColor: priorityColors[item.priority] }]} />
                  <Text style={styles.metaText}>{item.priority}</Text>
                </View>
              </View>
            </View>
            <Text style={styles.status}>{item.status}</Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  header: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    textTransform: "capitalize",
  },
  badge: {
    backgroundColor: colors.primaryTint,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, fontWeight: "600", color: colors.primary },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  rowBody: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: "600", color: colors.text },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metaText: { fontSize: 12, color: colors.textMuted },
  status: { fontSize: 12, color: colors.textMuted },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/components/__tests__/CalendarDayPanel.test.tsx
```

If this fails with an RTL/Jest environment error (not a straightforward assertion failure), STOP and report per this plan's Global Constraint on the component-test pilot — do not spend extended effort debugging the test environment.

- [ ] **Step 5: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check src/components/CalendarDayPanel.tsx src/components/__tests__/CalendarDayPanel.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/components/CalendarDayPanel.tsx src/components/__tests__/CalendarDayPanel.test.tsx
git commit -m "feat: add CalendarDayPanel component (pilot component test)"
```

---

### Task 3: `CalendarAddTaskFab` component + `nueva.tsx` date pre-fill (pilot component test #2)

**Files:**
- Create: `src/components/CalendarAddTaskFab.tsx`
- Create: `src/components/__tests__/CalendarAddTaskFab.test.tsx`
- Modify: `app/tarea/nueva.tsx` — accept an optional `dueDate` route param and pre-fill `TaskForm`'s `initialValues.dueDate`.

**Interfaces:**
- Consumes: `router` from `expo-router`; `colors` from `@/theme`; `TaskForm`'s existing `initialValues?: Partial<TaskFormValues>` prop (`app/tarea/nueva.tsx` already imports `TaskForm` — no new import needed there beyond `useLocalSearchParams`).
- Produces: `CalendarAddTaskFab({ selectedDate }: { selectedDate: Date })` (used by Task 4's screen wiring).

- [ ] **Step 1: Write the failing component test**

Create `src/components/__tests__/CalendarAddTaskFab.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { CalendarAddTaskFab } from "../CalendarAddTaskFab";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

describe("CalendarAddTaskFab", () => {
  it("navigates to /tarea/nueva with the selected day pre-filled as the dueDate param", () => {
    const selectedDate = new Date(2026, 7, 20);
    render(<CalendarAddTaskFab selectedDate={selectedDate} />);

    fireEvent.press(screen.getByText("+"));

    expect(router.push).toHaveBeenCalledWith({
      pathname: "/tarea/nueva",
      params: { dueDate: selectedDate.toISOString() },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/components/__tests__/CalendarAddTaskFab.test.tsx
```

Expected: FAIL — `Cannot find module '../CalendarAddTaskFab'`.

If mocking `expo-router` produces an unexpected environment error (not a straightforward assertion failure), STOP and report per this plan's Global Constraint on the component-test pilot.

- [ ] **Step 3: Implement `CalendarAddTaskFab`**

Create `src/components/CalendarAddTaskFab.tsx`:

```tsx
import { router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity } from "react-native";

import { colors } from "@/theme";

interface CalendarAddTaskFabProps {
  selectedDate: Date;
}

/**
 * 11-roadmap.md Phase 7: "contextual 'Añadir tarea' pre-filling the
 * selected date" — passes the currently selected calendar day as a route
 * param so app/tarea/nueva.tsx can pre-fill TaskForm's dueDate field.
 */
export function CalendarAddTaskFab({ selectedDate }: CalendarAddTaskFabProps) {
  function handlePress() {
    router.push({
      pathname: "/tarea/nueva",
      params: { dueDate: selectedDate.toISOString() },
    });
  }

  return (
    <TouchableOpacity style={styles.fab} onPress={handlePress}>
      <Text style={styles.fabText}>+</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  fabText: { color: "#FFFFFF", fontSize: 28, lineHeight: 30 },
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/components/__tests__/CalendarAddTaskFab.test.tsx
```

- [ ] **Step 5: Wire the `dueDate` param into `app/tarea/nueva.tsx`**

In `app/tarea/nueva.tsx`, change the `expo-router` import from:

```ts
import { router } from "expo-router";
```

to:

```ts
import { router, useLocalSearchParams } from "expo-router";
```

Inside `NuevaTareaScreen`, after the existing `loaded` calculation, add:

```ts
const { dueDate: dueDateParam } = useLocalSearchParams<{ dueDate?: string }>();
const parsedDueDate = dueDateParam ? new Date(dueDateParam) : undefined;
const initialDueDate =
  parsedDueDate && !Number.isNaN(parsedDueDate.getTime()) ? parsedDueDate : undefined;
```

In the `<TaskForm ...>` element (inside the `else` branch that renders the form), add the `initialValues` prop:

```tsx
<TaskForm
  subjects={activeSubjects as TaskFormSubjectOption[]}
  initialValues={initialDueDate ? { dueDate: initialDueDate } : undefined}
  submitLabel="Crear tarea"
  onSubmit={handleSubmit}
  footer={
```

(Leave the rest of the `footer` block and everything else in the file unchanged.)

- [ ] **Step 6: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check src/components/CalendarAddTaskFab.tsx src/components/__tests__/CalendarAddTaskFab.test.tsx "app/tarea/nueva.tsx"
```

- [ ] **Step 7: Commit**

```bash
git add src/components/CalendarAddTaskFab.tsx src/components/__tests__/CalendarAddTaskFab.test.tsx "app/tarea/nueva.tsx"
git commit -m "feat: add CalendarAddTaskFab and dueDate pre-fill in nueva tarea (pilot component test)"
```

---

### Task 4: Wire the Calendario screen

**Files:**
- Modify: `app/(tabs)/calendario/index.tsx` (currently a placeholder — full replacement)

**Interfaces:**
- Consumes: `buildCalendarMonth`, `type CalendarDay` from `@/domain/calendar` (Task 1); `isSameCalendarDay`, `type DashboardEntry` from `@/domain/dashboard`; `CalendarDayPanel`, `type CalendarDayPanelEntry` from `@/components/CalendarDayPanel` (Task 2); `CalendarAddTaskFab` from `@/components/CalendarAddTaskFab` (Task 3); `deriveTaskStatus` from `@/domain/task-status`; `calculateTaskProgress` from `@/domain/task-progress`; `db`, schema tables (`semesters`, `subjects`, `tasks`, `subtasks`) — same imports as `tareas/index.tsx`; `colors`, `priorityColors` from `@/theme`; `router` from `expo-router`.
- Produces: nothing consumed elsewhere (leaf screen).

- [ ] **Step 1: Replace the placeholder with the full screen**

Replace the entire contents of `app/(tabs)/calendario/index.tsx` with:

```tsx
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { CalendarAddTaskFab } from "@/components/CalendarAddTaskFab";
import { CalendarDayPanel, type CalendarDayPanelEntry } from "@/components/CalendarDayPanel";
import { db } from "@/db/client";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks } from "@/db/schema/task";
import { buildCalendarMonth } from "@/domain/calendar";
import { isSameCalendarDay, type DashboardEntry } from "@/domain/dashboard";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus } from "@/domain/task-status";
import { colors, priorityColors } from "@/theme";

function formatMonthHeader(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("es", { month: "long", year: "numeric" });
}

// Monday-first single-letter weekday header (visual cue from
// calendario_unitask.png — "guía, no spec"), matching this module's own
// Monday-first grid convention in src/domain/calendar.ts.
const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

export default function CalendarioScreen() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);

  // Status (esp. Vencida) is time-derived and must not go stale across a
  // long-open session — same tick as tareas/index.tsx. Phase 6's
  // whole-branch review flagged the Home screen's initial omission of this
  // as an Important finding; this screen ships with it from the start.
  const [, forceStatusRecompute] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceStatusRecompute((tick) => tick + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data: activeSemesterRows, updatedAt: semesterUpdatedAt } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;

  const { data: subjectRows, updatedAt: subjectsUpdatedAt } = useLiveQuery(
    db.select().from(subjects),
  );
  const activeSubjectIds = new Set(
    (subjectRows ?? [])
      .filter((subject) => subject.semesterId === activeSemesterId)
      .map((subject) => subject.id),
  );
  const subjectsById = new Map((subjectRows ?? []).map((subject) => [subject.id, subject]));

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

  const days = buildCalendarMonth(entries, viewYear, viewMonth);
  const selectedDay = days.find((day) => isSameCalendarDay(day.date, selectedDate));
  const panelEntries: CalendarDayPanelEntry[] = (selectedDay?.entries ?? []).map((item) => {
    const subject = subjectsById.get(item.task.subjectId);
    return {
      taskId: item.task.id,
      title: item.task.title,
      subjectName: subject?.name,
      subjectColor: subject?.color,
      priority: item.task.priority,
      status: item.status,
    };
  });

  function goToPreviousMonth() {
    const prev = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(prev.getFullYear());
    setViewMonth(prev.getMonth());
  }

  function goToNextMonth() {
    const next = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goToPreviousMonth}>
          <Text style={styles.navArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{formatMonthHeader(viewYear, viewMonth)}</Text>
        <TouchableOpacity onPress={goToNextMonth}>
          <Text style={styles.navArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {!loaded ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Cargando…</Text>
        </View>
      ) : (
        <ScrollView>
          <View style={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((label, index) => (
              <Text key={`${label}-${index}`} style={styles.weekdayLabel}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {days.map((day) => {
              const isSelected = isSameCalendarDay(day.date, selectedDate);
              return (
                <TouchableOpacity
                  key={day.date.toISOString()}
                  style={[
                    styles.dayCell,
                    isSelected && styles.dayCellSelected,
                    !day.isCurrentMonth && styles.dayCellDimmed,
                  ]}
                  onPress={() => setSelectedDate(day.date)}
                >
                  <Text
                    style={[
                      styles.dayNumber,
                      !day.isCurrentMonth && styles.dayNumberDimmed,
                      isSelected && styles.dayNumberSelected,
                    ]}
                  >
                    {day.date.getDate()}
                  </Text>
                  <View style={styles.dotsRow}>
                    {day.priorityDots.map((priority) => (
                      <View
                        key={priority}
                        style={[styles.dot, { backgroundColor: priorityColors[priority] }]}
                      />
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <CalendarDayPanel
            date={selectedDate}
            entries={panelEntries}
            onTaskPress={(taskId) => router.push(`/tarea/${taskId}`)}
          />
        </ScrollView>
      )}

      <CalendarAddTaskFab selectedDate={selectedDate} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
  },
  navArrow: { fontSize: 24, color: colors.primary, paddingHorizontal: 12 },
  monthTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    textTransform: "capitalize",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.textMuted },
  weekdayRow: { flexDirection: "row", paddingHorizontal: 12, paddingBottom: 4 },
  weekdayLabel: {
    width: "14.28%",
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12 },
  dayCell: {
    width: "14.28%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  dayCellSelected: { backgroundColor: colors.primary, borderRadius: 999 },
  dayCellDimmed: { opacity: 0.4 },
  dayNumber: { fontSize: 14, color: colors.text },
  dayNumberDimmed: { color: colors.textMuted },
  dayNumberSelected: { color: "#FFFFFF", fontWeight: "700" },
  dotsRow: { flexDirection: "row", gap: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
```

- [ ] **Step 2: Verify TypeScript, lint, and prettier are clean**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check "app/(tabs)/calendario/index.tsx"
```

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/calendario/index.tsx"
git commit -m "feat: wire the Calendario month-view screen"
```

---

### Task 5: Full Phase 7 Definition of Done verification

**Files:** none (verification-only task).

**Verification split (added when the human approved execution — do not spend tokens driving an emulator for this phase):** the implementer runs the automated combined check only and produces an on-device checklist document; the human performs the actual on-device walkthrough themselves, using that checklist, exactly like Phase 6.6/6.5b/6.5c's rounds.

- [ ] **Step 1: Run the full combined check**

```bash
npm test
npx tsc --noEmit
npm run lint
npx prettier --check .
```

Expected: all green, no regressions in any suite from Phases 0-6. If anything fails, fix it, re-verify, and commit the fix before proceeding to Step 2 (a real bug found here is a real bug to fix, not to defer to the human's checklist).

- [ ] **Step 2: Write the on-device checklist for the human**

Write `.superpowers/sdd/phase7-device-checklist.md` — a short, numbered checklist the human can walk through themselves on their own device, no agent involvement. Base it on:

1. Open the Calendario tab — confirm the month grid shows the current month, weekday letters (L M M J V S D) above it, starting the week on Monday, with dimmed leading/trailing days from adjacent months.
2. Confirm a day with a task due on it shows the correct priority-colored dot(s); a day with tasks of two different priorities shows two dots, not one per task.
3. Tap a day — confirm the inline day panel below the grid updates to that day's tasks (title, subject, priority as dot + text label, "N Pendiente(s)" badge next to the date), and the screen never navigates away from Calendario. Confirm the selected day renders as a filled circle.
4. Tap a day with no tasks — confirm the empty-state message appears (and no badge shows).
5. Tap "Añadir tarea" with a specific day selected — confirm the new-task form opens with that day pre-filled as the due date (time defaults to now, unchanged).
6. Tap a task in the day panel — confirm it navigates to that task's detail screen.
7. Navigate to the previous/next month using the arrows — confirm the grid updates and dots reflect that month's tasks correctly.
8. If reachable without destructive action: close the active semester (or find a state with no active semester) and confirm the calendar behaves sensibly (empty grid/dots, not a crash). **Do not perform this check yourself if it requires an irreversible action on real data** — leave it for the human to decide whether to try, same data-safety precedent as Phase 5's Task 7 and Phase 6's Task 3.

Add a short "Known deliberate deviations from the mockup" note at the top of the checklist (the 3 items from this plan's Global Constraints — no Mes/Semana/Día toggle, no checkbox/quick-complete, no priority-only stripe) so the human isn't surprised by their absence when comparing against `calendario_unitask.png`.

- [ ] **Step 3: Write the Phase 7 implementation report**

Write `.superpowers/sdd/task-5-report.md` (check first whether a stale report from an earlier phase's differently-numbered final task exists at a colliding path — this project has hit that collision before — overwrite if so). Include the combined-check output and a pointer to the checklist file from Step 2.

- [ ] **Step 4: No commit expected for the checklist itself**

The checklist and report are working documents (matching this project's `.superpowers/sdd/` convention — no commit needed for them). Only commit if Step 1 surfaced and required a real fix.
