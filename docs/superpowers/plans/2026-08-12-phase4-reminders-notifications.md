# Phase 4 — Reminders + Local Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every task a per-reminder configuration (relative offset or custom fixed datetime) that schedules, reschedules, and cancels real Android local notifications via `expo-notifications`, following `03-business-rules.md` §7 and `08-notifications.md` exactly.

**Architecture:** A thin `src/lib/notifications/` wrapper is the only file that imports `expo-notifications` directly. A new `src/db/repositories/reminder.ts` owns reminder CRUD and OS-notification side effects (schedule/cancel), reusing Phase 1's pure `src/domain/reminder-scheduling.ts` for all the offset/reschedule math. `src/db/repositories/task.ts` is extended to *orchestrate* reminders as part of create/update/complete/delete — the closed-semester + notification-cancellation guarantees live at the repository layer, not duplicated per-screen. A new `src/components/ReminderPicker.tsx` is the one reusable "add a reminder" UI, used from both Nueva Tarea (draft reminders before the task exists) and the Task detail screen (reminders on an existing task).

**Tech Stack:** `expo-notifications` (SDK 57, installed via `npx expo install` — do not hand-pin a version, per this project's `AGENTS.md`), Drizzle ORM (existing `reminders` table from Phase 1), React Hook Form + zod (existing `TaskForm` pattern), Jest (existing `jest.mock()` pattern already used for `@/db/client`-adjacent modules).

## Global Constraints

- **Closed-semester read-only cascade (03-business-rules.md §11) extends to Reminder this phase**: adding, editing, or removing a reminder on a task whose subject belongs to a closed semester must be blocked at the repository layer, throwing the same `SemesterReadOnlyError` reused from `@/db/repositories/subject` — do not define a second error class.
- **Default reminder on task creation (§7)**: every new task gets one "1 día antes" reminder pre-populated in the Nueva Tarea form, editable/removable by the user before submit. This default is a **UI-layer** default (Nueva Tarea's initial draft state via `defaultReminder()` from `src/domain/reminder-scheduling.ts`), not a repository-layer one — `createTask`'s `reminderSpecs` input has no implicit default; an empty array means zero reminders, exactly mirroring how `subtaskTexts` already works.
- **Cancellation on completion/deletion (§7, §5, §6)**: `completeTaskAction` and `deleteTask` (both already existing, Phase 3) must cancel every pending OS notification for the task's reminders as part of the same repository call — never left to the UI to remember to do separately.
- **Rescheduling on due-date edit (§7)**: when `updateTask` changes `dueDateTime`, every reminder that has **not yet fired** (this project's chosen proxy for "not yet fired": `notificationId IS NOT NULL` — the schema's own documented convention, see `src/db/schema/reminder.ts`) is recomputed/validated per §7's exact rules (reused verbatim from Phase 1's `rescheduleOnDueDateChange`), and `updateTask`'s return value reports how many reminders were auto-removed so the UI can show the required in-app notice.
- **No exact-alarm permission requested — deliberate, documented decision**: `08-notifications.md` flagged Android 12+'s `SCHEDULE_EXACT_ALARM` as "verify at implementation time... if a slightly-inexact fire time is acceptable... the standard trigger avoids needing this permission entirely." This plan makes that call: reminders use `expo-notifications`' standard `DATE` trigger with **no** `SCHEDULE_EXACT_ALARM` permission declared. A homework reminder does not need second-level precision, and skipping this permission avoids an entire additional Android-version-gated permission-request flow. Do not add `SCHEDULE_EXACT_ALARM` to `app.json`/`AndroidManifest.xml` in this phase.
- **Boot-persistence — resolved, no custom code needed**: verified against the current SDK 57 docs (`docs.expo.dev/versions/v57.0.0/sdk/notifications`): `expo-notifications`' own `AndroidManifest.xml` automatically declares `RECEIVE_BOOT_COMPLETED` and re-registers scheduled notifications with `AlarmManager` after a device reboot — this is native library behavior, not something this app's JS code needs to implement. `08-notifications.md`'s flagged "Action item for implementation phase" (boot-time re-registration) is resolved by this finding: **no boot-time re-registration code is built in this phase.**
- **Android 13+ permission ordering**: the OS permission prompt for `POST_NOTIFICATIONS` will not appear until at least one notification channel exists (`Notifications.setNotificationChannelAsync` must run before `Notifications.requestPermissionsAsync`). The notifications wrapper (Task 1) handles this ordering internally — callers never need to think about it.
- **Lazy permission request (08-notifications.md)**: permission is requested only when a reminder is actually about to be scheduled (inside `addReminder`/rescheduling, when the computed fire time is in the future) — never proactively on app launch.
- **Denied-permission reminders are still saved, just not scheduled (08-notifications.md)**: if permission is denied, the reminder row is still created with `notificationId = null`. The UI must not claim the reminder is active when `notificationId` is null — the Task detail screen's reminder list shows a "no programado" indicator for such rows.
- **No component tests for screens** — Jest stays domain/repository-only in this project (established Phase 1-3 precedent); `ReminderPicker` and the three screen integrations get on-device verification only. `src/lib/notifications/` itself is a thin, mostly-untestable-in-Jest wrapper (its whole job is calling the native SDK) and is verified on-device in Task 9, not via Jest.
- **Reused, not reinvented**: `src/domain/reminder-scheduling.ts`'s `computeFireAt`, `defaultReminder`, `rescheduleOnDueDateChange`, and its `ReminderSpec`/`RelativeReminder`/`FixedReminder`/`ReschedulableReminder`/`RescheduleAction` types (all Phase 1, already unit-tested — do not modify their tests, do not re-derive their math) are the single source of truth for every offset/reschedule calculation in this phase.
- **Priority is always shown with both a color and a text label, never color alone (03-business-rules.md §18)** — unaffected by this phase, but any new UI must not regress it.
- **Editar Tarea does NOT get its own `ReminderPicker`/reminder list** — a deliberate scoping decision, not an oversight. `11-roadmap.md`'s one-line Phase 4 summary lists "Nueva/Editar Tarea and Detalle de Tarea" as integration points, but `04-user-flows.md`'s actual flow 4 ("Edit a task's due date and reminder impact") only ever describes *automatic* due-date-triggered rescheduling — no manual reminder-editing UI inside the edit form. This mirrors Phase 3's already-approved precedent exactly: subtasks are only manageable post-creation via the Task detail screen, never via Editar Tarea, even though subtasks are also nominally "edited." Editar Tarea's only Phase 4 responsibility is Task 8's reschedule notice.

---

### Task 1: `expo-notifications` dependency and the notifications wrapper module

**Files:**
- Modify: `app.json` (plugins array)
- Create: `src/lib/notifications/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this task is the foundation).
- Produces: `ensureReminderChannel()`, `getNotificationPermission()`, `requestNotificationPermission()`, `scheduleReminderNotification(fireAt, content)`, `cancelReminderNotification(notificationId)` — all from `@/lib/notifications`. Task 2's `reminder.ts` consumes `requestNotificationPermission`, `scheduleReminderNotification`, `cancelReminderNotification`.

- [ ] **Step 1: Install the dependency**

```bash
npx expo install expo-notifications
```

Expected: resolves and pins the SDK-57-compatible version (recommended `~57.0.10` per the current Expo docs — `npx expo install` picks the exact compatible version itself; do not hand-pin). This is a **native module** (like Phase 3's `@react-native-community/datetimepicker`) — it will not take effect until a native rebuild (Step 4 below).

- [ ] **Step 2: Register the config plugin**

Modify `app.json` — add `"expo-notifications"` to the existing `plugins` array (leave every other entry unchanged):

```json
"plugins": [
  "expo-router",
  "expo-status-bar",
  "expo-sqlite",
  "expo-asset",
  "@react-native-community/datetimepicker",
  "expo-notifications"
],
```

No icon/color/sound customization — this project has no notification icon asset yet, and the library's defaults are acceptable for this phase (Global Constraints: no `SCHEDULE_EXACT_ALARM`, keep this minimal).

- [ ] **Step 3: Create the notifications wrapper**

Create `src/lib/notifications/index.ts`:

```ts
import * as Notifications from "expo-notifications";

const REMINDER_CHANNEL_ID = "reminders";

// Foreground display behavior — without this, a notification scheduled
// while the app is open and in the foreground is silently swallowed
// instead of shown. Runs once, at module-import time (this module is a
// singleton, same pattern as src/db/client.ts).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Creates (or updates) the Android notification channel every reminder is
 * scheduled under. Must run before `requestPermissionsAsync` — on Android
 * 13+, the OS permission prompt does not appear until at least one channel
 * exists (verified against the SDK 57 docs, see this plan's Global
 * Constraints).
 */
export async function ensureReminderChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: "Recordatorios de tareas",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export interface NotificationPermissionResult {
  granted: boolean;
}

/**
 * Checks current permission status without prompting the user.
 */
export async function getNotificationPermission(): Promise<NotificationPermissionResult> {
  const settings = await Notifications.getPermissionsAsync();
  return { granted: settings.granted };
}

/**
 * Requests notification permission. Call this lazily — only right before
 * scheduling the first real reminder (08-notifications.md) — never on app
 * launch. Ensures the notification channel exists first (see
 * `ensureReminderChannel`'s doc comment). Safe to call repeatedly: once the
 * user has answered, Android will not re-prompt (the OS returns the prior
 * decision immediately).
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  await ensureReminderChannel();
  const settings = await Notifications.requestPermissionsAsync();
  return { granted: settings.granted };
}

export interface ReminderNotificationContent {
  taskTitle: string;
  subjectName: string;
  dueDateTime: Date;
}

/**
 * Schedules a local notification at `fireAt`. Returns the OS-assigned
 * notification id — store it on the Reminder row so it can be individually
 * cancelled later via `cancelReminderNotification`. Uses the standard
 * (non-exact) DATE trigger — deliberately does NOT request
 * SCHEDULE_EXACT_ALARM (see this plan's Global Constraints): a task
 * reminder does not need second-level firing precision, and the standard
 * trigger avoids that whole extra Android-12+ permission flow.
 */
export async function scheduleReminderNotification(
  fireAt: Date,
  content: ReminderNotificationContent,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: content.taskTitle,
      body: `${content.subjectName} · vence ${content.dueDateTime.toLocaleString("es", {
        dateStyle: "medium",
        timeStyle: "short",
      })}`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: REMINDER_CHANNEL_ID,
    },
  });
}

/**
 * Cancels a single scheduled notification. Safe to call with an id that
 * has already fired or doesn't exist — `expo-notifications` resolves
 * either way, no error thrown.
 */
export async function cancelReminderNotification(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
```

- [ ] **Step 4: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0. If `tsc` complains about `Notifications.SchedulableTriggerInputTypes.DATE` or the trigger object shape, check the actual installed types under `node_modules/expo-notifications/build/*.d.ts` rather than guessing — this project's `AGENTS.md` requires verifying against the installed version, not assuming an older API shape.

- [ ] **Step 5: Verify the native build succeeds**

```bash
npx expo run:android
```

Expected: `BUILD SUCCESSFUL` — confirms the native module linked correctly (same verification this project did for Phase 3's datetimepicker). Full functional verification (a real notification actually appearing) happens in Task 9 once reminders can actually be created end-to-end.

- [ ] **Step 6: Commit**

```bash
git add app.json src/lib/notifications/index.ts package.json package-lock.json
git commit -m "feat: add expo-notifications dependency and notifications wrapper"
```

---

### Task 2: Extract shared task-access checks, then build the Reminder repository (TDD)

**Files:**
- Create: `src/db/repositories/errors.ts`, `src/db/repositories/task-access.ts`, `src/db/repositories/reminder.ts`, `src/db/repositories/__tests__/reminder.test.ts`
- Modify: `src/db/repositories/task.ts` (replace the local `assertSubjectEditable`/`assertTaskEditable` definitions with a re-export from the new module — no behavior change), `src/db/repositories/subject.ts` (replace the local `SemesterReadOnlyError` definition with a re-export — no behavior change)

**Interfaces:**
- Consumes: `computeFireAt`, `rescheduleOnDueDateChange`, `ReminderSpec` from `src/domain/reminder-scheduling.ts` (Phase 1); `requestNotificationPermission`, `scheduleReminderNotification`, `cancelReminderNotification` from `@/lib/notifications` (Task 1); `Database` type from `@/db/repositories/semester`; `reminders`/`Reminder` from `@/db/schema/reminder` (Phase 1).
- Produces: `SemesterReadOnlyError` from `@/db/repositories/errors` (re-exported unchanged from `@/db/repositories/subject`, so every existing import across the whole codebase — `task.ts`, `subtask.ts`, every screen, every test — keeps working unmodified). `assertTaskEditable`, `assertSubjectEditable` from `@/db/repositories/task-access` (Task 3's extended `task.ts` re-exports `assertTaskEditable` too, so `subtask.ts`'s existing `import { assertTaskEditable } from "@/db/repositories/task"` keeps working unmodified). `addReminder`, `removeReminder`, `cancelAllRemindersForTask`, `rescheduleRemindersForTask` from `@/db/repositories/reminder` — Task 3's `task.ts` consumes all four, and Task 4's `subject.ts` extension consumes `cancelAllRemindersForTask`.

**Why TWO extractions, not one (read before writing code):** Task 3 needs `task.ts` to call INTO `reminder.ts` (to trigger scheduling/cancelling as part of create/update/complete/delete). But `reminder.ts` also needs `assertTaskEditable`, which currently lives IN `task.ts` — so `assertTaskEditable` moves to a new `task-access.ts` that both `task.ts` and `reminder.ts` depend on, one direction only.

That alone isn't enough: `task-access.ts` needs `SemesterReadOnlyError`, which currently lives in `subject.ts`. Task 4 (below) needs `subject.ts` to call INTO `reminder.ts` too (to cancel reminders for tasks a subject-deletion cascades away). If `task-access.ts` imported `SemesterReadOnlyError` from `@/db/repositories/subject`, the chain would be: `subject.ts` → `reminder.ts` → `task-access.ts` → `subject.ts` — a 3-hop cycle. Moving `SemesterReadOnlyError` into its own tiny `errors.ts` (which nothing else depends on) breaks that too: `task-access.ts` → `errors.ts` (dead end), `subject.ts` → `errors.ts` (dead end), and the only remaining cross-repository edges are `reminder.ts` → `task-access.ts`, `task.ts` → `reminder.ts`, and `subject.ts` → `reminder.ts` — all one-directional, no cycle anywhere.

- [ ] **Step 1: Extract `errors.ts`**

Create `src/db/repositories/errors.ts` — this is `subject.ts`'s current `SemesterReadOnlyError` class, moved verbatim (leave `SubjectDeletionBlockedError` where it is; it isn't part of the cycle):

```ts
export class SemesterReadOnlyError extends Error {
  constructor() {
    super("No se puede modificar una materia de un semestre cerrado.");
    this.name = "SemesterReadOnlyError";
  }
}
```

- [ ] **Step 2: Point `subject.ts` at the extracted error class**

Modify `src/db/repositories/subject.ts` — replace the existing `export class SemesterReadOnlyError extends Error { ... }` block with:

```ts
export { SemesterReadOnlyError } from "@/db/repositories/errors";
```

Add the import at the top of the file alongside the existing imports:

```ts
import { SemesterReadOnlyError } from "@/db/repositories/errors";
```

(The re-export line and the import together mean `subject.ts` still has a local `SemesterReadOnlyError` binding for its own internal use, AND still exports it under the same name for every other file's existing `import { SemesterReadOnlyError } from "@/db/repositories/subject"` to keep working.)

- [ ] **Step 3: Extract `task-access.ts`**

Create `src/db/repositories/task-access.ts` — this is `task.ts`'s current `assertSubjectEditable`/`assertTaskEditable` functions, moved verbatim, importing `SemesterReadOnlyError` from the new `errors.ts` instead of from `subject.ts`:

```ts
import { eq } from "drizzle-orm";

import type { Database } from "@/db/repositories/semester";
import { SemesterReadOnlyError } from "@/db/repositories/errors";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks, type Task } from "@/db/schema/task";
import { isSemesterReadOnly } from "@/domain/semester-lifecycle";

/**
 * Shared closed-semester access checks for tasks and everything that
 * hangs off a task (subtasks, reminders). Lives in its own module (not in
 * task.ts, where this originated in Phase 3) so reminder.ts (Phase 4) can
 * import `assertTaskEditable` without creating a task.ts <-> reminder.ts
 * circular import: task.ts itself calls into reminder.ts to trigger
 * scheduling/cancelling side effects, so the reverse edge would cycle.
 * Imports `SemesterReadOnlyError` from `errors.ts`, not `subject.ts`, for
 * the same reason — see this task's "Why TWO extractions" note.
 */
export async function assertSubjectEditable(subjectId: string, database: Database): Promise<void> {
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

export async function assertTaskEditable(taskId: string, database: Database): Promise<Task> {
  const rows = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) throw new Error(`Task not found: ${taskId}`);
  await assertSubjectEditable(task.subjectId, database);
  return task;
}
```

- [ ] **Step 4: Point `task.ts` at the extracted module**

Modify `src/db/repositories/task.ts` — replace the top of the file (imports plus the local `assertSubjectEditable`/`assertTaskEditable` definitions) with:

```ts
import { randomUUID } from "expo-crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { assertSubjectEditable, assertTaskEditable } from "@/db/repositories/task-access";
import { subtasks } from "@/db/schema/subtask";
import { tasks, type Task } from "@/db/schema/task";
import { completeTask } from "@/domain/task-completion";

export { assertTaskEditable };
```

Delete the old `async function assertSubjectEditable(...)` and `export async function assertTaskEditable(...)` bodies entirely — everything below them (`CreateTaskInput` onward) stays exactly as-is for this step. The `export { assertTaskEditable };` line preserves `subtask.ts`'s existing `import { assertTaskEditable } from "@/db/repositories/task";` — do not touch `subtask.ts` in this task.

- [ ] **Step 5: Verify nothing broke**

```bash
npx tsc --noEmit
npm test -- task.test.ts subtask.test.ts
```

Expected: `tsc` exit 0; both suites still fully pass (11 tests in `task.test.ts`, 13 in `subtask.test.ts`) — this step is a pure refactor, zero behavior change, so a red test here means the extraction was done wrong, not that a test needs updating.

- [ ] **Step 6: Write the failing reminder repository tests**

Create `src/db/repositories/__tests__/reminder.test.ts`:

```ts
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { reminders } from "@/db/schema/reminder";
import { createTask } from "@/db/repositories/task";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import {
  addReminder,
  cancelAllRemindersForTask,
  removeReminder,
  rescheduleRemindersForTask,
} from "@/db/repositories/reminder";
import * as notifications from "@/lib/notifications";

jest.mock("@/lib/notifications");
const mockedNotifications = jest.mocked(notifications);

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

let notificationCounter = 0;

beforeEach(() => {
  jest.clearAllMocks();
  notificationCounter = 0;
  mockedNotifications.requestNotificationPermission.mockResolvedValue({ granted: true });
  mockedNotifications.scheduleReminderNotification.mockImplementation(async () => {
    notificationCounter += 1;
    return `mock-notification-${notificationCounter}`;
  });
  mockedNotifications.cancelReminderNotification.mockResolvedValue(undefined);
});

async function seedTaskInActiveSemester(db: ReturnType<typeof freshTestDb>, dueDateTime: Date) {
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
  // No reminderSpecs — this seed helper creates a task with zero reminders
  // so each test explicitly sets up its own reminder scenario via
  // addReminder, rather than implicitly depending on createTask's own
  // reminder-creation behavior (tested separately in task.test.ts).
  const task = await createTask(
    { title: "Tarea", subjectId, dueDateTime, priority: "Media", reminderSpecs: [] },
    db,
  );
  return { semesterId, task };
}

describe("reminder repository", () => {
  describe("addReminder", () => {
    it("creates a relative reminder and schedules a notification", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);

      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      expect(reminder.kind).toBe("relative");
      expect(reminder.offsetValue).toBe(1);
      expect(reminder.offsetUnit).toBe("days");
      expect(reminder.computedFireAt.getTime()).toBe(dueDateTime.getTime() - 86_400_000);
      expect(reminder.notificationId).toBe("mock-notification-1");
      expect(mockedNotifications.scheduleReminderNotification).toHaveBeenCalledTimes(1);
    });

    it("creates a fixed reminder and schedules a notification", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const fixedDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);

      const reminder = await addReminder(task.id, { kind: "fixed", fixedDateTime }, db);

      expect(reminder.kind).toBe("fixed");
      expect(reminder.fixedDateTime).toEqual(fixedDateTime);
      expect(reminder.computedFireAt).toEqual(fixedDateTime);
      expect(reminder.notificationId).toBe("mock-notification-1");
    });

    it("does not schedule a notification when permission is denied, but still creates the reminder record", async () => {
      mockedNotifications.requestNotificationPermission.mockResolvedValue({ granted: false });
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);

      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      expect(reminder.notificationId).toBeNull();
      expect(mockedNotifications.scheduleReminderNotification).not.toHaveBeenCalled();
    });

    it("does not schedule a notification when the computed fire time is already in the past", async () => {
      const db = freshTestDb();
      // Due in 30 minutes; a "1 día antes" offset computes to a fire time
      // almost a full day in the past.
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 30);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);

      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      expect(reminder.notificationId).toBeNull();
      expect(mockedNotifications.scheduleReminderNotification).not.toHaveBeenCalled();
      // Permission should not even be requested for a reminder that can
      // never fire — nothing to schedule, nothing to ask permission for.
      expect(mockedNotifications.requestNotificationPermission).not.toHaveBeenCalled();
    });

    it("blocks adding a reminder under a closed semester", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task, semesterId } = await seedTaskInActiveSemester(db, dueDateTime);
      await db.update(semesters).set({ status: "closed", closedAt: new Date() });
      void semesterId;

      await expect(
        addReminder(task.id, { kind: "relative", offsetValue: 1, offsetUnit: "days" }, db),
      ).rejects.toThrow(SemesterReadOnlyError);
    });
  });

  describe("removeReminder", () => {
    it("removes a reminder and cancels its notification", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      await removeReminder(reminder.id, db);

      const remaining = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(remaining).toHaveLength(0);
      expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
        "mock-notification-1",
      );
    });

    it("removing a reminder with no notificationId does not attempt to cancel anything", async () => {
      mockedNotifications.requestNotificationPermission.mockResolvedValue({ granted: false });
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      await removeReminder(reminder.id, db);

      expect(mockedNotifications.cancelReminderNotification).not.toHaveBeenCalled();
    });

    it("blocks removing a reminder under a closed semester", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );
      await db.update(semesters).set({ status: "closed", closedAt: new Date() });

      await expect(removeReminder(reminder.id, db)).rejects.toThrow(SemesterReadOnlyError);
    });
  });

  describe("cancelAllRemindersForTask", () => {
    it("cancels every pending reminder's notification and clears notificationId, without deleting the rows", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const r1 = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );
      const r2 = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 2, offsetUnit: "hours" },
        db,
      );

      await cancelAllRemindersForTask(task.id, db);

      expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledTimes(2);
      const rows = await db.select().from(reminders).where(eq(reminders.taskId, task.id));
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.notificationId === null)).toBe(true);
      void r1;
      void r2;
    });
  });

  describe("rescheduleRemindersForTask", () => {
    it("reschedules a relative reminder still in the future after the due-date change", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      const newDueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10);
      const result = await rescheduleRemindersForTask(task.id, newDueDateTime, db);

      expect(result.removedCount).toBe(0);
      expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
        "mock-notification-1",
      );
      expect(mockedNotifications.scheduleReminderNotification).toHaveBeenCalledTimes(2); // 1 on create, 1 on reschedule
      const [updated] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(updated.computedFireAt.getTime()).toBe(newDueDateTime.getTime() - 86_400_000);
      expect(updated.notificationId).toBe("mock-notification-2");
    });

    it("removes a relative reminder whose recomputed fire time is now in the past", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      // New due date is 30 minutes from now — "1 día antes" would fire in the past.
      const newDueDateTime = new Date(Date.now() + 1000 * 60 * 30);
      const result = await rescheduleRemindersForTask(task.id, newDueDateTime, db);

      expect(result.removedCount).toBe(1);
      const remaining = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(remaining).toHaveLength(0);
    });

    it("removes a fixed reminder that now falls at/after the new due date", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const fixedDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const reminder = await addReminder(task.id, { kind: "fixed", fixedDateTime }, db);

      // New due date moves to before the fixed reminder's own datetime.
      const newDueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5);
      const result = await rescheduleRemindersForTask(task.id, newDueDateTime, db);

      expect(result.removedCount).toBe(1);
      const remaining = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(remaining).toHaveLength(0);
    });

    it("leaves already-fired reminders (notificationId null) untouched", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );
      // Simulate an already-fired (or already-cancelled) reminder.
      await db.update(reminders).set({ notificationId: null }).where(eq(reminders.id, reminder.id));

      const newDueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 20);
      const result = await rescheduleRemindersForTask(task.id, newDueDateTime, db);

      expect(result.removedCount).toBe(0);
      const [unchanged] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(unchanged.computedFireAt.getTime()).toBe(dueDateTime.getTime() - 86_400_000); // still the OLD computed value
    });

    it("blocks rescheduling reminders under a closed semester", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      await addReminder(task.id, { kind: "relative", offsetValue: 1, offsetUnit: "days" }, db);
      await db.update(semesters).set({ status: "closed", closedAt: new Date() });

      await expect(
        rescheduleRemindersForTask(task.id, new Date(Date.now() + 1000 * 60 * 60 * 24 * 20), db),
      ).rejects.toThrow(SemesterReadOnlyError);
    });
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

```bash
npx jest src/db/repositories/__tests__/reminder.test.ts
```

Expected: FAIL — `Cannot find module '@/db/repositories/reminder'`.

- [ ] **Step 8: Implement the Reminder repository**

Create `src/db/repositories/reminder.ts`:

```ts
import { randomUUID } from "expo-crypto";
import { and, eq, isNotNull } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import { assertTaskEditable } from "@/db/repositories/task-access";
import type { Database } from "@/db/repositories/semester";
import { reminders, type Reminder } from "@/db/schema/reminder";
import { subjects } from "@/db/schema/subject";
import {
  cancelReminderNotification,
  requestNotificationPermission,
  scheduleReminderNotification,
} from "@/lib/notifications";
import {
  computeFireAt,
  rescheduleOnDueDateChange,
  type ReminderOffsetUnit,
  type ReminderSpec,
} from "@/domain/reminder-scheduling";

async function getTaskContext(taskId: string, database: Database) {
  const task = await assertTaskEditable(taskId, database);
  const subjectRows = await database
    .select({ name: subjects.name })
    .from(subjects)
    .where(eq(subjects.id, task.subjectId))
    .limit(1);
  return { task, subjectName: subjectRows[0]?.name ?? "" };
}

async function getReminderOrThrow(id: string, database: Database) {
  const rows = await database.select().from(reminders).where(eq(reminders.id, id)).limit(1);
  const reminder = rows[0];
  if (!reminder) throw new Error(`Reminder not found: ${id}`);
  return reminder;
}

function toReminderSpec(reminder: Reminder): ReminderSpec {
  if (reminder.kind === "fixed") {
    return { kind: "fixed", fixedDateTime: reminder.fixedDateTime as Date };
  }
  return {
    kind: "relative",
    offsetValue: reminder.offsetValue as number,
    offsetUnit: reminder.offsetUnit as ReminderOffsetUnit,
  };
}

export async function addReminder(
  taskId: string,
  spec: ReminderSpec,
  database: Database = defaultDb,
): Promise<Reminder> {
  const { task, subjectName } = await getTaskContext(taskId, database);
  const computedFireAt = computeFireAt(spec, task.dueDateTime);

  let notificationId: string | null = null;
  if (computedFireAt.getTime() > Date.now()) {
    const permission = await requestNotificationPermission();
    if (permission.granted) {
      notificationId = await scheduleReminderNotification(computedFireAt, {
        taskTitle: task.title,
        subjectName,
        dueDateTime: task.dueDateTime,
      });
    }
  }

  const newReminder: typeof reminders.$inferInsert = {
    id: randomUUID(),
    taskId,
    kind: spec.kind,
    offsetValue: spec.kind === "relative" ? spec.offsetValue : null,
    offsetUnit: spec.kind === "relative" ? spec.offsetUnit : null,
    fixedDateTime: spec.kind === "fixed" ? spec.fixedDateTime : null,
    computedFireAt,
    notificationId,
    createdAt: new Date(),
  };
  await database.insert(reminders).values(newReminder);
  return newReminder as Reminder;
}

export async function removeReminder(id: string, database: Database = defaultDb): Promise<void> {
  const reminder = await getReminderOrThrow(id, database);
  await assertTaskEditable(reminder.taskId, database);

  if (reminder.notificationId) {
    await cancelReminderNotification(reminder.notificationId);
  }
  await database.delete(reminders).where(eq(reminders.id, id));
}

/**
 * Cancels every still-pending (notificationId set) reminder's OS
 * notification for a task and clears notificationId, WITHOUT deleting the
 * rows. Used by task completion (03-business-rules.md §5) and task
 * deletion (§6) — for deletion, the rows themselves are removed a moment
 * later by ON DELETE CASCADE when the task row is deleted, so this
 * function's job there is only the OS-side cancellation.
 */
export async function cancelAllRemindersForTask(
  taskId: string,
  database: Database = defaultDb,
): Promise<void> {
  await assertTaskEditable(taskId, database);

  const pending = await database
    .select()
    .from(reminders)
    .where(and(eq(reminders.taskId, taskId), isNotNull(reminders.notificationId)));

  for (const reminder of pending) {
    await cancelReminderNotification(reminder.notificationId as string);
    await database
      .update(reminders)
      .set({ notificationId: null })
      .where(eq(reminders.id, reminder.id));
  }
}

export interface RescheduleResult {
  removedCount: number;
}

/**
 * Applies 03-business-rules.md §7's due-date-edit rule to every still-
 * pending reminder attached to a task, using the domain's pure
 * `rescheduleOnDueDateChange` for the decision logic. A "keep" action
 * always cancels the old notification and schedules a fresh one — even
 * for a fixed reminder whose fire time didn't actually change — rather
 * than diffing old vs. new fire time to skip a no-op reschedule. Simpler,
 * and the extra cancel+reschedule pair is cheap; not worth the added
 * complexity for this app's scale.
 */
export async function rescheduleRemindersForTask(
  taskId: string,
  newDueDateTime: Date,
  database: Database = defaultDb,
): Promise<RescheduleResult> {
  const { task, subjectName } = await getTaskContext(taskId, database);

  const pending = await database
    .select()
    .from(reminders)
    .where(and(eq(reminders.taskId, taskId), isNotNull(reminders.notificationId)));

  const actions = rescheduleOnDueDateChange(
    pending.map((r) => ({ id: r.id, spec: toReminderSpec(r), hasFired: false })),
    newDueDateTime,
    new Date(),
  );

  let removedCount = 0;
  for (const action of actions) {
    const reminder = pending.find((r) => r.id === action.id);
    if (!reminder) continue;

    if (action.action === "remove") {
      if (reminder.notificationId) {
        await cancelReminderNotification(reminder.notificationId);
      }
      await database.delete(reminders).where(eq(reminders.id, reminder.id));
      removedCount += 1;
      continue;
    }

    if (action.action === "keep") {
      if (reminder.notificationId) {
        await cancelReminderNotification(reminder.notificationId);
      }
      let newNotificationId: string | null = null;
      const permission = await requestNotificationPermission();
      if (permission.granted) {
        newNotificationId = await scheduleReminderNotification(action.newFireAt, {
          taskTitle: task.title,
          subjectName,
          dueDateTime: newDueDateTime,
        });
      }
      await database
        .update(reminders)
        .set({ computedFireAt: action.newFireAt, notificationId: newNotificationId })
        .where(eq(reminders.id, reminder.id));
    }
    // "unchanged" never appears here — we only ever fetch notificationId
    // IS NOT NULL rows (i.e. hasFired: false for every input), and the
    // domain function only returns "unchanged" for hasFired: true inputs.
  }

  return { removedCount };
}
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
npx jest src/db/repositories/__tests__/reminder.test.ts
```

Expected: 14 tests passed.

- [ ] **Step 10: Run the full test suite, tsc, and lint**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all exit 0. `npm test` should show 13 suites now (the existing 12 plus this phase's `reminder.test.ts`).

- [ ] **Step 11: Commit**

```bash
git add src/db/repositories/errors.ts src/db/repositories/task-access.ts src/db/repositories/task.ts src/db/repositories/subject.ts src/db/repositories/reminder.ts src/db/repositories/__tests__/reminder.test.ts
git commit -m "feat: extract shared repository modules and add Reminder repository (TDD)"
```

---

### Task 3: Extend the Task repository to orchestrate reminders (TDD)

**Files:**
- Modify: `src/db/repositories/task.ts`, `src/db/repositories/__tests__/task.test.ts`

**Interfaces:**
- Consumes: `addReminder`, `cancelAllRemindersForTask`, `rescheduleRemindersForTask` from `@/db/repositories/reminder` (Task 2); `ReminderSpec` from `@/domain/reminder-scheduling`.
- Produces: `CreateTaskInput.reminderSpecs?: ReminderSpec[]`; `UpdateTaskResult { remindersRemoved: number }` — `updateTask`'s new return type, consumed by Task 8's Editar Tarea (to show the in-app notice). `createTask`, `completeTaskAction`, `deleteTask` keep their existing call signatures — only `updateTask`'s return type changes, from `Promise<void>` to `Promise<UpdateTaskResult>`.

- [ ] **Step 1: Write the failing tests**

Modify `src/db/repositories/__tests__/task.test.ts` — add these imports alongside the existing ones at the top of the file:

```ts
import { reminders } from "@/db/schema/reminder";
import * as notifications from "@/lib/notifications";

jest.mock("@/lib/notifications");
const mockedNotifications = jest.mocked(notifications);
```

Add a `beforeEach` right after the existing `const future = ...` line (before `describe("task repository", ...)`):

```ts
let notificationCounter = 0;

beforeEach(() => {
  jest.clearAllMocks();
  notificationCounter = 0;
  mockedNotifications.requestNotificationPermission.mockResolvedValue({ granted: true });
  mockedNotifications.scheduleReminderNotification.mockImplementation(async () => {
    notificationCounter += 1;
    return `mock-notification-${notificationCounter}`;
  });
  mockedNotifications.cancelReminderNotification.mockResolvedValue(undefined);
});
```

Add these test cases inside the existing `describe("task repository", ...)` block (anywhere after the existing tests — e.g. at the end, right before the closing `});`):

```ts
  it("creates a task with reminders and schedules them", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);

    const task = await createTask(
      {
        title: "Tarea con recordatorio",
        subjectId,
        dueDateTime: future,
        priority: "Media",
        reminderSpecs: [{ kind: "relative", offsetValue: 1, offsetUnit: "days" }],
      },
      db,
    );

    const rows = await db.select().from(reminders).where(eq(reminders.taskId, task.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].notificationId).toBe("mock-notification-1");
  });

  it("creates a task with zero reminders when reminderSpecs is omitted", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);

    const task = await createTask(
      { title: "Tarea sin recordatorio", subjectId, dueDateTime: future, priority: "Media" },
      db,
    );

    const rows = await db.select().from(reminders).where(eq(reminders.taskId, task.id));
    expect(rows).toHaveLength(0);
  });

  it("completing a task cancels its pending reminders", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      {
        title: "Tarea",
        subjectId,
        dueDateTime: future,
        priority: "Media",
        reminderSpecs: [{ kind: "relative", offsetValue: 1, offsetUnit: "days" }],
      },
      db,
    );

    await completeTaskAction(task.id, db);

    expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
      "mock-notification-1",
    );
    const [reminder] = await db.select().from(reminders).where(eq(reminders.taskId, task.id));
    expect(reminder.notificationId).toBeNull();
  });

  it("deleting a task cancels its pending reminders", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      {
        title: "Tarea",
        subjectId,
        dueDateTime: future,
        priority: "Media",
        reminderSpecs: [{ kind: "relative", offsetValue: 1, offsetUnit: "days" }],
      },
      db,
    );

    await deleteTask(task.id, db);

    expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
      "mock-notification-1",
    );
  });

  it("updating a task's due date reschedules its reminders and reports how many were removed", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      {
        title: "Tarea",
        subjectId,
        dueDateTime: future,
        priority: "Media",
        reminderSpecs: [{ kind: "relative", offsetValue: 1, offsetUnit: "days" }],
      },
      db,
    );

    // New due date 30 minutes out — the "1 día antes" reminder can no
    // longer fire in the future, so it should be auto-removed.
    const soonDueDate = new Date(Date.now() + 1000 * 60 * 30);
    const result = await updateTask(task.id, { dueDateTime: soonDueDate }, db);

    expect(result.remindersRemoved).toBe(1);
    const rows = await db.select().from(reminders).where(eq(reminders.taskId, task.id));
    expect(rows).toHaveLength(0);
  });

  it("updating a task without changing its due date does not touch reminders", async () => {
    const db = freshTestDb();
    const { subjectId } = await seedActiveSemesterWithSubject(db);
    const task = await createTask(
      {
        title: "Tarea",
        subjectId,
        dueDateTime: future,
        priority: "Media",
        reminderSpecs: [{ kind: "relative", offsetValue: 1, offsetUnit: "days" }],
      },
      db,
    );
    mockedNotifications.cancelReminderNotification.mockClear();

    const result = await updateTask(task.id, { title: "Título editado" }, db);

    expect(result.remindersRemoved).toBe(0);
    expect(mockedNotifications.cancelReminderNotification).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/db/repositories/__tests__/task.test.ts
```

Expected: FAIL — `createTask`'s type doesn't accept `reminderSpecs`, and the reminder-related assertions have nothing to check against yet.

- [ ] **Step 3: Extend the Task repository**

Modify `src/db/repositories/task.ts`. Update the imports at the top (from Task 2's re-export line onward) to also pull in the reminder functions and the `ReminderSpec` type:

```ts
import { randomUUID } from "expo-crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { assertSubjectEditable, assertTaskEditable } from "@/db/repositories/task-access";
import {
  addReminder,
  cancelAllRemindersForTask,
  rescheduleRemindersForTask,
} from "@/db/repositories/reminder";
import { subtasks } from "@/db/schema/subtask";
import { tasks, type Task } from "@/db/schema/task";
import { completeTask } from "@/domain/task-completion";
import type { ReminderSpec } from "@/domain/reminder-scheduling";

export { assertTaskEditable };
```

Update `CreateTaskInput` to add the new optional field (leave every existing field as-is):

```ts
export interface CreateTaskInput {
  title: string;
  description?: string;
  subjectId: string;
  dueDateTime: Date;
  priority: "Alta" | "Media" | "Baja";
  subtaskTexts?: string[];
  /**
   * Reminders to create alongside the task. Omitted/empty means zero
   * reminders — the "1 día antes" default (03-business-rules.md §7) is a
   * UI-layer default (Nueva Tarea's initial draft state), not a
   * repository-level one, exactly mirroring how `subtaskTexts` works.
   */
  reminderSpecs?: ReminderSpec[];
}
```

Update `createTask`'s body — after the existing `database.transaction((tx) => {...})` block (the task+subtasks insert stays exactly as-is), add the reminder-creation loop before the final `return`:

```ts
  for (const spec of input.reminderSpecs ?? []) {
    await addReminder(newTask.id, spec, database);
  }

  return newTask as Task;
}
```

Add a new `UpdateTaskResult` interface right after the existing `UpdateTaskInput` interface:

```ts
export interface UpdateTaskResult {
  remindersRemoved: number;
}
```

Change `updateTask`'s return type and body:

```ts
export async function updateTask(
  id: string,
  input: UpdateTaskInput,
  database: Database = defaultDb,
): Promise<UpdateTaskResult> {
  await assertTaskEditable(id, database);

  if (input.subjectId !== undefined) {
    await assertSubjectEditable(input.subjectId, database);
  }

  await database
    .update(tasks)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(tasks.id, id));

  let remindersRemoved = 0;
  if (input.dueDateTime !== undefined) {
    const result = await rescheduleRemindersForTask(id, input.dueDateTime, database);
    remindersRemoved = result.removedCount;
  }

  return { remindersRemoved };
}
```

Update `deleteTask` to cancel reminders before the cascade-delete:

```ts
export async function deleteTask(id: string, database: Database = defaultDb): Promise<void> {
  await assertTaskEditable(id, database);

  // Cancel pending OS notifications before the cascade-delete removes the
  // reminder rows themselves — cancelAllRemindersForTask needs the rows
  // to still exist to know their notificationIds.
  await cancelAllRemindersForTask(id, database);

  // Subtasks and reminders cascade-delete automatically via ON DELETE
  // CASCADE (Phase 1 schema) now that PRAGMA foreign_keys=ON is active
  // on-device (Phase 2 Task 1) — no manual row cleanup needed here.
  await database.delete(tasks).where(eq(tasks.id, id));
}
```

Update `completeTaskAction` to cancel reminders after the completion transaction (append right before the function's closing `}`, after the existing `database.transaction((tx) => {...});` call):

```ts
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

  await cancelAllRemindersForTask(id, database);
}
```

Leave `getTask` completely unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/db/repositories/__tests__/task.test.ts
```

Expected: 17 tests passed (the existing 11 plus this task's 6 new ones).

- [ ] **Step 5: Run the full test suite, tsc, and lint**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all exit 0. `npm test` should show 13 suites, 108 tests total (12 existing suites minus the old 11-test `task.test.ts` plus the new 17-test `task.test.ts`, plus Task 2's new 14-test `reminder.test.ts`: 88 − 11 + 17 + 14 = 108 — **verify the exact number by reading the test run's own summary line, don't trust this arithmetic blindly**, since exact counts have drifted from plan-time estimates in every prior phase of this project).

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/task.ts src/db/repositories/__tests__/task.test.ts
git commit -m "feat: extend Task repository to orchestrate reminders (TDD)"
```

---

### Task 4: Cancel reminders when a subject-deletion cascade removes a task (TDD)

**Files:**
- Modify: `src/db/repositories/subject.ts`, `src/db/repositories/__tests__/subject.test.ts`

**Interfaces:**
- Consumes: `cancelAllRemindersForTask` from `@/db/repositories/reminder` (Task 2).
- Produces: nothing new consumed elsewhere — this closes a gap in `deleteSubject`'s existing cascade behavior.

**Why this task exists:** `deleteSubject` (Phase 2) cascade-deletes any of a subject's tasks that aren't `Pendiente`/`En progreso` (`checkSubjectDeletion`, Phase 1) — which includes `Vencida` tasks: overdue but **not completed**. Only completed tasks are guaranteed to have already had their reminders cancelled (via `completeTaskAction`, Task 3). A `Vencida` task can still have a live, pending reminder with a real `notificationId`. Without this task, deleting its subject would cascade-delete the reminder's database row via `ON DELETE CASCADE` while leaving the actual OS-scheduled notification alarm still registered — it would fire later, referencing a task that no longer exists anywhere in the app.

- [ ] **Step 1: Write the failing test**

Modify `src/db/repositories/__tests__/subject.test.ts` — add these imports alongside the existing ones at the top of the file:

```ts
import { reminders } from "@/db/schema/reminder";
import * as notifications from "@/lib/notifications";

jest.mock("@/lib/notifications");
const mockedNotifications = jest.mocked(notifications);
```

Add a `beforeEach` right after the existing `freshTestDb`/`seedActiveSemester` helper functions (before the first `describe`/`it` block):

```ts
beforeEach(() => {
  jest.clearAllMocks();
});
```

Add this test case inside the existing `describe("subject repository", ...)` block (anywhere after the existing tests):

```ts
  it("cancels pending reminder notifications for tasks a subject-deletion cascade removes", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Física", color: "sky", semesterId }, db);

    // Overdue but NOT completed — Vencida, per 03-business-rules.md §1 —
    // so checkSubjectDeletion allows the cascade (only Pendiente/En
    // progreso blocks it), but the task's reminder is still pending.
    await db.insert(tasks).values({
      id: "task-vencida",
      title: "Tarea vencida",
      subjectId: subject.id,
      dueDateTime: new Date(Date.now() - 1000 * 60 * 60 * 24), // yesterday
      priority: "Media",
      completed: false,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(reminders).values({
      id: "reminder-1",
      taskId: "task-vencida",
      kind: "relative",
      offsetValue: 1,
      offsetUnit: "days",
      computedFireAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
      notificationId: "mock-notification-pending",
      createdAt: new Date(),
    });

    await deleteSubject(subject.id, db);

    expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
      "mock-notification-pending",
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/db/repositories/__tests__/subject.test.ts -t "cancels pending reminder notifications"
```

Expected: FAIL — `mockedNotifications.cancelReminderNotification` was never called (the reminder row cascade-deletes silently, no cancellation attempted).

- [ ] **Step 3: Extend `deleteSubject`**

Modify `src/db/repositories/subject.ts`. Add an import alongside the existing ones:

```ts
import { cancelAllRemindersForTask } from "@/db/repositories/reminder";
```

Modify `deleteSubject`'s body — insert a cancellation loop between the existing `checkSubjectDeletion` block and the final `database.delete(subjects)...` call:

```ts
export async function deleteSubject(id: string, database: Database = defaultDb): Promise<void> {
  const rows = await database
    .select({ semesterId: subjects.semesterId })
    .from(subjects)
    .where(eq(subjects.id, id))
    .limit(1);
  const subject = rows[0];
  if (!subject) throw new Error(`Subject not found: ${id}`);

  await assertSemesterEditable(subject.semesterId, database);

  const taskStatuses = await getTaskStatusesForSubject(id, database);
  const check = checkSubjectDeletion(taskStatuses);
  if (!check.allowed) {
    throw new SubjectDeletionBlockedError(check.blockingTaskCount);
  }

  // Cancel pending OS notifications for every task this deletion cascades
  // away, BEFORE the cascade-delete removes their reminder rows. A task
  // here can be Vencida (overdue but incomplete), which can still have a
  // live pending reminder — only Completada tasks are guaranteed to have
  // already had theirs cancelled, via completeTaskAction (Task 3).
  for (const taskId of check.cascadeDeleteTaskIds ?? []) {
    await cancelAllRemindersForTask(taskId, database);
  }

  // Subjects, their remaining (non-blocking) tasks, and those tasks'
  // subtasks/reminders/attachments cascade-delete automatically via ON
  // DELETE CASCADE (Phase 1) now that PRAGMA foreign_keys=ON is active
  // (Phase 2 Task 1) — no manual row cleanup needed here.
  await database.delete(subjects).where(eq(subjects.id, id));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/db/repositories/__tests__/subject.test.ts
```

Expected: the whole `subject.test.ts` suite passes, including the new test (existing tests unaffected — `cancelAllRemindersForTask` is a no-op loop over an empty array for every scenario without a `Vencida`/pending-reminder task, so nothing else in this file's behavior changes).

- [ ] **Step 5: Run the full test suite, tsc, and lint**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/subject.ts src/db/repositories/__tests__/subject.test.ts
git commit -m "fix: cancel pending reminders when subject deletion cascades away a task (TDD)"
```

---

### Task 5: ReminderPicker component

**Files:**
- Create: `src/components/ReminderPicker.tsx`

**Interfaces:**
- Consumes: `colors` from `@/theme`; `ReminderSpec`, `ReminderOffsetUnit` from `@/domain/reminder-scheduling`.
- Produces: `ReminderPicker` component and `formatReminderSpec(spec: ReminderSpec): string` — both imported by Tasks 5 and 6.

- [ ] **Step 1: Create the component**

Create `src/components/ReminderPicker.tsx`:

```tsx
import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { colors } from "@/theme";
import type { ReminderOffsetUnit, ReminderSpec } from "@/domain/reminder-scheduling";

const OFFSET_UNITS: ReminderOffsetUnit[] = ["minutes", "hours", "days"];

const OFFSET_UNIT_LABELS: Record<ReminderOffsetUnit, { singular: string; plural: string }> = {
  minutes: { singular: "minuto", plural: "minutos" },
  hours: { singular: "hora", plural: "horas" },
  days: { singular: "día", plural: "días" },
};

/**
 * Human-readable Spanish label for a reminder spec, shared by every
 * screen that lists reminders (draft or persisted).
 */
export function formatReminderSpec(spec: ReminderSpec): string {
  if (spec.kind === "fixed") {
    return spec.fixedDateTime.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
  }
  const label = OFFSET_UNIT_LABELS[spec.offsetUnit];
  const unitText = spec.offsetValue === 1 ? label.singular : label.plural;
  return `${spec.offsetValue} ${unitText} antes`;
}

export interface ReminderPickerProps {
  onAdd: (spec: ReminderSpec) => void;
}

export function ReminderPicker({ onAdd }: ReminderPickerProps) {
  const [kind, setKind] = useState<"relative" | "fixed">("relative");
  const [offsetValueText, setOffsetValueText] = useState("1");
  const [offsetUnit, setOffsetUnit] = useState<ReminderOffsetUnit>("days");
  const [fixedDateTime, setFixedDateTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  function handleAdd() {
    if (kind === "relative") {
      const offsetValue = parseInt(offsetValueText, 10);
      if (!Number.isFinite(offsetValue) || offsetValue <= 0) return;
      onAdd({ kind: "relative", offsetValue, offsetUnit });
      setOffsetValueText("1");
    } else {
      onAdd({ kind: "fixed", fixedDateTime: new Date(fixedDateTime) });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.kindRow}>
        <TouchableOpacity
          style={[styles.kindChip, kind === "relative" && styles.kindChipSelected]}
          onPress={() => setKind("relative")}
        >
          <Text style={[styles.kindChipText, kind === "relative" && styles.kindChipTextSelected]}>
            Relativo
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.kindChip, kind === "fixed" && styles.kindChipSelected]}
          onPress={() => setKind("fixed")}
        >
          <Text style={[styles.kindChipText, kind === "fixed" && styles.kindChipTextSelected]}>
            Fecha fija
          </Text>
        </TouchableOpacity>
      </View>

      {kind === "relative" ? (
        <View style={styles.relativeRow}>
          <TextInput
            style={styles.offsetInput}
            value={offsetValueText}
            onChangeText={setOffsetValueText}
            keyboardType="number-pad"
          />
          <View style={styles.unitRow}>
            {OFFSET_UNITS.map((unit) => (
              <TouchableOpacity
                key={unit}
                style={[styles.unitChip, offsetUnit === unit && styles.unitChipSelected]}
                onPress={() => setOffsetUnit(unit)}
              >
                <Text
                  style={[
                    styles.unitChipText,
                    offsetUnit === unit && styles.unitChipTextSelected,
                  ]}
                >
                  {OFFSET_UNIT_LABELS[unit].plural}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.fixedRow}>
          <TouchableOpacity style={styles.fixedButton} onPress={() => setShowDatePicker(true)}>
            <Text>
              {fixedDateTime.toLocaleDateString("es", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fixedButton} onPress={() => setShowTimePicker(true)}>
            <Text>
              {fixedDateTime.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={fixedDateTime}
              mode="date"
              display="default"
              onChange={(_event, selectedDate) => {
                setShowDatePicker(false);
                if (selectedDate) {
                  const merged = new Date(fixedDateTime);
                  merged.setFullYear(
                    selectedDate.getFullYear(),
                    selectedDate.getMonth(),
                    selectedDate.getDate(),
                  );
                  setFixedDateTime(merged);
                }
              }}
            />
          )}
          {showTimePicker && (
            <DateTimePicker
              value={fixedDateTime}
              mode="time"
              display="default"
              onChange={(_event, selectedTime) => {
                setShowTimePicker(false);
                if (selectedTime) {
                  const merged = new Date(fixedDateTime);
                  merged.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
                  setFixedDateTime(merged);
                }
              }}
            />
          )}
        </View>
      )}

      <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
        <Text style={styles.addButtonText}>Añadir recordatorio</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10, paddingVertical: 8 },
  kindRow: { flexDirection: "row", gap: 8 },
  kindChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    opacity: 0.55,
  },
  kindChipSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primaryTint,
    opacity: 1,
  },
  kindChipText: { fontSize: 13, color: colors.textMuted },
  kindChipTextSelected: { color: colors.primary, fontWeight: "600" },
  relativeRow: { gap: 8 },
  offsetInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: 80,
  },
  unitRow: { flexDirection: "row", gap: 8 },
  unitChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  unitChipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  unitChipText: { fontSize: 12, color: colors.textMuted },
  unitChipTextSelected: { color: colors.primary, fontWeight: "600" },
  fixedRow: { flexDirection: "row", gap: 8 },
  fixedButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  addButtonText: { color: colors.primary, fontWeight: "600" },
});
```

- [ ] **Step 2: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ReminderPicker.tsx
git commit -m "feat: add ReminderPicker component"
```

---

### Task 6: Wire draft reminders into Nueva Tarea

**Files:**
- Modify: `app/tarea/nueva.tsx`

**Interfaces:**
- Consumes: `ReminderPicker`, `formatReminderSpec` from `@/components/ReminderPicker` (Task 5); `defaultReminder`, `ReminderSpec` from `@/domain/reminder-scheduling`; `createTask`'s extended `reminderSpecs` input (Task 3).
- Produces: nothing new consumed elsewhere — Nueva Tarea's draft-reminder state is local to this screen, exactly like its existing draft-subtask state.

- [ ] **Step 1: Add reminder drafting to the screen**

Modify `app/tarea/nueva.tsx`. Add two imports (alongside the existing ones):

```ts
import { ReminderPicker, formatReminderSpec } from "@/components/ReminderPicker";
import { defaultReminder, type ReminderSpec } from "@/domain/reminder-scheduling";
```

Add reminder draft state right after the existing `subtaskTexts`/`newSubtaskText` state declarations:

```ts
  const [reminderSpecs, setReminderSpecs] = useState<ReminderSpec[]>([defaultReminder()]);
```

Add two handler functions right after `handleRemoveSubtaskDraft`:

```ts
  function handleAddReminderDraft(spec: ReminderSpec) {
    setReminderSpecs((current) => [...current, spec]);
  }

  function handleRemoveReminderDraft(index: number) {
    setReminderSpecs((current) => current.filter((_, i) => i !== index));
  }
```

In `handleSubmit`, add `reminderSpecs` to the `createTask` call:

```ts
      await createTask({
        title: values.title,
        description: values.description || undefined,
        subjectId: values.subjectId,
        dueDateTime: combineDateAndTime(values.dueDate, values.dueTime),
        priority: values.priority,
        subtaskTexts,
        reminderSpecs,
      });
```

In the `footer` prop passed to `<TaskForm>`, add a reminders section as a sibling to the existing `styles.subtasksSection` block (both live inside the same `footer` `ReactNode` — wrap them together):

```tsx
        footer={
          <>
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

            <View style={styles.subtasksSection}>
              <Text style={styles.subtasksTitle}>Recordatorios</Text>
              {reminderSpecs.map((spec, index) => (
                <View key={`${JSON.stringify(spec)}-${index}`} style={styles.subtaskRow}>
                  <Text style={styles.subtaskText}>{formatReminderSpec(spec)}</Text>
                  <TouchableOpacity onPress={() => handleRemoveReminderDraft(index)}>
                    <Text style={styles.subtaskRemove}>Quitar</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <ReminderPicker onAdd={handleAddReminderDraft} />
            </View>
          </>
        }
```

Note: `styles.subtasksSection`/`subtasksTitle`/`subtaskRow`/`subtaskText`/`subtaskRemove` are reused as-is from the existing stylesheet (already generic enough for a list-of-items-with-a-remove-button — no new styles needed).

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

Expected walkthrough: open Nueva Tarea, confirm the "Recordatorios" section shows one pre-populated "1 día antes" reminder; remove it and confirm the list goes empty; add a relative reminder (e.g. "2 horas antes") via the picker and confirm it appears formatted correctly; switch the picker to "Fecha fija", pick a date/time, add it, confirm it displays as a formatted date/time; submit the task and confirm no crash. Pull and read actual screenshots at each step.

- [ ] **Step 4: Commit**

```bash
git add app/tarea/nueva.tsx
git commit -m "feat: wire draft reminders into Nueva Tarea"
```

---

### Task 7: Wire reminders into the Task detail screen

**Files:**
- Modify: `app/tarea/[id]/index.tsx`

**Interfaces:**
- Consumes: `ReminderPicker`, `formatReminderSpec` from `@/components/ReminderPicker` (Task 5); `addReminder`, `removeReminder` from `@/db/repositories/reminder` (Task 2); `ReminderSpec` from `@/domain/reminder-scheduling`; `reminders` schema from `@/db/schema/reminder`.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add the reminders section**

Modify `app/tarea/[id]/index.tsx`. Add imports:

```ts
import { ReminderPicker, formatReminderSpec } from "@/components/ReminderPicker";
import { addReminder, removeReminder } from "@/db/repositories/reminder";
import { reminders } from "@/db/schema/reminder";
import type { ReminderSpec } from "@/domain/reminder-scheduling";
```

Add a `useLiveQuery` for the task's reminders, right after the existing `taskSubtasks` derivation:

```ts
  const { data: reminderRows } = useLiveQuery(
    db.select().from(reminders).where(eq(reminders.taskId, id)),
  );
  const taskReminders = reminderRows ?? [];
```

Add two handlers, near the other `handle*` functions (e.g. right after `handleRemoveSubtask`):

```ts
  async function handleAddReminder(spec: ReminderSpec) {
    setBusy(true);
    try {
      await addReminder(id, spec);
    } catch (error) {
      handleActionError(error, "No se pudo añadir el recordatorio.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveReminder(reminderId: string) {
    setBusy(true);
    try {
      await removeReminder(reminderId);
    } catch (error) {
      handleActionError(error, "No se pudo eliminar el recordatorio.");
    } finally {
      setBusy(false);
    }
  }
```

Add a reminders section to the JSX, right after the existing subtask-input row (`</View>` that closes `styles.subtaskInputRow`) and before the `<View style={styles.actions}>` block:

```tsx
      <Text style={styles.sectionTitle}>Recordatorios</Text>
      {taskReminders.map((reminder) => (
        <View key={reminder.id} style={styles.subtaskRow}>
          <Text style={styles.subtaskText}>
            {formatReminderSpec(
              reminder.kind === "fixed"
                ? { kind: "fixed", fixedDateTime: reminder.fixedDateTime as Date }
                : {
                    kind: "relative",
                    offsetValue: reminder.offsetValue as number,
                    offsetUnit: reminder.offsetUnit as "minutes" | "hours" | "days",
                  },
            )}
            {reminder.notificationId === null ? " (no programado)" : ""}
          </Text>
          <TouchableOpacity disabled={busy} onPress={() => handleRemoveReminder(reminder.id)}>
            <Text style={styles.subtaskRemove}>Quitar</Text>
          </TouchableOpacity>
        </View>
      ))}
      <ReminderPicker onAdd={handleAddReminder} />
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

Expected walkthrough: open a task's detail screen, confirm the "Recordatorios" section renders (empty if the task has none, or its existing reminders if created with a default via Nueva Tarea); add a reminder via the picker, confirm it appears in the list live; remove it, confirm it disappears; if permission was ever denied during testing, confirm a reminder with `notificationId: null` shows the "(no programado)" suffix. Pull and read actual screenshots.

- [ ] **Step 4: Commit**

```bash
git add "app/tarea/[id]/index.tsx"
git commit -m "feat: wire reminders into Task detail screen"
```

---

### Task 8: Surface the reschedule notice in Editar Tarea

**Files:**
- Modify: `app/tarea/[id]/editar.tsx`

**Interfaces:**
- Consumes: `updateTask`'s new `UpdateTaskResult` return value (Task 3).
- Produces: nothing consumed elsewhere — this is the final screen-wiring task.

- [ ] **Step 1: Show the notice when reminders were auto-removed**

Modify `app/tarea/[id]/editar.tsx`'s `handleSubmit`:

```ts
  async function handleSubmit(values: TaskFormValues) {
    try {
      const result = await updateTask(id, {
        title: values.title,
        description: values.description || null,
        subjectId: values.subjectId,
        dueDateTime: combineDateAndTime(values.dueDate, values.dueTime),
        priority: values.priority,
      });
      if (result.remindersRemoved > 0) {
        Alert.alert(
          "Recordatorios actualizados",
          `${result.remindersRemoved} recordatorio(s) se eliminaron porque ya no tienen sentido con la nueva fecha límite.`,
          [{ text: "OK", onPress: () => router.back() }],
        );
      } else {
        router.back();
      }
    } catch (error) {
      if (error instanceof SemesterReadOnlyError) {
        Alert.alert("Semestre cerrado", "Este semestre está cerrado y no se puede editar.");
      } else {
        Alert.alert("Error", "No se pudo guardar los cambios.");
      }
    }
  }
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

Expected walkthrough: create a task with a "1 día antes" reminder due a week out; edit the due date to 30 minutes from now; confirm the "Recordatorios actualizados" alert appears with a count of 1, and tapping OK returns to the detail screen where the reminders section is now empty. Edit a different task's due date to another future date far enough out that the reminder stays valid; confirm no alert appears and the screen returns immediately.

- [ ] **Step 4: Commit**

```bash
git add "app/tarea/[id]/editar.tsx"
git commit -m "feat: surface reminder-reschedule notice in Editar Tarea"
```

---

### Task 9: Phase 4 Definition-of-Done verification

**Files:** none (verification-only task).

- [ ] **Step 1: Run the full combined check for the whole phase**

```bash
npm test
npx tsc --noEmit
npm run lint
npx prettier --check .
```

Expected: all exit 0. Read `npm test`'s own summary line for the exact final suite/test counts (do not trust any number estimated earlier in this plan).

- [ ] **Step 2: On-device acceptance walkthrough — the full phase, one continuous session**

```bash
npx expo run:android
```

Manually walk through, on the emulator, in one continuous session:

1. Create a task from Nueva Tarea with the default "1 día antes" reminder left in place. Confirm it appears in the Task detail screen's Recordatorios section after creation.
2. Grant (or confirm already-granted) the notification permission when first prompted — confirm the prompt appears at this point (first reminder-creating action), not on app launch.
3. From the Task detail screen, add a second reminder due 2-3 minutes from now (relative offset in minutes, computed against the task's actual due date, or a fixed datetime picked directly). **Wait for it to actually fire** — confirm a real Android notification appears in the notification tray/status bar within a reasonable margin of the scheduled time (this is the one thing Jest cannot verify — do not skip this step or substitute a shorter check).
4. Edit that same task's due date to move it further out; confirm existing valid reminders survive (their fire times update, no removal notice).
5. Edit the due date again to something that invalidates the "1 día antes" reminder (a date very soon); confirm the "Recordatorios actualizados" notice appears with the correct count and the reminder is gone from the detail screen afterward.
6. Complete the task (either quick-complete from the Tareas list or the detail screen's button); confirm no notification arrives later for any reminder that was still pending at completion time (if a reminder was scheduled a few minutes out and the task is completed before it fires, the notification must not appear).
7. Create a second task with a reminder, then delete the task; confirm the same — no notification arrives after deletion.
8. Optional but recommended if time allows: `adb shell dumpsys alarm | grep -i unitask` (or `adb shell dumpsys notification`) after scheduling a reminder, to directly confirm the OS registered the alarm, as a faster sanity check than waiting for every scheduled notification to fire in real time.

- [ ] **Step 3: No commit for this task** (verification-only; if any bug is found, fix it as a new commit and re-run Step 1 and the relevant part of Step 2 before considering the phase closed).

---

## Phase 4 — Definition of Done

All nine tasks above complete, in order, means:

- Every task can have reminders added, edited (via replace: remove + add), and removed, both at creation (Nueva Tarea) and after (Task detail) — Tasks 2, 3, 6, 7.
- Completing or deleting a task, or a subject-deletion cascade removing a task, cancels all of that task's pending OS notifications, verified both by repository tests (mocked) and the on-device walkthrough (real notifications genuinely not arriving) — Tasks 3, 4, 9.
- Editing a task's due date reschedules or auto-removes every still-pending reminder per `03-business-rules.md` §7 exactly, with the required in-app notice on removal — Tasks 3, 8, verified on-device in Task 9.
- The `POST_NOTIFICATIONS` permission is requested lazily (first reminder-creating action), never on app launch — Task 1's wrapper design, verified on-device in Task 9.
- A denied permission still saves the reminder record (with `notificationId: null`) rather than silently discarding it, and the UI does not claim it's active — Tasks 2, 7.
- `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npx prettier --check .` all exit 0 against the final tree.
- A real Android notification was observed firing on-device for at least one scheduled reminder (the one thing this phase's automated tests structurally cannot verify).

This unblocks Phase 5 (Attachments), which will be written as its own separate implementation plan once Phase 4 is executed and reviewed.
