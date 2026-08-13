# Phase 3: Task + Subtask CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Core task management — create/edit/delete tasks with subtasks, derived status/progress everywhere, quick-complete, and closed-semester read-only enforcement extended to Task/Subtask.

**Architecture:** Two new repository files (`src/db/repositories/task.ts`, `subtask.ts`) on top of Phase 1's already-tested pure domain functions (`task-status.ts`, `task-progress.ts`, `task-completion.ts`) and Phase 1's already-migrated `tasks`/`subtasks` tables — no new domain logic or migration needed this phase. Four new screens (`app/tarea/nueva.tsx`, `app/tarea/[id]/index.tsx`, `app/tarea/[id]/editar.tsx`, plus replacing the `app/(tabs)/tareas/index.tsx` placeholder) follow the exact patterns Phase 2 established: `useLiveQuery(db.select()...)` directly in components (Rule 1), a shared React Hook Form + Zod form component reused by Nueva/Editar, `SafeAreaView` + an in-screen back button on every pushed screen, and `Alert.alert` error handling that special-cases `SemesterReadOnlyError`.

**Tech Stack:** React Hook Form + Zod (already installed, Phase 2), `@react-native-community/datetimepicker` (new this phase — native module, installed via `npx expo install` and requires an on-device rebuild), Drizzle ORM over `expo-sqlite`, `better-sqlite3` for repository tests.

## Global Constraints

- **Domain purity is untouched**: `src/domain/*.ts` files from Phase 1 (`task-status.ts`, `task-progress.ts`, `task-completion.ts`, `semester-lifecycle.ts`, `subject-deletion.ts`) are consumed, never modified, by this phase — every rule this phase needs is already implemented and unit-tested there.
- **Rule 1 (`docs/07-architecture.md`)**: every screen that displays domain data reads it via `useLiveQuery(db.select()...)` directly in the component. No domain data is ever copied into a Zustand store, component state cache, or module-level variable. The Subject picker inside the task form is fetched this way in the *screen* (Nueva/Editar Tarea) and passed down to the shared `TaskForm` component as a plain prop — `TaskForm` itself never queries the DB.
- **Rule 2**: no Zustand store is introduced in this phase.
- **Closed-semester read-only cascade (`03-business-rules.md` §11)** extends to Task and Subtask this phase: create/edit/delete/complete on a Task, and add/edit/toggle/reorder/remove on a Subtask, must all be blocked at the repository layer (throwing `SemesterReadOnlyError`, reused from `@/db/repositories/subject` — do not define a second error class for the same condition) whenever the task's subject belongs to a closed semester.
- **Task/Subject assignment is always within the active semester**: the Subject picker in both Nueva and Editar Tarea only ever lists the currently active semester's subjects (same `useLiveQuery` + filter pattern the Materias tab already uses). A task can therefore never be created or reassigned into a closed semester's subject — there is no separate "is the *target* subject's semester open" check needed beyond that filtering, since a closed semester's subjects are never offered as options.
- **No reminders or attachments in this phase**: `src/db/schema/reminder.ts` and `attachment.ts` exist (Phase 1) but neither table is touched by any code in this phase. The roadmap explicitly defers the Reminder picker, default-reminder-on-create behavior, and attachment flow to Phase 4/5 (`03-business-rules.md` §7, §9). Do not add a reminders or attachments section to any screen in this phase.
- **Un-completing a task is out of scope** (`03-business-rules.md` §5): the list's quick-complete checkbox and the detail screen's "Marcar como completada" button are one-directional — tapping an already-completed task's checkbox/button is a no-op (disabled), never toggles it back to incomplete.
- **Priority is always shown with both a color and a text label**, never color alone (`03-business-rules.md` §18) — every priority indicator in this phase (list row, detail screen, form picker) pairs the color swatch/stripe with the literal "Alta"/"Media"/"Baja" text, satisfying this accessibility rule from the start rather than deferring it to Phase 10.
- Use `npx`/`npm` for all CLI tool invocations; do not install any CLI tool globally.
- Every task ends with `npx tsc --noEmit` and `npm run lint` passing, and — for any task that changes on-device-visible behavior — real on-device verification via `npx expo run:android` (this session has repeatedly found critical bugs, e.g. `useLiveQuery` races, that only surface on-device, never in static checks).
- **Testing approach for screens**: `docs/11-roadmap.md`'s Phase 3 entry mentions "component tests for the filter chips against fixture tasks in each status." Phases 1 and 2 of this exact project consistently substituted real on-device manual verification for screen/component-level Jest tests instead (no `@testing-library/react-native` test file exists anywhere in this codebase despite the library being installed since Phase 0), and both phases' final whole-branch reviews accepted this without flagging it as a gap. This plan continues that established, already-reviewed precedent: `src/domain` and `src/db/repositories` get real Jest tests (unit + in-memory-SQLite integration), screens get on-device verification only. Do not introduce the first component test in this phase without discussing the inconsistency with the human first.

---

### Task 1: Task repository (TDD)

**Files:**
- Create: `src/db/repositories/task.ts`, `src/db/repositories/__tests__/task.test.ts`

**Interfaces:**
- Consumes: `tasks`/`Task`/`NewTask` from `src/db/schema/task.ts` (Phase 1); `subtasks` from `src/db/schema/subtask.ts` (Phase 1); `subjects` from `src/db/schema/subject.ts`, `semesters` from `src/db/schema/semester.ts` (Phase 2); `isSemesterReadOnly` from `src/domain/semester-lifecycle.ts` (Phase 1); `completeTask` from `src/domain/task-completion.ts` (Phase 1); `SemesterReadOnlyError` from `src/db/repositories/subject.ts` (Phase 2 — reused, not redefined); `Database` type from `src/db/repositories/semester.ts` (Phase 2).
- Produces: `createTask`, `updateTask`, `deleteTask`, `completeTaskAction`, `getTask` (test/future-use only, same convention as `getSubject` — do not consume from a screen), and **`assertTaskEditable`** (exported specifically for Task 2's `subtask.ts` to reuse — it is the single place the "is this task's subject/semester open" check lives, so Task 2 never re-implements the closed-semester join).

> **Lessons carried over from Phase 2** (read the referenced files for full detail before starting):
> 1. `.transaction()` callbacks passed to this project's `Database` type **must be synchronous** (not `async`), using `.run()` instead of `await` inside — both `better-sqlite3` and `drizzle-orm/expo-sqlite` reject/mishandle a Promise-returning transaction callback. See `src/db/repositories/semester.ts`'s `createSemester` for the exact working pattern; `createTask` below follows it.
> 2. `__mocks__/expo-sqlite.ts` and `__mocks__/expo-crypto.ts` already exist at the project root (Jest manual mocks, auto-loaded) — do not recreate them.
> 3. SQLite's `mode: "timestamp"` columns only have whole-second precision — irrelevant to this task's code (nothing here orders by a timestamp column), but don't copy a `createdAt`-based `.orderBy()` elsewhere without a tiebreaker if a future task needs one.

- [ ] **Step 1: Write the failing tests**

Create `src/db/repositories/__tests__/task.test.ts`:

```ts
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks } from "@/db/schema/task";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import {
  completeTaskAction,
  createTask,
  deleteTask,
  getTask,
  updateTask,
} from "@/db/repositories/task";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

async function seedActiveSemesterWithSubject(db: ReturnType<typeof freshTestDb>) {
  const semesterId = "sem-active";
  await db
    .insert(semesters)
    .values({ id: semesterId, label: "2026-1", status: "active", createdAt: new Date() });
  const subjectId = "subj-1";
  await db.insert(subjects).values({
    id: subjectId,
    name: "Cálculo II",
    color: "indigo",
    semesterId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { semesterId, subjectId };
}

async function seedClosedSemesterWithSubject(db: ReturnType<typeof freshTestDb>) {
  const semesterId = "sem-closed";
  await db.insert(semesters).values({
    id: semesterId,
    label: "2025-2",
    status: "closed",
    createdAt: new Date(),
    closedAt: new Date(),
  });
  const subjectId = "subj-closed";
  await db.insert(subjects).values({
    id: subjectId,
    name: "Historia",
    color: "rose",
    semesterId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { semesterId, subjectId };
}

const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 1 week from now

describe("task repository", () => {
  it("creates a task with initial subtasks", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);

    const task = await createTask(
      {
        title: "Ensayo final",
        description: "Sobre la Revolución Industrial",
        subjectId,
        dueDateTime: future,
        priority: "Alta",
        subtaskTexts: ["Investigar fuentes", "Escribir borrador"],
      },
      db,
    );

    expect(task.title).toBe("Ensayo final");
    expect(task.completed).toBe(false);
    expect(task.completedLate).toBe(false);

    const fetched = await getTask(task.id, db);
    expect(fetched?.title).toBe("Ensayo final");

    const createdSubtasks = await db
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, task.id));
    expect(createdSubtasks.map((s) => s.text).sort()).toEqual(
      ["Escribir borrador", "Investigar fuentes"].sort(),
    );
    expect(createdSubtasks.map((s) => s.order).sort()).toEqual([0, 1]);
  });

  it("creates a task with zero subtasks when none are given", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);

    const task = await createTask(
      { title: "Leer capítulo 3", subjectId, dueDateTime: future, priority: "Media" },
      db,
    );

    const createdSubtasks = await db
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, task.id));
    expect(createdSubtasks).toHaveLength(0);
  });

  it("blocks creating a task under a closed semester (03-business-rules.md §11)", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedClosedSemesterWithSubject(db);

    await expect(
      createTask({ title: "Tarea", subjectId, dueDateTime: future, priority: "Baja" }, db),
    ).rejects.toThrow(SemesterReadOnlyError);
  });

  it("updates a task's fields, including reassigning its subject", async () => {
    const db = freshTestDb();
    const { subjectId, semesterId } = await seedActiveSemesterWithSubject(db);
    const otherSubjectId = "subj-2";
    await db.insert(subjects).values({
      id: otherSubjectId,
      name: "Física",
      color: "sky",
      semesterId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const task = await createTask(
      { title: "Original", subjectId, dueDateTime: future, priority: "Baja" },
      db,
    );

    await updateTask(
      task.id,
      { title: "Actualizada", subjectId: otherSubjectId, priority: "Alta" },
      db,
    );

    const fetched = await getTask(task.id, db);
    expect(fetched?.title).toBe("Actualizada");
    expect(fetched?.subjectId).toBe(otherSubjectId);
    expect(fetched?.priority).toBe("Alta");
  });

  it("blocks updating a task under a closed semester", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      { title: "Tarea", subjectId, dueDateTime: future, priority: "Media" },
      db,
    );

    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(updateTask(task.id, { title: "Editada" }, db)).rejects.toThrow(
      SemesterReadOnlyError,
    );
  });

  it("blocks reassigning a task into a subject that belongs to a closed semester", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const { subjectId: closedSubjectId } = await seedClosedSemesterWithSubject(db);
    const task = await createTask(
      { title: "Tarea", subjectId, dueDateTime: future, priority: "Media" },
      db,
    );

    // The Subject picker in the real UI never offers a closed semester's
    // subjects as an option (Global Constraints), but the repository layer
    // must not rely on that alone (03-business-rules.md §11: enforced at
    // the business-logic layer, not just hidden in the UI) — a caller that
    // somehow passes a closed-semester subjectId directly must still be
    // rejected.
    await expect(
      updateTask(task.id, { subjectId: closedSubjectId }, db),
    ).rejects.toThrow(SemesterReadOnlyError);
  });

  it("deletes a task and cascades its subtasks", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      {
        title: "Con subtareas",
        subjectId,
        dueDateTime: future,
        priority: "Media",
        subtaskTexts: ["Paso 1"],
      },
      db,
    );

    await deleteTask(task.id, db);

    const fetchedTask = await getTask(task.id, db);
    expect(fetchedTask).toBeUndefined();
    const remainingSubtasks = await db
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, task.id));
    expect(remainingSubtasks).toHaveLength(0);
  });

  it("blocks deleting a task under a closed semester", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      { title: "Tarea", subjectId, dueDateTime: future, priority: "Baja" },
      db,
    );
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(deleteTask(task.id, db)).rejects.toThrow(SemesterReadOnlyError);
  });

  it("completing a task auto-checks all subtasks and stamps completedLate = false when on time", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      {
        title: "Tarea con subtareas",
        subjectId,
        dueDateTime: future,
        priority: "Media",
        subtaskTexts: ["A", "B"],
      },
      db,
    );

    await completeTaskAction(task.id, db);

    const fetched = await getTask(task.id, db);
    expect(fetched?.completed).toBe(true);
    expect(fetched?.completedLate).toBe(false);
    expect(fetched?.completedAt).not.toBeNull();

    const allSubtasks = await db.select().from(subtasks).where(eq(subtasks.taskId, task.id));
    expect(allSubtasks.every((s) => s.completed)).toBe(true);
  });

  it("completing an overdue task stamps completedLate = true", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24); // yesterday
    const task = await createTask(
      { title: "Vencida", subjectId, dueDateTime: past, priority: "Alta" },
      db,
    );

    await completeTaskAction(task.id, db);

    const fetched = await getTask(task.id, db);
    expect(fetched?.completedLate).toBe(true);
  });

  it("blocks completing a task under a closed semester", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      { title: "Tarea", subjectId, dueDateTime: future, priority: "Media" },
      db,
    );
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(completeTaskAction(task.id, db)).rejects.toThrow(SemesterReadOnlyError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/db/repositories/__tests__/task.test.ts
```

Expected: FAIL — `Cannot find module '@/db/repositories/task'` (the file doesn't exist yet).

- [ ] **Step 3: Implement the Task repository**

Create `src/db/repositories/task.ts`:

```ts
import { randomUUID } from "expo-crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks, type Task } from "@/db/schema/task";
import { completeTask } from "@/domain/task-completion";
import { isSemesterReadOnly } from "@/domain/semester-lifecycle";

async function assertSubjectEditable(subjectId: string, database: Database): Promise<void> {
  const rows = await database
    .select({ status: semesters.status })
    .from(subjects)
    .innerJoin(semesters, eq(subjects.semesterId, semesters.id))
    .where(eq(subjects.id, subjectId))
    .limit(1);
  const row = rows[0];
  if (!row || isSemesterReadOnly(row.status)) {
    throw new SemesterReadOnlyError();
  }
}

/**
 * The single place the "is this task's subject/semester open" check lives.
 * Exported so `subtask.ts` (Task 2 of this plan) reuses it instead of
 * re-implementing the same join — a subtask's edibility is always exactly
 * its parent task's editability.
 */
export async function assertTaskEditable(taskId: string, database: Database): Promise<Task> {
  const rows = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) throw new Error(`Task not found: ${taskId}`);
  await assertSubjectEditable(task.subjectId, database);
  return task;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  subjectId: string;
  dueDateTime: Date;
  priority: "Alta" | "Media" | "Baja";
  /** Initial subtasks, created in the same write as the task. Order is the array index. */
  subtaskTexts?: string[];
}

export async function createTask(
  input: CreateTaskInput,
  database: Database = defaultDb,
): Promise<Task> {
  await assertSubjectEditable(input.subjectId, database);

  const now = new Date();
  const newTask: typeof tasks.$inferInsert = {
    id: randomUUID(),
    title: input.title,
    description: input.description ?? null,
    subjectId: input.subjectId,
    dueDateTime: input.dueDateTime,
    priority: input.priority,
    completed: false,
    completedAt: null,
    completedLate: false,
    createdAt: now,
    updatedAt: now,
  };

  const newSubtasks: (typeof subtasks.$inferInsert)[] = (input.subtaskTexts ?? []).map(
    (text, index) => ({
      id: randomUUID(),
      taskId: newTask.id,
      text,
      completed: false,
      order: index,
    }),
  );

  // Synchronous transaction callback + `.run()` — see Task 1's brief note
  // (Phase 2's `createSemester` lesson): an async callback is rejected by
  // both drivers behind the `Database` type.
  await database.transaction((tx) => {
    tx.insert(tasks).values(newTask).run();
    for (const subtask of newSubtasks) {
      tx.insert(subtasks).values(subtask).run();
    }
  });

  return newTask as Task;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  subjectId?: string;
  dueDateTime?: Date;
  priority?: "Alta" | "Media" | "Baja";
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
  database: Database = defaultDb,
): Promise<void> {
  await assertTaskEditable(id, database);

  // If the task is being reassigned to a different subject, that subject's
  // own semester must also be open — the UI's Subject picker only ever
  // offers active-semester subjects (Global Constraints), but §11 requires
  // enforcement at this layer regardless of what any UI happens to show.
  if (input.subjectId !== undefined) {
    await assertSubjectEditable(input.subjectId, database);
  }

  await database
    .update(tasks)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function deleteTask(id: string, database: Database = defaultDb): Promise<void> {
  await assertTaskEditable(id, database);

  // Subtasks (and, from Phase 4/5 onward, reminders/attachments) cascade-
  // delete automatically via ON DELETE CASCADE (Phase 1 schema) now that
  // PRAGMA foreign_keys=ON is active on-device (Phase 2 Task 1) — no manual
  // cleanup needed here. No reminder/attachment records exist yet in this
  // phase (Global Constraints), so there is nothing to cancel/cleanup
  // beyond the cascade.
  await database.delete(tasks).where(eq(tasks.id, id));
}

export async function completeTaskAction(
  id: string,
  database: Database = defaultDb,
): Promise<void> {
  const task = await assertTaskEditable(id, database);

  const subtaskRows = await database
    .select({ id: subtasks.id, completed: subtasks.completed })
    .from(subtasks)
    .where(eq(subtasks.taskId, id));

  const result = completeTask({
    dueDateTime: task.dueDateTime,
    subtasks: subtaskRows,
    current: task.completed
      ? {
          completed: task.completed,
          completedAt: task.completedAt as Date,
          completedLate: task.completedLate,
        }
      : undefined,
  });

  await database.transaction((tx) => {
    tx.update(tasks)
      .set({
        completed: true,
        completedAt: result.completedAt,
        completedLate: result.completedLate,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .run();

    for (const subtaskId of result.subtaskIdsToCheck) {
      tx.update(subtasks).set({ completed: true }).where(eq(subtasks.id, subtaskId)).run();
    }
  });
}

// Referenced only by tests and potential future CLI/tooling use — no screen
// consumes this. Screens read tasks reactively via `useLiveQuery(db.select()...)`
// directly in the component (Rule 1, docs/07-architecture.md). Do not "fix"
// a screen to route through this instead.
export async function getTask(
  id: string,
  database: Database = defaultDb,
): Promise<Task | undefined> {
  const rows = await database.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return rows[0];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/db/repositories/__tests__/task.test.ts
```

Expected: 11 tests passed.

- [ ] **Step 5: Run tsc and lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/task.ts src/db/repositories/__tests__/task.test.ts
git commit -m "feat: add Task repository with closed-semester enforcement (TDD)"
```

---

### Task 2: Subtask repository (TDD)

**Files:**
- Create: `src/db/repositories/subtask.ts`, `src/db/repositories/__tests__/subtask.test.ts`

**Interfaces:**
- Consumes: `assertTaskEditable` from `src/db/repositories/task.ts` (Task 1 of this plan — the closed-semester check); `subtasks`/`Subtask` from `src/db/schema/subtask.ts` (Phase 1); `SemesterReadOnlyError` from `src/db/repositories/subject.ts`; `Database` type from `src/db/repositories/semester.ts`.
- Produces: `addSubtask`, `updateSubtaskText`, `toggleSubtaskCompleted`, `deleteSubtask`, `moveSubtask` — consumed by Task 6's Task Detail screen (the only screen that manages subtasks post-creation; Nueva Tarea creates initial subtasks directly through `createTask`'s `subtaskTexts`, per Task 1).

- [ ] **Step 1: Write the failing tests**

Create `src/db/repositories/__tests__/subtask.test.ts`:

```ts
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { createTask } from "@/db/repositories/task";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import {
  addSubtask,
  deleteSubtask,
  moveSubtask,
  toggleSubtaskCompleted,
  updateSubtaskText,
} from "@/db/repositories/subtask";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

async function seedTaskInActiveSemester(db: ReturnType<typeof freshTestDb>) {
  const semesterId = "sem-active";
  await db
    .insert(semesters)
    .values({ id: semesterId, label: "2026-1", status: "active", createdAt: new Date() });
  const subjectId = "subj-1";
  await db.insert(subjects).values({
    id: subjectId,
    name: "Cálculo II",
    color: "indigo",
    semesterId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const task = await createTask(
    {
      title: "Tarea",
      subjectId,
      dueDateTime: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      priority: "Media",
    },
    db,
  );
  return { semesterId, task };
}

describe("subtask repository", () => {
  it("adds a subtask with the next order value", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);

    const first = await addSubtask(task.id, "Primer paso", db);
    const second = await addSubtask(task.id, "Segundo paso", db);

    expect(first.order).toBe(0);
    expect(second.order).toBe(1);
  });

  it("blocks adding a subtask under a closed semester", async () => {
    const db = freshTestDb();
    const { task, semesterId } = await seedTaskInActiveSemester(db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(addSubtask(task.id, "Paso", db)).rejects.toThrow(SemesterReadOnlyError);
    void semesterId;
  });

  it("updates a subtask's text", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Original", db);

    await updateSubtaskText(subtask.id, "Corregido", db);

    const [fetched] = await db.select().from(subtasks).where(eq(subtasks.id, subtask.id));
    expect(fetched.text).toBe("Corregido");
  });

  it("toggles a subtask's completed flag", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Paso", db);

    await toggleSubtaskCompleted(subtask.id, true, db);
    let [fetched] = await db.select().from(subtasks).where(eq(subtasks.id, subtask.id));
    expect(fetched.completed).toBe(true);

    await toggleSubtaskCompleted(subtask.id, false, db);
    [fetched] = await db.select().from(subtasks).where(eq(subtasks.id, subtask.id));
    expect(fetched.completed).toBe(false);
  });

  it("blocks toggling a subtask under a closed semester", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Paso", db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(toggleSubtaskCompleted(subtask.id, true, db)).rejects.toThrow(
      SemesterReadOnlyError,
    );
  });

  it("deletes a subtask", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Paso", db);

    await deleteSubtask(subtask.id, db);

    const remaining = await db.select().from(subtasks).where(eq(subtasks.id, subtask.id));
    expect(remaining).toHaveLength(0);
  });

  it("blocks deleting a subtask under a closed semester", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const subtask = await addSubtask(task.id, "Paso", db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(deleteSubtask(subtask.id, db)).rejects.toThrow(SemesterReadOnlyError);
  });

  it("moves a subtask up, swapping order with its predecessor", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const first = await addSubtask(task.id, "Uno", db);
    const second = await addSubtask(task.id, "Dos", db);

    await moveSubtask(second.id, "up", db);

    const rows = await db
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, task.id));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.order]));
    expect(byId[second.id]).toBe(0);
    expect(byId[first.id]).toBe(1);
  });

  it("moving the first subtask up is a no-op", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const first = await addSubtask(task.id, "Uno", db);
    const second = await addSubtask(task.id, "Dos", db);

    await moveSubtask(first.id, "up", db);

    const rows = await db
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, task.id));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.order]));
    expect(byId[first.id]).toBe(0);
    expect(byId[second.id]).toBe(1);
  });

  it("moves a subtask down, swapping order with its successor", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const first = await addSubtask(task.id, "Uno", db);
    const second = await addSubtask(task.id, "Dos", db);

    await moveSubtask(first.id, "down", db);

    const rows = await db
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, task.id));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.order]));
    expect(byId[first.id]).toBe(1);
    expect(byId[second.id]).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/db/repositories/__tests__/subtask.test.ts
```

Expected: FAIL — `Cannot find module '@/db/repositories/subtask'`.

- [ ] **Step 3: Implement the Subtask repository**

Create `src/db/repositories/subtask.ts`:

```ts
import { randomUUID } from "expo-crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import { assertTaskEditable } from "@/db/repositories/task";
import type { Database } from "@/db/repositories/semester";
import { subtasks, type Subtask } from "@/db/schema/subtask";

async function getSubtaskOrThrow(id: string, database: Database) {
  const rows = await database.select().from(subtasks).where(eq(subtasks.id, id)).limit(1);
  const subtask = rows[0];
  if (!subtask) throw new Error(`Subtask not found: ${id}`);
  return subtask;
}

export async function addSubtask(
  taskId: string,
  text: string,
  database: Database = defaultDb,
): Promise<Subtask> {
  await assertTaskEditable(taskId, database);

  const existing = await database
    .select({ order: subtasks.order })
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId));
  const nextOrder = existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.order)) + 1;

  const newSubtask: typeof subtasks.$inferInsert = {
    id: randomUUID(),
    taskId,
    text,
    completed: false,
    order: nextOrder,
  };
  await database.insert(subtasks).values(newSubtask);
  return newSubtask as Subtask;
}

export async function updateSubtaskText(
  id: string,
  text: string,
  database: Database = defaultDb,
): Promise<void> {
  const subtask = await getSubtaskOrThrow(id, database);
  await assertTaskEditable(subtask.taskId, database);
  await database.update(subtasks).set({ text }).where(eq(subtasks.id, id));
}

export async function toggleSubtaskCompleted(
  id: string,
  completed: boolean,
  database: Database = defaultDb,
): Promise<void> {
  const subtask = await getSubtaskOrThrow(id, database);
  await assertTaskEditable(subtask.taskId, database);
  await database.update(subtasks).set({ completed }).where(eq(subtasks.id, id));
}

export async function deleteSubtask(id: string, database: Database = defaultDb): Promise<void> {
  const subtask = await getSubtaskOrThrow(id, database);
  await assertTaskEditable(subtask.taskId, database);
  await database.delete(subtasks).where(eq(subtasks.id, id));
}

/**
 * Simple adjacent-swap reordering (no drag-and-drop library in this
 * project) — moves the given subtask up or down by one position within
 * its parent task's list by swapping `order` with its neighbor. A no-op
 * if already at that end of the list.
 */
export async function moveSubtask(
  id: string,
  direction: "up" | "down",
  database: Database = defaultDb,
): Promise<void> {
  const subtask = await getSubtaskOrThrow(id, database);
  await assertTaskEditable(subtask.taskId, database);

  const siblings = (
    await database
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, subtask.taskId))
  ).sort((a, b) => a.order - b.order);

  const currentIndex = siblings.findIndex((s) => s.id === id);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) return;

  const current = siblings[currentIndex];
  const target = siblings[targetIndex];

  await database.transaction((tx) => {
    tx.update(subtasks).set({ order: target.order }).where(eq(subtasks.id, current.id)).run();
    tx.update(subtasks).set({ order: current.order }).where(eq(subtasks.id, target.id)).run();
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/db/repositories/__tests__/subtask.test.ts
```

Expected: 10 tests passed.

- [ ] **Step 5: Run the full test suite, tsc, and lint**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all exit 0. `npm test` should show 12 suites now (10 from Phase 0-2 plus this phase's `task.test.ts` and `subtask.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/subtask.ts src/db/repositories/__tests__/subtask.test.ts
git commit -m "feat: add Subtask repository with closed-semester enforcement (TDD)"
```

---

### Task 3: Date/time picker dependency, priority tokens, Task validation schema, and shared TaskForm component

**Files:**
- Modify: `src/theme/index.ts` (add `priorityColors`)
- Create: `src/validation/task.ts`, `src/components/TaskForm.tsx`

**Interfaces:**
- Consumes: `colors` from `src/theme/index.ts`; nothing from Tasks 1-2 (this task is UI-layer only, no repository calls — `TaskForm` is a pure presentation component, matching `SubjectForm.tsx`'s shape).
- Produces: `priorityColors` from `src/theme/index.ts`; `taskFormSchema`/`TaskFormValues` from `src/validation/task.ts`; the `TaskForm` component — reused identically by Task 4 (Nueva Tarea) and Task 7 (Editar Tarea).

- [ ] **Step 1: Install the date/time picker**

```bash
npx expo install @react-native-community/datetimepicker
```

Expected: `npx expo install` resolves and pins the exact version compatible with this project's Expo SDK 57 (do not hand-pick a version number — this project's `AGENTS.md` explicitly warns Expo has changed and to rely on the tool-resolved version, the same way `expo-asset`/`expo-crypto` were added in earlier phases).

This is a **native module** (unlike Phase 2's `react-hook-form`/`zod`/`@hookform/resolvers`, which were pure JS) — it will not take effect until a native rebuild. Step 7 below verifies this on-device; a plain `npx expo start` reload is not sufficient after this install.

- [ ] **Step 2: Add priority color tokens**

Modify `src/theme/index.ts` — add this export after `subjectPalette` (leave everything else in the file unchanged):

```ts
/**
 * Task priority stripe/dot colors (03-business-rules.md, 06-data-model.md):
 * High reuses `colors.danger` (the same red), Medium/Low are distinct from
 * every subject-palette hue so a student never confuses "this task's
 * priority" with "this subject's color" at a glance.
 */
export const priorityColors: Record<"Alta" | "Media" | "Baja", string> = {
  Alta: colors.danger,
  Media: "#F59E0B",
  Baja: "#10B981",
};
```

- [ ] **Step 3: Create the Task validation schema**

Create `src/validation/task.ts`:

```ts
import { z } from "zod";

export const TASK_PRIORITIES = ["Alta", "Media", "Baja"] as const;

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio"),
  description: z.string().trim().optional(),
  subjectId: z.string().min(1, "Debes elegir una materia"),
  dueDate: z.date(),
  dueTime: z.date(),
  priority: z.enum(TASK_PRIORITIES),
});

export type TaskFormValues = z.infer<typeof taskFormSchema>;

/**
 * Combines the form's separate date and time pickers into the single
 * `dueDateTime` instant every business rule operates on
 * (06-data-model.md's Task entity note). Takes the calendar date from
 * `date` and the hour/minute from `time`, zeroing seconds/ms.
 */
export function combineDateAndTime(date: Date, time: Date): Date {
  const combined = new Date(date);
  combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return combined;
}
```

- [ ] **Step 4: Create the shared Task form component**

Create `src/components/TaskForm.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Controller, useForm } from "react-hook-form";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, priorityColors, subjectPalette } from "@/theme";
import { TASK_PRIORITIES, taskFormSchema, type TaskFormValues } from "@/validation/task";
import type { SubjectColor } from "@/db/repositories/subject";

export interface TaskFormSubjectOption {
  id: string;
  name: string;
  color: SubjectColor;
}

interface TaskFormProps {
  subjects: TaskFormSubjectOption[];
  initialValues?: Partial<TaskFormValues>;
  submitLabel: string;
  onSubmit: (values: TaskFormValues) => Promise<void>;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("es", { year: "numeric", month: "long", day: "numeric" });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export function TaskForm({ subjects, initialValues, submitLabel, onSubmit }: TaskFormProps) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: initialValues?.title ?? "",
      description: initialValues?.description ?? "",
      subjectId: initialValues?.subjectId ?? "",
      dueDate: initialValues?.dueDate ?? new Date(),
      dueTime: initialValues?.dueTime ?? new Date(),
      priority: initialValues?.priority ?? "Media",
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Título</Text>
      <Controller
        control={control}
        name="title"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="Ej. Entregar ensayo final"
          />
        )}
      />
      {errors.title && <Text style={styles.error}>{errors.title.message}</Text>}

      <Text style={styles.label}>Descripción (opcional)</Text>
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <TextInput
            style={[styles.input, styles.multiline]}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="Detalles adicionales"
            multiline
          />
        )}
      />

      <Text style={styles.label}>Materia</Text>
      <Controller
        control={control}
        name="subjectId"
        render={({ field }) => (
          <View style={styles.subjectRow}>
            {subjects.map((subject) => (
              <TouchableOpacity
                key={subject.id}
                onPress={() => field.onChange(subject.id)}
                style={[
                  styles.subjectChip,
                  field.value === subject.id && styles.subjectChipSelected,
                ]}
              >
                <View
                  style={[styles.subjectDot, { backgroundColor: subjectPalette[subject.color] }]}
                />
                <Text style={styles.subjectChipText}>{subject.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      />
      {errors.subjectId && <Text style={styles.error}>{errors.subjectId.message}</Text>}

      <Text style={styles.label}>Fecha límite</Text>
      <Controller
        control={control}
        name="dueDate"
        render={({ field }) => (
          <>
            <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
              <Text>{formatDate(field.value)}</Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={field.value}
                mode="date"
                display="default"
                onChange={(_event, selectedDate) => {
                  setShowDatePicker(false);
                  if (selectedDate) field.onChange(selectedDate);
                }}
              />
            )}
          </>
        )}
      />

      <Text style={styles.label}>Hora límite</Text>
      <Controller
        control={control}
        name="dueTime"
        render={({ field }) => (
          <>
            <TouchableOpacity style={styles.input} onPress={() => setShowTimePicker(true)}>
              <Text>{formatTime(field.value)}</Text>
            </TouchableOpacity>
            {showTimePicker && (
              <DateTimePicker
                value={field.value}
                mode="time"
                display="default"
                onChange={(_event, selectedTime) => {
                  setShowTimePicker(false);
                  if (selectedTime) field.onChange(selectedTime);
                }}
              />
            )}
          </>
        )}
      />

      <Text style={styles.label}>Prioridad</Text>
      <Controller
        control={control}
        name="priority"
        render={({ field }) => (
          <View style={styles.priorityRow}>
            {TASK_PRIORITIES.map((priority) => (
              <TouchableOpacity
                key={priority}
                onPress={() => field.onChange(priority)}
                style={[
                  styles.priorityChip,
                  { borderColor: priorityColors[priority] },
                  field.value === priority && {
                    backgroundColor: priorityColors[priority],
                  },
                ]}
              >
                <Text
                  style={[
                    styles.priorityChipText,
                    field.value === priority
                      ? styles.priorityChipTextSelected
                      : { color: priorityColors[priority] },
                  ]}
                >
                  {priority}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      />

      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        onPress={handleSubmit(onSubmit)}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.submitButtonText}>{submitLabel}</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  subjectRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 8,
  },
  subjectChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  subjectChipSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  subjectDot: { width: 10, height: 10, borderRadius: 5 },
  subjectChipText: { fontSize: 14, color: colors.text },
  priorityRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 8,
  },
  priorityChip: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  priorityChipText: { fontSize: 14, fontWeight: "600" },
  priorityChipTextSelected: { color: "#FFFFFF" },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
```

- [ ] **Step 5: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0.

If `tsc` complains about `DateTimePicker`'s `onChange` event parameter type, check the installed package's actual type exports (`node_modules/@react-native-community/datetimepicker/lib/typescript/*.d.ts`) rather than guessing — this project's `AGENTS.md` warns Expo's ecosystem has changed, so verify against the installed version rather than assuming an older API shape. The `_event` parameter above is deliberately left loosely/implicitly typed (unused, prefixed `_`) specifically to avoid depending on an exact event-type name that may differ by version.

- [ ] **Step 6: Verify TaskForm renders on a real Android emulator/device**

This component isn't mounted by any route yet (Task 4 does that), so verification here is limited to confirming the native module linked correctly:

```bash
npx expo run:android
```

Expected: `BUILD SUCCESSFUL` — confirms `@react-native-community/datetimepicker`'s native code compiled into the Android build. Full interactive verification of `TaskForm` (tapping date/time pickers, selecting a subject, etc.) happens in Task 4 once a real screen mounts it.

- [ ] **Step 7: Commit**

```bash
git add src/theme/index.ts src/validation/task.ts src/components/TaskForm.tsx package.json package-lock.json
git commit -m "feat: add date/time picker, priority tokens, and shared TaskForm"
```

---

### Task 4: Nueva Tarea screen

**Files:**
- Create: `app/tarea/nueva.tsx`

**Interfaces:**
- Consumes: `TaskForm`/`TaskFormSubjectOption` from `src/components/TaskForm.tsx` (Task 3); `combineDateAndTime` from `src/validation/task.ts` (Task 3); `createTask` from `src/db/repositories/task.ts` (Task 1); `getActiveSemester` from `src/db/repositories/semester.ts` (Phase 2); `SemesterReadOnlyError` from `src/db/repositories/subject.ts`.
- Produces: the `/tarea/nueva` route — the FAB target Task 5's Tareas tab list screen links to.

- [ ] **Step 1: Create the Nueva Tarea screen**

Create `app/tarea/nueva.tsx`:

```tsx
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TaskForm, type TaskFormSubjectOption } from "@/components/TaskForm";
import { db } from "@/db/client";
import { getActiveSemester } from "@/db/repositories/semester";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import { createTask } from "@/db/repositories/task";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { colors } from "@/theme";
import { combineDateAndTime, type TaskFormValues } from "@/validation/task";

export default function NuevaTareaScreen() {
  const { data: activeSemesterRows } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;

  const { data: subjectRows } = useLiveQuery(db.select().from(subjects));
  const activeSubjects = (subjectRows ?? [])
    .filter((subject) => subject.semesterId === activeSemesterId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  const [subtaskTexts, setSubtaskTexts] = useState<string[]>([]);
  const [newSubtaskText, setNewSubtaskText] = useState("");

  function handleAddSubtaskDraft() {
    const trimmed = newSubtaskText.trim();
    if (!trimmed) return;
    setSubtaskTexts((current) => [...current, trimmed]);
    setNewSubtaskText("");
  }

  function handleRemoveSubtaskDraft(index: number) {
    setSubtaskTexts((current) => current.filter((_, i) => i !== index));
  }

  async function handleSubmit(values: TaskFormValues) {
    try {
      const activeSemester = await getActiveSemester();
      if (!activeSemester) {
        // Should be unreachable: the app never lets the user reach this
        // screen without an active semester (root layout redirect, Phase 2 Task 3).
        throw new Error("No hay un semestre activo");
      }
      await createTask({
        title: values.title,
        description: values.description || undefined,
        subjectId: values.subjectId,
        dueDateTime: combineDateAndTime(values.dueDate, values.dueTime),
        priority: values.priority,
        subtaskTexts,
      });
      router.back();
    } catch (error) {
      if (error instanceof SemesterReadOnlyError) {
        Alert.alert("Semestre cerrado", "Este semestre está cerrado y no admite nuevas tareas.");
      } else {
        Alert.alert("Error", "No se pudo crear la tarea.");
      }
    }
  }

  if (activeSubjects.length === 0) {
    // Mirrors 04-user-flows.md flow 2's "If the subject picker is empty,
    // the user is redirected to create a subject first" — there is no
    // subject to assign the task to, so send them to create one instead
    // of rendering a form with an empty, unusable subject picker.
    return (
      <SafeAreaView style={styles.center} edges={["top"]}>
        <Text style={styles.emptyText}>
          Necesitas al menos una materia antes de crear una tarea.
        </Text>
        <TouchableOpacity style={styles.emptyButton} onPress={() => router.replace("/materia/nueva")}>
          <Text style={styles.emptyButtonText}>Crear materia</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>← Volver</Text>
      </TouchableOpacity>
      <TaskForm subjects={activeSubjects as TaskFormSubjectOption[]} submitLabel="Crear tarea" onSubmit={handleSubmit} />

      <View style={styles.subtasksSection}>
        <Text style={styles.subtasksTitle}>Subtareas iniciales (opcional)</Text>
        {subtaskTexts.map((text, index) => (
          <View key={`${text}-${index}`} style={styles.subtaskRow}>
            <Text style={styles.subtaskText}>{text}</Text>
            <TouchableOpacity onPress={() => handleRemoveSubtaskDraft(index)}>
              <Text style={styles.subtaskRemove}>Quitar</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.subtaskInputRow}>
          <TextInput
            style={styles.subtaskInput}
            value={newSubtaskText}
            onChangeText={setNewSubtaskText}
            placeholder="Ej. Investigar fuentes"
            onSubmitEditing={handleAddSubtaskDraft}
          />
          <TouchableOpacity style={styles.subtaskAddButton} onPress={handleAddSubtaskDraft}>
            <Text style={styles.subtaskAddButtonText}>Añadir</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  backButton: { paddingHorizontal: 20, paddingTop: 12 },
  backButtonText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  emptyText: { fontSize: 15, color: colors.textMuted, textAlign: "center" },
  emptyButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  emptyButtonText: { color: "#FFFFFF", fontWeight: "600" },
  subtasksSection: { paddingHorizontal: 20, paddingBottom: 24, gap: 8 },
  subtasksTitle: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  subtaskRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subtaskText: { fontSize: 15, color: colors.text, flex: 1 },
  subtaskRemove: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  subtaskInputRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  subtaskInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  subtaskAddButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  subtaskAddButtonText: { color: colors.primary, fontWeight: "600" },
});
```

- [ ] **Step 2: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Verify on a real Android emulator/device**

```bash
npx expo run:android
```

Expected walkthrough: from the Materias tab (or wherever a FAB to `/tarea/nueva` exists once Task 5 lands — until then, verify by navigating directly, e.g. `adb shell am start -a android.intent.action.VIEW -d "unitask://tarea/nueva"`), the Nueva Tarea form renders: title/description inputs, subject chips (only active-semester subjects), tapping "Fecha límite" opens the native date picker, tapping "Hora límite" opens the native time picker, priority chips select correctly, adding/removing draft subtasks works, and submitting creates the task and navigates back. Pull and read an actual screenshot at each step rather than assuming success — this session has repeatedly found bugs only visible on-device.

- [ ] **Step 4: Commit**

```bash
git add app/tarea/nueva.tsx
git commit -m "feat: add Nueva Tarea screen"
```

---

### Task 5: Task list screen (Tareas tab) with filter chips and quick-complete

**Files:**
- Modify: `app/(tabs)/tareas/index.tsx` (replace the Phase 2 placeholder)

**Interfaces:**
- Consumes: `deriveTaskStatus`/`TaskStatus` from `src/domain/task-status.ts`, `calculateTaskProgress` from `src/domain/task-progress.ts` (Phase 1); `completeTaskAction` from `src/db/repositories/task.ts` (Task 1); `SemesterReadOnlyError` from `src/db/repositories/subject.ts`; `colors`/`priorityColors`/`subjectPalette` from `src/theme`.
- Produces: the `Tareas` tab's real content and the FAB linking to `/tarea/nueva` — this is the first screen most users see tasks in.

- [ ] **Step 1: Implement the task list screen**

Replace `app/(tabs)/tareas/index.tsx`:

```tsx
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { db } from "@/db/client";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import { completeTaskAction } from "@/db/repositories/task";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus, type TaskStatus } from "@/domain/task-status";
import { colors, priorityColors, subjectPalette } from "@/theme";

type FilterChip = "Todas" | TaskStatus;

const FILTER_CHIPS: FilterChip[] = ["Todas", "Pendiente", "En progreso", "Completada", "Vencida"];

export default function TareasScreen() {
  const [filter, setFilter] = useState<FilterChip>("Todas");
  const [completingId, setCompletingId] = useState<string | null>(null);

  const { data: activeSemesterRows } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;

  const { data: subjectRows } = useLiveQuery(db.select().from(subjects));
  const activeSubjectIds = new Set(
    (subjectRows ?? [])
      .filter((subject) => subject.semesterId === activeSemesterId)
      .map((subject) => subject.id),
  );
  const subjectsById = new Map((subjectRows ?? []).map((subject) => [subject.id, subject]));

  const { data: taskRows } = useLiveQuery(db.select().from(tasks));
  const { data: subtaskRows } = useLiveQuery(db.select().from(subtasks));

  // Tareas, like Materias, scopes to the active semester only — a closed
  // semester's tasks are historical/read-only and not part of "what do I
  // have to do" (same reasoning 03-business-rules.md §15 states explicitly
  // for the Dashboard's scope).
  const enrichedTasks = (taskRows ?? [])
    .filter((task) => activeSubjectIds.has(task.subjectId))
    .map((task) => {
      const taskSubtasks = (subtaskRows ?? []).filter((subtask) => subtask.taskId === task.id);
      const progress = calculateTaskProgress(taskSubtasks, task.completed);
      const status = deriveTaskStatus({
        completed: task.completed,
        dueDateTime: task.dueDateTime,
        progress,
      });
      return { task, status, progress, subject: subjectsById.get(task.subjectId) };
    })
    .sort((a, b) => a.task.dueDateTime.getTime() - b.task.dueDateTime.getTime());

  const visibleTasks =
    filter === "Todas" ? enrichedTasks : enrichedTasks.filter((entry) => entry.status === filter);

  async function handleQuickComplete(taskId: string) {
    setCompletingId(taskId);
    try {
      await completeTaskAction(taskId);
    } catch (error) {
      if (error instanceof SemesterReadOnlyError) {
        Alert.alert("Semestre cerrado", "Este semestre está cerrado y no se puede completar.");
      } else {
        Alert.alert("Error", "No se pudo completar la tarea.");
      }
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mis Tareas</Text>
      </View>

      <View style={styles.chipsRow}>
        {FILTER_CHIPS.map((chip) => (
          <TouchableOpacity
            key={chip}
            style={[styles.chip, filter === chip && styles.chipSelected]}
            onPress={() => setFilter(chip)}
          >
            <Text style={[styles.chipText, filter === chip && styles.chipTextSelected]}>
              {chip}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {visibleTasks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No hay tareas en este filtro.</Text>
        </View>
      ) : (
        <FlatList
          data={visibleTasks}
          keyExtractor={(entry) => entry.task.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/tarea/${item.task.id}`)}
            >
              <TouchableOpacity
                style={styles.checkbox}
                disabled={item.task.completed || completingId === item.task.id}
                onPress={() => handleQuickComplete(item.task.id)}
              >
                <Text style={styles.checkboxText}>{item.task.completed ? "✓" : "○"}</Text>
              </TouchableOpacity>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.task.title}</Text>
                <View style={styles.cardMetaRow}>
                  {item.subject && (
                    <View style={styles.metaChip}>
                      <View
                        style={[
                          styles.subjectDot,
                          { backgroundColor: subjectPalette[item.subject.color] },
                        ]}
                      />
                      <Text style={styles.metaText}>{item.subject.name}</Text>
                    </View>
                  )}
                  <View style={styles.metaChip}>
                    <View
                      style={[
                        styles.priorityDot,
                        { backgroundColor: priorityColors[item.task.priority] },
                      ]}
                    />
                    <Text style={styles.metaText}>{item.task.priority}</Text>
                  </View>
                </View>
                <Text style={styles.cardStatus}>
                  {item.status} · {item.progress}%
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <Link href="/tarea/nueva" asChild>
        <TouchableOpacity style={styles.fab}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textMuted },
  chipTextSelected: { color: "#FFFFFF", fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  list: { paddingHorizontal: 20, paddingBottom: 96, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxText: { fontSize: 16, color: colors.primary, fontWeight: "700" },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  cardMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  subjectDot: { width: 8, height: 8, borderRadius: 4 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  metaText: { fontSize: 12, color: colors.textMuted },
  cardStatus: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
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

- [ ] **Step 2: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0. The card's `onPress={() => router.push(\`/tarea/${item.task.id}\`)}` points at a route Task 6 hasn't created yet in this plan's sequence — same forward-reference situation Phase 2 hit repeatedly (e.g. Task 3's `/(tabs)` link); it type-checks fine and resolves once Task 6 lands.

- [ ] **Step 3: Verify on a real Android emulator/device**

```bash
npx expo run:android
```

Expected: Tareas tab shows all tasks under the active semester (create a couple via `/tarea/nueva` first if none exist), filter chips narrow the list correctly (verify at least "Todas" and one derived filter, e.g. create a task due in the past and confirm it shows under "Vencidas"), tapping the quick-complete checkbox on an incomplete task marks it complete (checkbox flips to "✓", disabled afterward), and the empty-filter state renders when a chip has no matching tasks.

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/tareas/index.tsx"
git commit -m "feat: add Tareas tab with filter chips and quick-complete"
```

---

### Task 6: Task detail screen with subtask checklist

**Files:**
- Create: `app/tarea/[id]/index.tsx`

**Interfaces:**
- Consumes: `completeTaskAction`, from `src/db/repositories/task.ts` (Task 1); `addSubtask`, `toggleSubtaskCompleted`, `deleteSubtask`, `moveSubtask` from `src/db/repositories/subtask.ts` (Task 2); `SemesterReadOnlyError` from `src/db/repositories/subject.ts`; domain functions from Phase 1.
- Produces: the `/tarea/[id]` route Task 5's list rows and Task 7's Editar screen link back to; the only screen in this phase that manages subtasks post-creation.

- [ ] **Step 1: Create the Task detail screen**

Create `app/tarea/[id]/index.tsx`:

```tsx
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { db } from "@/db/client";
import { deleteTask, completeTaskAction } from "@/db/repositories/task";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import {
  addSubtask,
  deleteSubtask,
  moveSubtask,
  toggleSubtaskCompleted,
} from "@/db/repositories/subtask";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks } from "@/db/schema/task";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus } from "@/domain/task-status";
import { colors, priorityColors, subjectPalette } from "@/theme";

function handleActionError(error: unknown, fallbackMessage: string) {
  if (error instanceof SemesterReadOnlyError) {
    Alert.alert("Semestre cerrado", "Este semestre está cerrado y no se puede modificar.");
  } else {
    Alert.alert("Error", fallbackMessage);
  }
}

export default function DetalleDeTareaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: taskRows } = useLiveQuery(db.select().from(tasks).where(eq(tasks.id, id)));
  const task = taskRows?.[0];
  // Deliberately NOT `.where(eq(subjects.id, task?.subjectId ?? ""))`: that
  // WHERE clause's value would depend on another useLiveQuery's still-
  // resolving result, and this project has already found real bugs (Phase 2
  // Task 4) from assuming — rather than verifying — how useLiveQuery
  // reacts to a query argument that changes shape across renders without
  // an explicit deps array. Fetching all subjects and finding the match in
  // JS sidesteps the question entirely; it's the same proven pattern the
  // Tareas list (Task 5) and Materias list (Phase 2) already use.
  const { data: subjectRows } = useLiveQuery(db.select().from(subjects));
  const subject = subjectRows?.find((s) => s.id === task?.subjectId);
  const { data: subtaskRows } = useLiveQuery(
    db.select().from(subtasks).where(eq(subtasks.taskId, id)),
  );
  const taskSubtasks = (subtaskRows ?? []).slice().sort((a, b) => a.order - b.order);

  const [newSubtaskText, setNewSubtaskText] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleComplete() {
    setBusy(true);
    try {
      await completeTaskAction(id);
    } catch (error) {
      handleActionError(error, "No se pudo completar la tarea.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddSubtask() {
    const trimmed = newSubtaskText.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await addSubtask(id, trimmed);
      setNewSubtaskText("");
    } catch (error) {
      handleActionError(error, "No se pudo añadir la subtarea.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleSubtask(subtaskId: string, completed: boolean) {
    setBusy(true);
    try {
      await toggleSubtaskCompleted(subtaskId, completed);
    } catch (error) {
      handleActionError(error, "No se pudo actualizar la subtarea.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveSubtask(subtaskId: string) {
    setBusy(true);
    try {
      await deleteSubtask(subtaskId);
    } catch (error) {
      handleActionError(error, "No se pudo eliminar la subtarea.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveSubtask(subtaskId: string, direction: "up" | "down") {
    setBusy(true);
    try {
      await moveSubtask(subtaskId, direction);
    } catch (error) {
      handleActionError(error, "No se pudo reordenar la subtarea.");
    } finally {
      setBusy(false);
    }
  }

  function handleDeletePress() {
    Alert.alert("Eliminar tarea", "Esta acción eliminará la tarea y sus subtareas.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteTask(id);
            router.back();
          } catch (error) {
            handleActionError(error, "No se pudo eliminar la tarea.");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (!task) {
    return (
      <SafeAreaView style={styles.center} edges={["top"]}>
        <Text>Cargando…</Text>
      </SafeAreaView>
    );
  }

  const progress = calculateTaskProgress(taskSubtasks, task.completed);
  const status = deriveTaskStatus({
    completed: task.completed,
    dueDateTime: task.dueDateTime,
    progress,
  });

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>← Volver</Text>
      </TouchableOpacity>

      <View style={styles.headerRow}>
        <View style={[styles.priorityDot, { backgroundColor: priorityColors[task.priority] }]} />
        <Text style={styles.title}>{task.title}</Text>
      </View>
      <Text style={styles.statusLine}>
        {status} · {progress}% · Prioridad {task.priority}
      </Text>
      {subject && (
        <View style={styles.subjectRow}>
          <View style={[styles.subjectDot, { backgroundColor: subjectPalette[subject.color] }]} />
          <Text style={styles.detail}>{subject.name}</Text>
        </View>
      )}
      <Text style={styles.detail}>
        Vence: {task.dueDateTime.toLocaleString("es", { dateStyle: "long", timeStyle: "short" })}
      </Text>
      {task.description ? <Text style={styles.description}>{task.description}</Text> : null}

      <TouchableOpacity
        style={[styles.completeButton, task.completed && styles.completeButtonDisabled]}
        onPress={handleComplete}
        disabled={task.completed || busy}
      >
        <Text style={styles.completeButtonText}>
          {task.completed ? "Completada" : "Marcar como completada"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Subtareas</Text>
      {taskSubtasks.map((subtask, index) => (
        <View key={subtask.id} style={styles.subtaskRow}>
          <TouchableOpacity
            style={styles.subtaskCheckbox}
            disabled={busy}
            onPress={() => handleToggleSubtask(subtask.id, !subtask.completed)}
          >
            <Text style={styles.subtaskCheckboxText}>{subtask.completed ? "✓" : "○"}</Text>
          </TouchableOpacity>
          <Text
            style={[styles.subtaskText, subtask.completed && styles.subtaskTextCompleted]}
          >
            {subtask.text}
          </Text>
          <TouchableOpacity
            disabled={busy || index === 0}
            onPress={() => handleMoveSubtask(subtask.id, "up")}
          >
            <Text style={styles.subtaskAction}>↑</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={busy || index === taskSubtasks.length - 1}
            onPress={() => handleMoveSubtask(subtask.id, "down")}
          >
            <Text style={styles.subtaskAction}>↓</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={() => handleRemoveSubtask(subtask.id)}>
            <Text style={styles.subtaskRemove}>Quitar</Text>
          </TouchableOpacity>
        </View>
      ))}
      <View style={styles.subtaskInputRow}>
        <TextInput
          style={styles.subtaskInput}
          value={newSubtaskText}
          onChangeText={setNewSubtaskText}
          placeholder="Nueva subtarea"
          onSubmitEditing={handleAddSubtask}
        />
        <TouchableOpacity style={styles.subtaskAddButton} disabled={busy} onPress={handleAddSubtask}>
          <Text style={styles.subtaskAddButtonText}>Añadir</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => router.push(`/tarea/${task.id}/editar`)}
        >
          <Text style={styles.editButtonText}>Editar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeletePress}
          disabled={deleting}
        >
          <Text style={styles.deleteButtonText}>Eliminar tarea</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  backButton: { alignSelf: "flex-start" },
  backButtonText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  priorityDot: { width: 14, height: 14, borderRadius: 7 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, flex: 1 },
  statusLine: { fontSize: 13, color: colors.textMuted },
  subjectRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  subjectDot: { width: 10, height: 10, borderRadius: 5 },
  detail: { fontSize: 14, color: colors.textMuted },
  description: { fontSize: 14, color: colors.text, marginTop: 4 },
  completeButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  completeButtonDisabled: { opacity: 0.5 },
  completeButtonText: { color: "#FFFFFF", fontWeight: "600" },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 20 },
  subtaskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subtaskCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  subtaskCheckboxText: { fontSize: 13, color: colors.primary, fontWeight: "700" },
  subtaskText: { flex: 1, fontSize: 14, color: colors.text },
  subtaskTextCompleted: { textDecorationLine: "line-through", color: colors.textMuted },
  subtaskAction: { fontSize: 16, color: colors.primary, paddingHorizontal: 4 },
  subtaskRemove: { color: colors.danger, fontSize: 12, fontWeight: "600" },
  subtaskInputRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  subtaskInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  subtaskAddButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  subtaskAddButtonText: { color: colors.primary, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 12, marginTop: 24 },
  editButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  editButtonText: { color: colors.primary, fontWeight: "600" },
  deleteButton: {
    flex: 1,
    backgroundColor: colors.danger,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  deleteButtonText: { color: "#FFFFFF", fontWeight: "600" },
});
```

- [ ] **Step 2: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0. The "Editar" button's `router.push(\`/tarea/${task.id}/editar\`)` points at a route Task 7 hasn't created yet — same forward-reference pattern as Task 5's link to this screen; resolves once Task 7 lands.

- [ ] **Step 3: Verify on a real Android emulator/device**

```bash
npx expo run:android
```

Expected walkthrough: open a task from the Tareas list, confirm status/progress/priority/subject/due date render correctly, add a subtask (progress % updates live), toggle a subtask complete/incomplete (progress updates), reorder two subtasks with ↑/↓ (order persists across a screen refresh), tap "Marcar como completada" (all subtasks auto-check, button becomes disabled and reads "Completada"), and confirm deleting a task (with subtasks) returns to the list and the task is gone. Also verify the closed-semester case: close the task's semester via `/semestres`, reopen the task detail screen, and confirm every action (complete, add/toggle/delete subtask, delete task) shows the "Semestre cerrado" alert instead of silently succeeding or failing.

- [ ] **Step 4: Commit**

```bash
git add app/tarea/[id]/index.tsx
git commit -m "feat: add Task detail screen with subtask checklist"
```

---

### Task 7: Editar Tarea screen and Phase 3 Definition-of-Done verification

**Files:**
- Create: `app/tarea/[id]/editar.tsx`

**Interfaces:**
- Consumes: `TaskForm`/`TaskFormSubjectOption` from `src/components/TaskForm.tsx` (Task 3); `combineDateAndTime` from `src/validation/task.ts` (Task 3); `updateTask` from `src/db/repositories/task.ts` (Task 1); `SemesterReadOnlyError` from `src/db/repositories/subject.ts`.
- Produces: the last screen needed to satisfy this phase's roadmap acceptance criteria.

- [ ] **Step 1: Create the Editar Tarea screen**

Create `app/tarea/[id]/editar.tsx`:

```tsx
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, StyleSheet, Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TaskForm, type TaskFormSubjectOption } from "@/components/TaskForm";
import { db } from "@/db/client";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import { updateTask } from "@/db/repositories/task";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { colors } from "@/theme";
import { combineDateAndTime, type TaskFormValues } from "@/validation/task";

export default function EditarTareaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: taskRows } = useLiveQuery(db.select().from(tasks).where(eq(tasks.id, id)));
  const task = taskRows?.[0];

  const { data: activeSemesterRows } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;
  const { data: subjectRows } = useLiveQuery(db.select().from(subjects));
  const activeSubjects = (subjectRows ?? [])
    .filter((subject) => subject.semesterId === activeSemesterId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  async function handleSubmit(values: TaskFormValues) {
    try {
      await updateTask(id, {
        title: values.title,
        description: values.description || null,
        subjectId: values.subjectId,
        dueDateTime: combineDateAndTime(values.dueDate, values.dueTime),
        priority: values.priority,
      });
      router.back();
    } catch (error) {
      if (error instanceof SemesterReadOnlyError) {
        Alert.alert("Semestre cerrado", "Este semestre está cerrado y no se puede editar.");
      } else {
        Alert.alert("Error", "No se pudo guardar los cambios.");
      }
    }
  }

  if (!task) {
    return (
      <SafeAreaView style={styles.center} edges={["top"]}>
        <Text>Cargando…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>← Volver</Text>
      </TouchableOpacity>
      <TaskForm
        subjects={activeSubjects as TaskFormSubjectOption[]}
        submitLabel="Guardar cambios"
        initialValues={{
          title: task.title,
          description: task.description ?? "",
          subjectId: task.subjectId,
          dueDate: task.dueDateTime,
          dueTime: task.dueDateTime,
          priority: task.priority,
        }}
        onSubmit={handleSubmit}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  backButton: { paddingHorizontal: 20, paddingTop: 12 },
  backButtonText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
});
```

- [ ] **Step 2: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Run the full combined check for the whole phase**

```bash
npm test
npx tsc --noEmit
npm run lint
npx prettier --check .
```

Expected: all exit 0. `npm test` should now show 12 suites (all of Phase 0-2's suites plus this phase's `task.test.ts` and `subtask.test.ts`), all passing.

- [ ] **Step 4: Verify on a real Android emulator/device — the full phase acceptance criteria**

```bash
npx expo run:android
```

Manually walk through, on the emulator, in one continuous session:

1. Fresh app (clear data first: `adb shell pm clear com.alejozd.unitask`) → onboarding → create a semester → create a subject.
2. Create a task from the Tareas tab FAB: title, subject, due date/time (in the future), priority, two initial subtasks. Confirm it appears in the Tareas list with the correct subject/priority/status ("Pendiente").
3. Open the task, add a third subtask, toggle one subtask complete — confirm progress % updates and status becomes "En progreso" both on the detail screen and back on the Tareas list.
4. Edit the task ("Editar"): change its due date to a moment in the past, save. Confirm status becomes "Vencida" on both screens (Vencida takes priority over En progreso even with partial progress — `03-business-rules.md` §1).
5. From the Tareas list, tap the quick-complete checkbox on a different task (or the same one). Confirm all its subtasks become checked, progress shows 100%, status shows "Completada", and the checkbox is now disabled.
6. Filter through all five chips (Todas/Pendientes/En progreso/Completadas/Vencidas) and confirm each shows exactly the expected subset.
7. Close the task's semester via the Materias tab's "Semestres" link → "Cerrar semestre". Return to the task's detail screen and confirm every mutating action (complete, edit, delete, add/toggle/delete subtask) now shows the "Semestre cerrado" alert instead of succeeding.
8. Delete a task (in a still-open semester) with subtasks and confirm it disappears from the list with no orphaned subtasks (spot-check via a fresh app relaunch that it doesn't reappear).

- [ ] **Step 5: Commit**

```bash
git add app/tarea/[id]/editar.tsx
git commit -m "feat: add Editar Tarea screen"
```

---

## Phase 3 — Definition of Done

All seven tasks above complete, in order, means:

- Tasks can be created with subtasks, edited (including reassigning subject/priority/due date), completed, and deleted, all through the Tareas tab and Task detail screen (Task 1, 2, 4, 5, 6, 7).
- Task status and progress always match `03-business-rules.md` §1-§3 for every combination exercised in tests and the on-device walkthrough — computed live via `useLiveQuery` + the Phase 1 domain functions, never stored (Task 5, 6).
- Completing a task via either entry point (list checkbox, detail button) auto-checks all subtasks and stamps `completedLate` correctly (Task 1, verified by both repository tests and the on-device walkthrough).
- Editing, deleting, or completing a task — and adding/editing/toggling/reordering/removing a subtask — under a closed semester is blocked at the repository layer, not just hidden in the UI (Task 1, 2, verified on-device in Task 7 Step 4).
- `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npx prettier --check .` all exit 0 against the final tree — this full combined check is re-run at the end of the phase, not just relied upon from each task's own checks (the lesson repeated from every prior phase's final review: cross-task issues only surface at a phase-level re-run).

This unblocks Phase 4 (Reminders + local notifications), which will be written as its own separate implementation plan once Phase 3 is executed and reviewed.
