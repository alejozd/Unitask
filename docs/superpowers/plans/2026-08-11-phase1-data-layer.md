# Phase 1 — Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the complete Drizzle ORM schema for all 7 UniTask entities (Semester, Subject, Task, Subtask, Reminder, Attachment, Settings) and the pure, React/SQLite-free business-logic functions in `src/domain` that encode every automatic rule from `docs/03-business-rules.md` — matching `docs/11-roadmap.md` Phase 1.

**Architecture:** Follows `docs/07-architecture.md`'s layering exactly: `src/db/schema/*.ts` (typed Drizzle table definitions, one file per entity) is the persistence layer; `src/domain/*.ts` (plain TypeScript functions, no React, no SQLite import) is the business-logic layer. No UI, no Expo Router routes, no repository/query functions, no Zustand — those are later phases. Per the user's global "Strict TDD Mode," every domain function is written test-first: a failing test encoding the exact rule from `03-business-rules.md`, then the minimal implementation to pass it.

**Tech Stack:** Drizzle ORM (`drizzle-orm/sqlite-core` for schema, already installed at `drizzle-orm@0.45.x`), `drizzle-kit@0.31.x` for migration generation, `better-sqlite3` + `drizzle-orm/better-sqlite3` (new, Node-only dev dependency) for a schema/migration integration test that doesn't need the Expo/RN runtime, Jest (already configured) for domain unit tests.

## Global Constraints

- **No feature code beyond schema + domain logic** — no repository/query functions, no UI, no Expo Router routes, no Zustand store. Those are Phase 2+.
- **No on-device migration wiring in this phase** — `babel.config.js`, `metro.config.js`, and the `useMigrations` app hook are explicitly deferred to Phase 2 (the first phase that actually opens a real on-device database). Do not create `babel.config.js` or `metro.config.js` in this plan (see `docs/superpowers/plans/2026-08-10-phase0-scaffolding.md` Task 1's note: a hand-written `babel.config.js` breaks this Expo SDK's build; only `npx expo customize babel.config.js` produces a working one, and that step belongs to Phase 2).
- **Domain functions are pure**: no `import` of anything from `src/db`, `expo-sqlite`, `react`, or `react-native` inside any `src/domain/*.ts` file. They take plain objects/primitives and return plain objects/primitives.
- **UUID primary keys** for every entity (`docs/06-data-model.md`): `id: text("id").primaryKey()`, populated by the caller (repository layer, Phase 2+) — schema files never generate IDs themselves.
- **Timestamps stored as SQLite integer epoch millis** via Drizzle's `{ mode: "timestamp" }` column option (this phase's own decision — `docs/06-data-model.md` left the exact column type as "not a discovery-phase decision"). Every `createdAt`/`updatedAt`/`closedAt`/etc. column uses `integer("snake_case_name", { mode: "timestamp" })`.
- **Booleans stored as SQLite integers** via Drizzle's `{ mode: "boolean" }` column option.
- **Enums stored as `text(..., { enum: [...] })`** columns, never as separate lookup tables (per `docs/06-data-model.md`'s field tables, which describe them as `enum(...)` string columns).
- **DB column names are `snake_case`**, TypeScript property names are `camelCase` (standard Drizzle convention) — e.g. `courseCode: text("course_code")`.
- **Table names are plural, `snake_case`**: `semesters`, `subjects`, `tasks`, `subtasks`, `reminders`, `attachments`, `settings`.
- Use `npx`/`npm` for all CLI tool invocations; do not install any CLI tool globally.

---

### Task 1: Semester and Subject schema

**Files:**
- Create: `src/db/schema/semester.ts`, `src/db/schema/subject.ts`

**Interfaces:**
- Consumes: nothing new (Task 2 of Phase 0 scaffolded the empty `src/db/schema/` folder; this task adds real content).
- Produces: `semesters` table (exported from `semester.ts`) and `subjects` table (exported from `subject.ts`), consumed by Task 2's `tasks` table (`subjectId` FK) and every later task that touches these entities. Also produces the `SUBJECT_COLORS` palette constant, consumed by Phase 2's subject-creation UI.

- [ ] **Step 1: Create the Semester table**

Create `src/db/schema/semester.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const semesters = sqliteTable("semesters", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  status: text("status", { enum: ["active", "closed"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  closedAt: integer("closed_at", { mode: "timestamp" }),
});
```

This matches `docs/06-data-model.md`'s Semester table field-for-field: `id` (UUID PK), `label` (required string), `status` (`active`/`closed` enum), `createdAt` (required), `closedAt` (nullable, set only when closed — per `03-business-rules.md` §10).

- [ ] **Step 2: Create the Subject table with its fixed color palette**

Create `src/db/schema/subject.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { semesters } from "./semester";

/**
 * Fixed subject color palette (03-business-rules.md §8) — deliberately
 * excludes the priority-red (#EF4444) to avoid a student confusing a
 * subject's color with a task's High-priority stripe. Stored as an enum
 * key, never a raw hex value.
 */
export const SUBJECT_COLORS = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "teal",
  "fuchsia",
  "cyan",
  "slate",
] as const;

export const subjects = sqliteTable("subjects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  courseCode: text("course_code"),
  professorName: text("professor_name"),
  color: text("color", { enum: SUBJECT_COLORS }).notNull(),
  semesterId: text("semester_id")
    .notNull()
    .references(() => semesters.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

This matches `docs/06-data-model.md`'s Subject table: `id`, `name` (required), `courseCode` (nullable), `professorName` (nullable), `color` (required, palette enum), `semesterId` (required FK), `createdAt`/`updatedAt` (required).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/semester.ts src/db/schema/subject.ts
git commit -m "feat: add Semester and Subject Drizzle schema"
```

---

### Task 2: Task and Subtask schema

**Files:**
- Create: `src/db/schema/task.ts`, `src/db/schema/subtask.ts`

**Interfaces:**
- Consumes: `subjects` from `src/db/schema/subject.ts` (Task 1).
- Produces: `tasks` table and `subtasks` table, consumed by Task 3's `reminders`/`attachments` tables (`taskId` FK).

- [ ] **Step 1: Create the Task table**

Create `src/db/schema/task.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { subjects } from "./subject";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  // Combined date+time (03-business-rules.md / 06-data-model.md assumption:
  // the "due date" and "due time" form fields persist as one instant, since
  // every rule — status, "vencida", reminder offsets — operates on a single
  // timestamp).
  dueDateTime: integer("due_date_time", { mode: "timestamp" }).notNull(),
  priority: text("priority", { enum: ["Alta", "Media", "Baja"] }).notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  completedLate: integer("completed_late", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

This matches `docs/06-data-model.md`'s Task table. Status label, "vencida", and progress % are deliberately **not** columns — they're derived at read time by `src/domain/task-status.ts` and `src/domain/task-progress.ts` (Tasks 5 of this plan).

- [ ] **Step 2: Create the Subtask table**

Create `src/db/schema/subtask.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { tasks } from "./task";

export const subtasks = sqliteTable("subtasks", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  text: text("text").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  order: integer("order").notNull(),
});
```

This matches `docs/06-data-model.md`'s Subtask table: no individual due date/reminder/priority — those exist only on the parent Task, per that doc's explicit note.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/task.ts src/db/schema/subtask.ts
git commit -m "feat: add Task and Subtask Drizzle schema"
```

---

### Task 3: Reminder and Attachment schema

**Files:**
- Create: `src/db/schema/reminder.ts`, `src/db/schema/attachment.ts`

**Interfaces:**
- Consumes: `tasks` from `src/db/schema/task.ts` (Task 2).
- Produces: `reminders` table and `attachments` table, consumed by Task 4's schema barrel and by Task 7's `reminder-scheduling.ts` domain logic (which operates on plain objects shaped like these rows, not the Drizzle table itself — see Task 7's Interfaces section).

- [ ] **Step 1: Create the Reminder table**

Create `src/db/schema/reminder.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { tasks } from "./task";

export const reminders = sqliteTable("reminders", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  kind: text("kind", { enum: ["relative", "fixed"] }).notNull(),
  // Required when kind = "relative", null when kind = "fixed".
  offsetValue: integer("offset_value"),
  offsetUnit: text("offset_unit", { enum: ["minutes", "hours", "days"] }),
  // Required when kind = "fixed", null when kind = "relative".
  fixedDateTime: integer("fixed_date_time", { mode: "timestamp" }),
  // Always populated: for "relative", computed as dueDateTime - offset;
  // for "fixed", equal to fixedDateTime. Kept up to date by the repository
  // layer (Phase 4) using src/domain/reminder-scheduling.ts's pure math.
  computedFireAt: integer("computed_fire_at", { mode: "timestamp" }).notNull(),
  // The id expo-notifications returns when the OS notification is
  // scheduled; null once fired or cancelled.
  notificationId: text("notification_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

This matches `docs/06-data-model.md`'s Reminder table exactly.

- [ ] **Step 2: Create the Attachment table**

Create `src/db/schema/attachment.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { tasks } from "./task";

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  originalFileName: text("original_file_name").notNull(),
  storedPath: text("stored_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

This matches `docs/06-data-model.md`'s Attachment table exactly.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/reminder.ts src/db/schema/attachment.ts
git commit -m "feat: add Reminder and Attachment Drizzle schema"
```

---

### Task 4: Settings schema, schema barrel, client re-wire, and first real migration

**Files:**
- Create: `src/db/schema/settings.ts`
- Modify: `src/db/schema/index.ts` (currently `export {};` from Phase 0 — replace with real re-exports), `src/db/client.ts` (currently `drizzle(sqlite)` with no schema, per Phase 0's deferred fix)
- Create: `src/db/__tests__/migrations.integration.test.ts`
- Migrations: `npx drizzle-kit generate` will write new files under `src/db/migrations/`

**Interfaces:**
- Consumes: `semesters`, `subjects`, `tasks`, `subtasks`, `reminders`, `attachments` from Tasks 1-3.
- Produces: `db` (now schema-aware) exported from `src/db/client.ts`, consumed by every repository function starting in Phase 2. Also produces the first real `.sql` migration file, proving the whole schema is valid SQLite DDL.

- [ ] **Step 1: Create the Settings table**

Create `src/db/schema/settings.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

This matches `docs/06-data-model.md`'s Settings table: a deliberately minimal singleton row (no theme field, no notification-toggle field — see that doc's note on why).

- [ ] **Step 2: Wire the schema barrel**

Replace `src/db/schema/index.ts` (currently `export {};`) with:

```ts
export * from "./semester";
export * from "./subject";
export * from "./task";
export * from "./subtask";
export * from "./reminder";
export * from "./attachment";
export * from "./settings";
```

- [ ] **Step 3: Re-wire the Drizzle client with the real schema**

Replace `src/db/client.ts` with:

```ts
import { openDatabaseSync } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";

import * as schema from "./schema";

const sqlite = openDatabaseSync("unitask.db", { enableChangeListener: true });

export const db = drizzle(sqlite, { schema });
```

This is the fix Phase 0 deferred (see that plan's Task 5 note): `./schema` now has real exports, so the namespace import is meaningful and no longer trips ESLint's `import/namespace` rule.

- [ ] **Step 4: Verify TypeScript compiles and lint passes**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0, no errors.

- [ ] **Step 5: Generate the first real migration**

```bash
npx drizzle-kit generate
```

Expected: exits 0; writes a new `src/db/migrations/0000_*.sql` file (unlike Phase 0's empty-schema run, this one has 7 tables to emit `CREATE TABLE` statements for) plus an updated `src/db/migrations/meta/_journal.json` with one entry.

- [ ] **Step 6: Install `better-sqlite3` for a Node-side migration integration test**

```bash
npm install --save-dev better-sqlite3 @types/better-sqlite3
```

This is a dev-only dependency, used exclusively by the test below to apply the generated `.sql` migration against a real (in-memory) SQLite database in plain Node/Jest — proving the migration is valid DDL without needing the Expo/RN runtime (per `docs/10-testing-strategy.md`: "Drizzle queries / persistence: Jest against an in-memory/test SQLite instance").

- [ ] **Step 7: Write the migration integration test**

Create `src/db/__tests__/migrations.integration.test.ts`:

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

describe("schema migrations", () => {
  it("apply cleanly to a fresh SQLite database and create every table", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);

    migrate(db, { migrationsFolder: "src/db/migrations" });

    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tableNames).toEqual([
      "__drizzle_migrations",
      "attachments",
      "reminders",
      "semesters",
      "settings",
      "subjects",
      "subtasks",
      "tasks",
    ]);

    sqlite.close();
  });

  it("enforces the Subject -> Semester foreign key", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);

    migrate(db, { migrationsFolder: "src/db/migrations" });

    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO subjects (id, name, color, semester_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("subj-1", "Cálculo II", "indigo", "does-not-exist", Date.now(), Date.now());
    }).toThrow(/FOREIGN KEY constraint failed/);

    sqlite.close();
  });
});
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
npx jest src/db/__tests__/migrations.integration.test.ts
```

Expected: 2 tests passed. If the first test's `tableNames` array doesn't match (e.g. a table is missing), that means Step 5's `drizzle-kit generate` didn't actually emit `CREATE TABLE` statements for every schema file — stop and investigate before continuing, don't adjust the expected array to match a broken migration.

- [ ] **Step 9: Run the full test suite and lint one more time**

```bash
npm test
npm run lint
npx tsc --noEmit
```

Expected: all exit 0. `npm test` should now show 2 suites (the Phase 0 alias smoke test + this migration test), both passing.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema/settings.ts src/db/schema/index.ts src/db/client.ts src/db/migrations/ src/db/__tests__/migrations.integration.test.ts package.json package-lock.json
git commit -m "feat: wire full Drizzle schema, generate first migration, verify it applies"
```

---

### Task 5: `task-status.ts` and `task-progress.ts`

**Files:**
- Create: `src/domain/task-status.ts`, `src/domain/task-progress.ts`
- Test: `src/domain/__tests__/task-status.test.ts`, `src/domain/__tests__/task-progress.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no dependency on Tasks 1-4's schema files).
- Produces:
  - `deriveTaskStatus(input: TaskStatusInput): TaskStatus` from `task-status.ts`, where `TaskStatus = "Pendiente" | "En progreso" | "Completada" | "Vencida"` and `TaskStatusInput = { completed: boolean; dueDateTime: Date; progress: number; now?: Date }`.
  - `calculateTaskProgress(subtasks: { completed: boolean }[], taskCompleted: boolean): number` from `task-progress.ts`, returning an integer 0-100.
  - Both are consumed together starting Phase 3 (task list/detail screens) and by Task 9 of this plan (`subject-deletion.ts`, via the `TaskStatus` type).

- [ ] **Step 1: Write the failing tests for `calculateTaskProgress`**

Create `src/domain/__tests__/task-progress.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/task-progress.test.ts
```

Expected: FAIL — `Cannot find module '@/domain/task-progress'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `task-progress.ts`**

Create `src/domain/task-progress.ts`:

```ts
/**
 * Progress is always derived from subtask completion (03-business-rules.md
 * §2) — never a manual/independent field. A task with zero subtasks is
 * binary: 0% until completed, then 100%.
 */
export function calculateTaskProgress(
  subtasks: { completed: boolean }[],
  taskCompleted: boolean,
): number {
  if (subtasks.length === 0) {
    return taskCompleted ? 100 : 0;
  }
  const completedCount = subtasks.filter((subtask) => subtask.completed).length;
  return Math.round((completedCount / subtasks.length) * 100);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/task-progress.test.ts
```

Expected: 6 tests passed.

- [ ] **Step 5: Write the failing tests for `deriveTaskStatus`**

Create `src/domain/__tests__/task-status.test.ts`:

```ts
import { deriveTaskStatus } from "@/domain/task-status";

describe("deriveTaskStatus", () => {
  const future = new Date("2026-06-01T12:00:00.000Z");
  const past = new Date("2026-01-01T12:00:00.000Z");
  const now = new Date("2026-03-01T12:00:00.000Z");

  it("returns Completada when completed is true, regardless of due date or progress", () => {
    expect(
      deriveTaskStatus({ completed: true, dueDateTime: past, progress: 0, now }),
    ).toBe("Completada");
    expect(
      deriveTaskStatus({ completed: true, dueDateTime: future, progress: 50, now }),
    ).toBe("Completada");
  });

  it("returns Vencida when not completed and due date is in the past", () => {
    expect(
      deriveTaskStatus({ completed: false, dueDateTime: past, progress: 0, now }),
    ).toBe("Vencida");
  });

  it("returns Vencida even with partial progress — Vencida takes priority over En progreso", () => {
    expect(
      deriveTaskStatus({ completed: false, dueDateTime: past, progress: 60, now }),
    ).toBe("Vencida");
  });

  it("returns Pendiente when not completed, due date is in the future, and progress is 0", () => {
    expect(
      deriveTaskStatus({ completed: false, dueDateTime: future, progress: 0, now }),
    ).toBe("Pendiente");
  });

  it("returns En progreso when not completed, due date is in the future, and progress is between 0 and 100", () => {
    expect(
      deriveTaskStatus({ completed: false, dueDateTime: future, progress: 40, now }),
    ).toBe("En progreso");
  });

  it("treats dueDateTime exactly equal to now as NOT overdue (boundary condition)", () => {
    const exactlyNow = new Date(now.getTime());
    expect(
      deriveTaskStatus({ completed: false, dueDateTime: exactlyNow, progress: 0, now }),
    ).toBe("Pendiente");
  });

  it("defaults `now` to the current time when not provided", () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
    expect(
      deriveTaskStatus({ completed: false, dueDateTime: farFuture, progress: 0 }),
    ).toBe("Pendiente");
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/task-status.test.ts
```

Expected: FAIL — `Cannot find module '@/domain/task-status'`.

- [ ] **Step 7: Implement `task-status.ts`**

Create `src/domain/task-status.ts`:

```ts
export type TaskStatus = "Pendiente" | "En progreso" | "Completada" | "Vencida";

export interface TaskStatusInput {
  completed: boolean;
  dueDateTime: Date;
  /** 0-100, from calculateTaskProgress in ./task-progress. */
  progress: number;
  now?: Date;
}

/**
 * Status is never stored — always computed at read time
 * (03-business-rules.md §1, §3). Evaluation order matters: completed wins
 * first, then overdue, then the progress-based Pendiente/En progreso split.
 * An incomplete overdue task is always "Vencida" even with partial
 * progress — Vencida takes priority over En progreso.
 */
export function deriveTaskStatus(input: TaskStatusInput): TaskStatus {
  const now = input.now ?? new Date();

  if (input.completed) {
    return "Completada";
  }
  if (input.dueDateTime.getTime() < now.getTime()) {
    return "Vencida";
  }
  if (input.progress > 0) {
    return "En progreso";
  }
  return "Pendiente";
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/task-status.test.ts
```

Expected: 7 tests passed.

- [ ] **Step 9: Run the full test suite**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/domain/task-status.ts src/domain/task-progress.ts src/domain/__tests__/task-status.test.ts src/domain/__tests__/task-progress.test.ts
git commit -m "feat: add task-status and task-progress derivation (TDD)"
```

---

### Task 6: `task-completion.ts`

**Files:**
- Create: `src/domain/task-completion.ts`
- Test: `src/domain/__tests__/task-completion.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `completeTask(input: CompleteTaskInput): CompleteTaskResult`, consumed starting Phase 3 by both completion entry points (list checkbox and detail-screen button — `03-business-rules.md` §5 requires both to call the same logic).

- [ ] **Step 1: Write the failing tests**

Create `src/domain/__tests__/task-completion.test.ts`:

```ts
import { completeTask } from "@/domain/task-completion";

describe("completeTask", () => {
  it("marks completed true and sets completedAt to now when now is not provided", () => {
    const before = Date.now();
    const result = completeTask({
      dueDateTime: new Date("2026-06-01T12:00:00.000Z"),
      subtasks: [],
    });
    const after = Date.now();

    expect(result.completed).toBe(true);
    expect(result.completedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.completedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("sets completedLate to false when completed on or before the due date", () => {
    const dueDateTime = new Date("2026-06-01T12:00:00.000Z");
    const now = new Date("2026-06-01T11:00:00.000Z");
    const result = completeTask({ dueDateTime, now, subtasks: [] });
    expect(result.completedLate).toBe(false);
  });

  it("sets completedLate to true when completed after the due date", () => {
    const dueDateTime = new Date("2026-06-01T12:00:00.000Z");
    const now = new Date("2026-06-02T00:00:00.000Z");
    const result = completeTask({ dueDateTime, now, subtasks: [] });
    expect(result.completedLate).toBe(true);
  });

  it("sets completedLate to false when completed at exactly the due date instant", () => {
    const dueDateTime = new Date("2026-06-01T12:00:00.000Z");
    const now = new Date(dueDateTime.getTime());
    const result = completeTask({ dueDateTime, now, subtasks: [] });
    expect(result.completedLate).toBe(false);
  });

  it("returns the ids of subtasks that still need to be force-checked", () => {
    const result = completeTask({
      dueDateTime: new Date("2026-06-01T12:00:00.000Z"),
      now: new Date("2026-05-01T00:00:00.000Z"),
      subtasks: [
        { id: "st-1", completed: true },
        { id: "st-2", completed: false },
        { id: "st-3", completed: false },
      ],
    });
    expect(result.subtaskIdsToCheck).toEqual(["st-2", "st-3"]);
  });

  it("returns an empty subtaskIdsToCheck array when all subtasks are already completed", () => {
    const result = completeTask({
      dueDateTime: new Date("2026-06-01T12:00:00.000Z"),
      now: new Date("2026-05-01T00:00:00.000Z"),
      subtasks: [{ id: "st-1", completed: true }],
    });
    expect(result.subtaskIdsToCheck).toEqual([]);
  });

  it("returns an empty subtaskIdsToCheck array when the task has no subtasks", () => {
    const result = completeTask({
      dueDateTime: new Date("2026-06-01T12:00:00.000Z"),
      now: new Date("2026-05-01T00:00:00.000Z"),
      subtasks: [],
    });
    expect(result.subtaskIdsToCheck).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/task-completion.test.ts
```

Expected: FAIL — `Cannot find module '@/domain/task-completion'`.

- [ ] **Step 3: Implement `task-completion.ts`**

Create `src/domain/task-completion.ts`:

```ts
export interface CompleteTaskInput {
  dueDateTime: Date;
  /** Defaults to the current time when not provided. */
  now?: Date;
  subtasks: { id: string; completed: boolean }[];
}

export interface CompleteTaskResult {
  completed: true;
  completedAt: Date;
  /**
   * Computed once, here, at completion time — never recalculated
   * afterward (03-business-rules.md §4). Not surfaced in MVP UI; persisted
   * for a future on-time-completion-rate statistic.
   */
  completedLate: boolean;
  /** Subtask ids the repository layer must force-set to completed = true. */
  subtaskIdsToCheck: string[];
}

/**
 * Both completion entry points (list checkbox, detail-screen button) must
 * call this same function (03-business-rules.md §5) so their behavior can
 * never drift apart.
 */
export function completeTask(input: CompleteTaskInput): CompleteTaskResult {
  const completedAt = input.now ?? new Date();

  return {
    completed: true,
    completedAt,
    completedLate: completedAt.getTime() > input.dueDateTime.getTime(),
    subtaskIdsToCheck: input.subtasks
      .filter((subtask) => !subtask.completed)
      .map((subtask) => subtask.id),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/task-completion.test.ts
```

Expected: 7 tests passed.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/domain/task-completion.ts src/domain/__tests__/task-completion.test.ts
git commit -m "feat: add task-completion logic incl. completedLate (TDD)"
```

---

### Task 7: `reminder-scheduling.ts`

**Files:**
- Create: `src/domain/reminder-scheduling.ts`
- Test: `src/domain/__tests__/reminder-scheduling.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces:
  - `computeFireAt(reminder: ReminderSpec, dueDateTime: Date): Date`
  - `defaultReminder(): RelativeReminder`
  - `rescheduleOnDueDateChange(reminders: ReschedulableReminder[], newDueDateTime: Date, now: Date): RescheduleAction[]`
  - Types `ReminderOffsetUnit`, `RelativeReminder`, `FixedReminder`, `ReminderSpec`, `ReschedulableReminder`, `RescheduleAction` — consumed starting Phase 4 (reminder picker + notification scheduling wiring) and by the repository layer whenever a task's due date is edited.

This is the most complex rule in `docs/03-business-rules.md` (§7) — read it carefully before writing tests.

- [ ] **Step 1: Write the failing tests for `computeFireAt` and `defaultReminder`**

Create `src/domain/__tests__/reminder-scheduling.test.ts`:

```ts
import {
  computeFireAt,
  defaultReminder,
  rescheduleOnDueDateChange,
} from "@/domain/reminder-scheduling";

describe("computeFireAt", () => {
  const dueDateTime = new Date("2026-06-10T12:00:00.000Z");

  it("computes a relative reminder's fire time as dueDateTime minus the offset (days)", () => {
    const fireAt = computeFireAt({ kind: "relative", offsetValue: 1, offsetUnit: "days" }, dueDateTime);
    expect(fireAt).toEqual(new Date("2026-06-09T12:00:00.000Z"));
  });

  it("computes a relative reminder's fire time in hours", () => {
    const fireAt = computeFireAt({ kind: "relative", offsetValue: 2, offsetUnit: "hours" }, dueDateTime);
    expect(fireAt).toEqual(new Date("2026-06-10T10:00:00.000Z"));
  });

  it("computes a relative reminder's fire time in minutes", () => {
    const fireAt = computeFireAt({ kind: "relative", offsetValue: 15, offsetUnit: "minutes" }, dueDateTime);
    expect(fireAt).toEqual(new Date("2026-06-10T11:45:00.000Z"));
  });

  it("returns the fixed datetime unchanged for a fixed reminder", () => {
    const fixedDateTime = new Date("2026-06-05T09:00:00.000Z");
    const fireAt = computeFireAt({ kind: "fixed", fixedDateTime }, dueDateTime);
    expect(fireAt).toEqual(fixedDateTime);
  });
});

describe("defaultReminder", () => {
  it("returns a relative reminder of 1 day before", () => {
    expect(defaultReminder()).toEqual({ kind: "relative", offsetValue: 1, offsetUnit: "days" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/reminder-scheduling.test.ts
```

Expected: FAIL — `Cannot find module '@/domain/reminder-scheduling'`.

- [ ] **Step 3: Implement `computeFireAt` and `defaultReminder`**

Create `src/domain/reminder-scheduling.ts`:

```ts
export type ReminderOffsetUnit = "minutes" | "hours" | "days";

export interface RelativeReminder {
  kind: "relative";
  offsetValue: number;
  offsetUnit: ReminderOffsetUnit;
}

export interface FixedReminder {
  kind: "fixed";
  fixedDateTime: Date;
}

export type ReminderSpec = RelativeReminder | FixedReminder;

const OFFSET_UNIT_TO_MS: Record<ReminderOffsetUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/**
 * For "relative": dueDateTime - offset. For "fixed": the fixed datetime,
 * unchanged (03-business-rules.md §7).
 */
export function computeFireAt(reminder: ReminderSpec, dueDateTime: Date): Date {
  if (reminder.kind === "fixed") {
    return reminder.fixedDateTime;
  }
  const offsetMs = reminder.offsetValue * OFFSET_UNIT_TO_MS[reminder.offsetUnit];
  return new Date(dueDateTime.getTime() - offsetMs);
}

/**
 * Every new task gets this reminder automatically unless the user removes
 * it (03-business-rules.md §7's "1 día antes" default).
 */
export function defaultReminder(): RelativeReminder {
  return { kind: "relative", offsetValue: 1, offsetUnit: "days" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/reminder-scheduling.test.ts
```

Expected: 5 tests passed.

- [ ] **Step 5: Write the failing tests for `rescheduleOnDueDateChange`**

Append to `src/domain/__tests__/reminder-scheduling.test.ts`:

```ts
describe("rescheduleOnDueDateChange", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const newDueDateTime = new Date("2026-06-10T12:00:00.000Z");

  it("leaves already-fired reminders unchanged", () => {
    const actions = rescheduleOnDueDateChange(
      [
        {
          id: "r-1",
          spec: { kind: "relative", offsetValue: 1, offsetUnit: "days" },
          hasFired: true,
        },
      ],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([{ action: "unchanged", id: "r-1" }]);
  });

  it("recomputes and keeps a relative reminder whose new fire time is still in the future", () => {
    const actions = rescheduleOnDueDateChange(
      [
        {
          id: "r-2",
          spec: { kind: "relative", offsetValue: 1, offsetUnit: "days" },
          hasFired: false,
        },
      ],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([
      { action: "keep", id: "r-2", newFireAt: new Date("2026-06-09T12:00:00.000Z") },
    ]);
  });

  it("removes a relative reminder whose recomputed fire time is now in the past", () => {
    // now = 2026-06-01, new due date = 2026-06-02, offset = 3 days before
    // -> new fire time = 2026-05-30, which is before `now`.
    const soonDueDateTime = new Date("2026-06-02T00:00:00.000Z");
    const actions = rescheduleOnDueDateChange(
      [
        {
          id: "r-3",
          spec: { kind: "relative", offsetValue: 3, offsetUnit: "days" },
          hasFired: false,
        },
      ],
      soonDueDateTime,
      now,
    );
    expect(actions).toEqual([{ action: "remove", id: "r-3", reason: "fire-time-in-past" }]);
  });

  it("keeps a fixed reminder that is still before the new due date and still in the future", () => {
    const fixedDateTime = new Date("2026-06-05T00:00:00.000Z");
    const actions = rescheduleOnDueDateChange(
      [{ id: "r-4", spec: { kind: "fixed", fixedDateTime }, hasFired: false }],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([{ action: "keep", id: "r-4", newFireAt: fixedDateTime }]);
  });

  it("removes a fixed reminder that is at/after the new due date", () => {
    const fixedDateTime = new Date("2026-06-11T00:00:00.000Z"); // after newDueDateTime
    const actions = rescheduleOnDueDateChange(
      [{ id: "r-5", spec: { kind: "fixed", fixedDateTime }, hasFired: false }],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([{ action: "remove", id: "r-5", reason: "at-or-after-due-date" }]);
  });

  it("removes a fixed reminder that is already in the past relative to now", () => {
    const fixedDateTime = new Date("2026-05-01T00:00:00.000Z"); // before `now`
    const actions = rescheduleOnDueDateChange(
      [{ id: "r-6", spec: { kind: "fixed", fixedDateTime }, hasFired: false }],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([{ action: "remove", id: "r-6", reason: "already-in-past" }]);
  });

  it("processes multiple reminders independently in one call", () => {
    const actions = rescheduleOnDueDateChange(
      [
        {
          id: "r-7",
          spec: { kind: "relative", offsetValue: 1, offsetUnit: "days" },
          hasFired: false,
        },
        { id: "r-8", spec: { kind: "fixed", fixedDateTime: new Date("2026-05-01T00:00:00.000Z") }, hasFired: false },
      ],
      newDueDateTime,
      now,
    );
    expect(actions).toEqual([
      { action: "keep", id: "r-7", newFireAt: new Date("2026-06-09T12:00:00.000Z") },
      { action: "remove", id: "r-8", reason: "already-in-past" },
    ]);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/reminder-scheduling.test.ts
```

Expected: FAIL — `rescheduleOnDueDateChange is not a function` (the 5 earlier tests still pass, only the new `describe` block fails).

- [ ] **Step 7: Implement `rescheduleOnDueDateChange`**

Append to `src/domain/reminder-scheduling.ts`:

```ts
export interface ReschedulableReminder {
  id: string;
  spec: ReminderSpec;
  /** Already-fired reminders are historical and left untouched by an edit. */
  hasFired: boolean;
}

export type RescheduleAction =
  | { action: "keep"; id: string; newFireAt: Date }
  | {
      action: "remove";
      id: string;
      reason: "fire-time-in-past" | "at-or-after-due-date" | "already-in-past";
    }
  | { action: "unchanged"; id: string };

/**
 * Applies 03-business-rules.md §7's due-date-edit reschedule rule to every
 * still-pending reminder attached to a task. Pure — the caller (repository
 * layer, Phase 4) is responsible for actually cancelling/rescheduling the
 * underlying OS notifications and updating/deleting reminder rows based on
 * each returned action.
 */
export function rescheduleOnDueDateChange(
  reminders: ReschedulableReminder[],
  newDueDateTime: Date,
  now: Date,
): RescheduleAction[] {
  return reminders.map((reminder): RescheduleAction => {
    if (reminder.hasFired) {
      return { action: "unchanged", id: reminder.id };
    }

    if (reminder.spec.kind === "relative") {
      const newFireAt = computeFireAt(reminder.spec, newDueDateTime);
      if (newFireAt.getTime() <= now.getTime()) {
        return { action: "remove", id: reminder.id, reason: "fire-time-in-past" };
      }
      return { action: "keep", id: reminder.id, newFireAt };
    }

    // Fixed reminder: absolute, doesn't move with the due date, but is
    // validated against it.
    const { fixedDateTime } = reminder.spec;
    if (fixedDateTime.getTime() <= now.getTime()) {
      return { action: "remove", id: reminder.id, reason: "already-in-past" };
    }
    if (fixedDateTime.getTime() >= newDueDateTime.getTime()) {
      return { action: "remove", id: reminder.id, reason: "at-or-after-due-date" };
    }
    return { action: "keep", id: reminder.id, newFireAt: fixedDateTime };
  });
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/reminder-scheduling.test.ts
```

Expected: 12 tests passed (5 from Step 4 + 7 from this step).

- [ ] **Step 9: Run the full test suite**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/domain/reminder-scheduling.ts src/domain/__tests__/reminder-scheduling.test.ts
git commit -m "feat: add reminder-scheduling math and reschedule rules (TDD)"
```

---

### Task 8: `semester-lifecycle.ts`

**Files:**
- Create: `src/domain/semester-lifecycle.ts`
- Test: `src/domain/__tests__/semester-lifecycle.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces: `planSemesterCreation(existingSemesters: SemesterForLifecycle[]): CreateSemesterPlan` and `isSemesterReadOnly(status: "active" | "closed"): boolean`, consumed starting Phase 2 (semester create/close screens) and Phase 3+ (every screen that must disable create/edit/delete affordances under a closed semester).

- [ ] **Step 1: Write the failing tests**

Create `src/domain/__tests__/semester-lifecycle.test.ts`:

```ts
import { planSemesterCreation, isSemesterReadOnly } from "@/domain/semester-lifecycle";

describe("planSemesterCreation", () => {
  it("returns an empty close list when there is no existing active semester", () => {
    const plan = planSemesterCreation([{ id: "s-1", status: "closed" }]);
    expect(plan.semesterIdsToClose).toEqual([]);
  });

  it("returns an empty close list when there are no existing semesters at all", () => {
    expect(planSemesterCreation([]).semesterIdsToClose).toEqual([]);
  });

  it("returns the currently active semester's id so it gets auto-closed (03-business-rules.md §10)", () => {
    const plan = planSemesterCreation([
      { id: "s-1", status: "closed" },
      { id: "s-2", status: "active" },
    ]);
    expect(plan.semesterIdsToClose).toEqual(["s-2"]);
  });

  it("returns every active semester id if more than one is somehow active (defensive)", () => {
    const plan = planSemesterCreation([
      { id: "s-1", status: "active" },
      { id: "s-2", status: "active" },
    ]);
    expect(plan.semesterIdsToClose).toEqual(["s-1", "s-2"]);
  });
});

describe("isSemesterReadOnly", () => {
  it("returns true for a closed semester", () => {
    expect(isSemesterReadOnly("closed")).toBe(true);
  });

  it("returns false for an active semester", () => {
    expect(isSemesterReadOnly("active")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/semester-lifecycle.test.ts
```

Expected: FAIL — `Cannot find module '@/domain/semester-lifecycle'`.

- [ ] **Step 3: Implement `semester-lifecycle.ts`**

Create `src/domain/semester-lifecycle.ts`:

```ts
export interface SemesterForLifecycle {
  id: string;
  status: "active" | "closed";
}

export interface CreateSemesterPlan {
  /**
   * Ids of currently-active semesters the repository layer must close
   * (status = "closed", closedAt = now) as part of the same write that
   * activates the new semester — creating a new semester auto-closes the
   * previous one (03-business-rules.md §10), never requiring the user to
   * close it manually first.
   */
  semesterIdsToClose: string[];
}

export function planSemesterCreation(
  existingSemesters: SemesterForLifecycle[],
): CreateSemesterPlan {
  return {
    semesterIdsToClose: existingSemesters
      .filter((semester) => semester.status === "active")
      .map((semester) => semester.id),
  };
}

/**
 * A closed semester and everything under it (subjects, tasks, subtasks,
 * reminders, attachments) is read-only: no create/edit/delete anywhere in
 * its tree (03-business-rules.md §11). This is the single place that string
 * comparison lives, so no call site hardcodes `=== "closed"` directly.
 */
export function isSemesterReadOnly(status: "active" | "closed"): boolean {
  return status === "closed";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/semester-lifecycle.test.ts
```

Expected: 6 tests passed.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/domain/semester-lifecycle.ts src/domain/__tests__/semester-lifecycle.test.ts
git commit -m "feat: add semester-lifecycle rules (TDD)"
```

---

### Task 9: `subject-deletion.ts`

**Files:**
- Create: `src/domain/subject-deletion.ts`
- Test: `src/domain/__tests__/subject-deletion.test.ts`

**Interfaces:**
- Consumes: `TaskStatus` type from `src/domain/task-status.ts` (Task 5).
- Produces: `checkSubjectDeletion(tasks: { id: string; status: TaskStatus }[]): SubjectDeletionCheck`, consumed starting Phase 2 (subject deletion UI must call this before allowing/blocking the delete action, and display `blockingTaskCount` in its confirmation/error message).

- [ ] **Step 1: Write the failing tests**

Create `src/domain/__tests__/subject-deletion.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/subject-deletion.test.ts
```

Expected: FAIL — `Cannot find module '@/domain/subject-deletion'`.

- [ ] **Step 3: Implement `subject-deletion.ts`**

Create `src/domain/subject-deletion.ts`:

```ts
import type { TaskStatus } from "./task-status";

export interface SubjectDeletionCheck {
  allowed: boolean;
  /** Count of Pendiente/En progreso tasks blocking the deletion. */
  blockingTaskCount: number;
  /**
   * Only present when allowed = true: the task ids to cascade-delete along
   * with the subject (their subtasks/reminders/attachments cascade too, at
   * the repository layer). Absent (not an empty array) when allowed =
   * false, since nothing should be deleted in that case.
   */
  cascadeDeleteTaskIds?: string[];
}

/**
 * A subject may be deleted only if it has zero Pendiente/En progreso tasks
 * (03-business-rules.md §12). Completed and Vencida tasks never block —
 * if a subject has only those (or none), deletion is allowed and its
 * tasks cascade-delete with it. Closed-semester blocking (rule §11) is a
 * separate check the repository layer applies before ever calling this
 * function — this function only encodes the task-status-based rule.
 */
export function checkSubjectDeletion(
  tasks: { id: string; status: TaskStatus }[],
): SubjectDeletionCheck {
  const blockingTasks = tasks.filter(
    (task) => task.status === "Pendiente" || task.status === "En progreso",
  );

  if (blockingTasks.length > 0) {
    return { allowed: false, blockingTaskCount: blockingTasks.length };
  }

  return {
    allowed: true,
    blockingTaskCount: 0,
    cascadeDeleteTaskIds: tasks.map((task) => task.id),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/subject-deletion.test.ts
```

Expected: 6 tests passed.

- [ ] **Step 5: Run the full test suite one final time for the whole phase**

```bash
npm test
npx tsc --noEmit
npm run lint
npx prettier --check .
```

Expected: all exit 0. `npm test` should now show 8 suites (Phase 0's alias smoke test + Task 4's migration integration test + 6 domain test files from Tasks 5-9), all passing.

- [ ] **Step 6: Commit**

```bash
git add src/domain/subject-deletion.ts src/domain/__tests__/subject-deletion.test.ts
git commit -m "feat: add subject-deletion blocking rule (TDD)"
```

---

## Phase 1 — Definition of Done

All nine tasks above complete, in order, means:

- All 7 entities exist as Drizzle tables in `src/db/schema/`, matching `docs/06-data-model.md` field-for-field (Task 1-4).
- `src/db/client.ts` exports a fully schema-aware `db` instance (Task 4).
- `npx drizzle-kit generate` has produced a real migration, and a Node-side integration test (`better-sqlite3`, no Expo/RN runtime) proves it applies cleanly to a fresh SQLite database and creates every table, with foreign keys enforced (Task 4).
- Every rule in `03-business-rules.md` §1-§4, §7, §10, §12 has a corresponding pure function in `src/domain`, each written test-first per Strict TDD, with all branches and boundary conditions covered (Tasks 5-9).
- `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npx prettier --check .` all exit 0 against the final tree — run this full combined check at the end of the phase, not just each task's own new checks (a lesson from Phase 0's final review: per-task checks alone missed a cross-task issue that only a phase-level re-run caught).

This unblocks Phase 2 (Semester + Subject CRUD, including the first-run bootstrap flow and the on-device migration bundling carried over from this phase's deferred scope — see `docs/11-roadmap.md` Phase 2's "Carried over" note), which will be written as its own separate implementation plan once Phase 1 is executed and reviewed.
