# 11 — Roadmap

Phased implementation plan. Each phase lists its objective, included features, key files/modules, dependencies on prior phases, acceptance criteria, and test expectations (per `10-testing-strategy.md`'s Strict TDD workflow: failing test → implement → pass, before the phase is considered done).

No phase in this roadmap has been executed yet — this discovery phase produced documentation only, no code (see root `README.md`).

---

## Phase 0 — Project scaffolding

**Objective**: stand up the Expo/TypeScript project skeleton and base tooling, with no feature code yet.

**Features included**: Expo project init (managed workflow), TypeScript configuration, Expo Router base setup, folder structure from `07-architecture.md`, Drizzle + `expo-sqlite` wiring (empty schema), lint/format config, Jest configuration.

**Key files/modules**: `app/` root layout, `src/db/` (empty schema scaffold), `drizzle.config.ts`, `tsconfig.json`, Jest config (lives in `package.json`'s `"jest"` key per Expo's documented setup, not a separate `jest.config.js` file).

**Dependencies**: none (first phase).

**Acceptance criteria**: app boots to a blank screen on an Android emulator/device; `drizzle-kit` can generate an (empty) migration; `jest` runs with zero test files and exits cleanly.

**Test expectations**: no domain tests yet (nothing to test); a single smoke test verifying the Jest/TS toolchain runs is acceptable.

---

## Phase 1 — Data layer

**Objective**: define the complete Drizzle schema and pure business-logic functions that don't yet need UI.

**Features included**: full Drizzle schema for all 7 entities (Semester, Subject, Task, Subtask, Reminder, Attachment, Settings) per `06-data-model.md`; initial migration; pure business-logic functions in `src/domain` for status derivation, progress calculation, completion logic (incl. `completedLate`), reminder-scheduling math, semester-lifecycle rules, and subject-deletion blocking rule — all per `03-business-rules.md`.

**Key files/modules**: `src/db/schema/*.ts`, `src/db/migrations/`, `src/domain/task-status.ts`, `src/domain/task-progress.ts`, `src/domain/task-completion.ts`, `src/domain/reminder-scheduling.ts`, `src/domain/semester-lifecycle.ts`, `src/domain/subject-deletion.ts`.

**Dependencies**: Phase 0.

**Carried over from Phase 0** (deferred there deliberately, must be picked up here — see `docs/superpowers/plans/2026-08-10-phase0-scaffolding.md` Task 5 for the full reasoning):
- `src/db/client.ts` currently calls `drizzle(sqlite)` with no schema — re-add `import * as schema from "./schema"; ... drizzle(sqlite, { schema })` once `src/db/schema/index.ts` actually re-exports real tables (an empty-namespace import was previously tripping ESLint's `import/namespace` rule).

**Note on migration verification**: this phase's "migration applies cleanly to a fresh SQLite DB" criterion is satisfied via a Node-side integration test (`drizzle-orm/better-sqlite3` applying the generated `.sql` against an in-memory DB — no Expo/RN runtime needed for this check). **On-device** migration execution (the app actually opening and migrating a real device database) is intentionally NOT part of this phase — see Phase 2's own "Carried over" note below for why and when that gets wired.

**Acceptance criteria**: schema matches `06-data-model.md` field-for-field; migration applies cleanly to a fresh SQLite DB; every rule in `03-business-rules.md` §1–§4, §7, §10, §12 has a corresponding pure function with passing unit tests.

**Test expectations**: heaviest unit-test phase per `10-testing-strategy.md` — every branch of every rule listed above gets a test written first (red), then implemented (green). No repository/UI code yet.

---

## Phase 2 — Semester + Subject CRUD

**Objective**: first user-facing vertical slice — semester bootstrap and subject management, including the read-only-when-closed enforcement.

**Features included**: first-run "create your first semester" screen/prompt (`04-user-flows.md` flow 1); Semester create/close (auto-close-previous rule, §10); Subject CRUD (create/edit/delete, blocked-by-pending-tasks rule §12 — though Task doesn't exist yet, so this rule's "has pending tasks" branch is effectively always false until Phase 3, and should be tested as such); Semester switcher/history screen; enforcement of the closed-semester read-only cascade for Subject.

**Key files/modules**: `app/onboarding/primer-semestre.tsx`, `app/semestres/index.tsx`, `app/materia/nueva.tsx`, `app/materia/[id]/index.tsx`, `app/materia/[id]/editar.tsx`, `src/db/repositories/semester.ts`, `src/db/repositories/subject.ts`.

**Dependencies**: Phase 1.

**Carried over from Phase 0** (this is the first phase that actually opens a real on-device database, so this is where the deferred wiring belongs — see `docs/superpowers/plans/2026-08-10-phase0-scaffolding.md` Task 5's correction note): on-device migration bundling was never wired in Phase 0 or Phase 1. `babel.config.js` (create via `npx expo customize babel.config.js`, never hand-written — see Phase 0 Task 1's note on why a hand-written one breaks this Expo SDK's build) needs the `inline-import` plugin for `.sql` files, and `metro.config.js` (doesn't exist yet either) needs `config.resolver.sourceExts.push('sql')`, before `drizzle-orm/expo-sqlite/migrator`'s `useMigrations` hook can run the generated migration bundle on-device. This phase's first-run bootstrap flow is the first real reason the app needs to open+migrate an actual device database, so this wiring is this phase's first task, not a standalone concern bolted on later.

**Acceptance criteria**: first launch forces semester creation before any subject can be created; creating a second semester auto-closes the first; closing a semester makes its subjects read-only (create/edit/delete disabled); subject color picker only offers the fixed palette (`03-business-rules.md` §8).

**Test expectations**: repository integration tests (in-memory SQLite) for semester/subject CRUD and cascade/read-only behavior; component tests for the first-run prompt and read-only affordance disabling; unit tests from Phase 1 remain green.

---

## Phase 3 — Task + Subtask CRUD

**Objective**: core task management with derived status/progress.

**Features included**: Nueva/Editar Tarea form (title, description, subject, due date/time, priority, subtasks — reminders/attachments come in later phases as optional-but-present fields, or stubbed until Phase 4/5); task list with derived filter chips (Todas/Pendientes/En progreso/Completadas/Vencidas); task detail screen; quick-complete checkbox in the list and "Marcar como completada" in detail (§5); subtask add/edit/reorder/remove; closed-semester read-only enforcement extended to Task/Subtask.

**Key files/modules**: `app/tarea/nueva.tsx`, `app/tarea/[id]/index.tsx`, `app/tarea/[id]/editar.tsx`, `app/(tabs)/tareas/index.tsx`, `src/db/repositories/task.ts`, `src/db/repositories/subtask.ts`, `src/features/tasks/`.

**Dependencies**: Phase 1 (domain functions), Phase 2 (Subject must exist to assign a task to).

**Acceptance criteria**: task status/progress always match `03-business-rules.md` §1–§3 for every combination exercised in tests; completing a task via either entry point auto-checks all subtasks and stamps `completedLate` correctly; editing/deleting a task under a closed semester is disabled.

**Test expectations**: component tests for the filter chips against fixture tasks in each status; repository integration tests for task/subtask CRUD and cascade delete; Phase 1 unit tests remain the source of truth for the underlying formulas and stay green.

---

## Phase 4 — Reminders + local notifications

**Objective**: per-task reminder configuration wired to real Android local notifications.

**Features included**: Reminder picker component (relative offset / custom fixed datetime), integrated into Nueva/Editar Tarea and Detalle de Tarea; default-reminder-on-create behavior (§7); `expo-notifications` wrapper module; lazy `POST_NOTIFICATIONS` permission request flow (`08-notifications.md`); schedule/cancel/reschedule wiring for every trigger in the `08-notifications.md` table; verification of exact-alarm requirements and boot-time persistence behavior against the current Expo SDK docs.

**Key files/modules**: `src/components/ReminderPicker/`, `src/lib/notifications/`, `src/domain/reminder-scheduling.ts` (extended from Phase 1), `src/db/repositories/reminder.ts`.

**Dependencies**: Phase 1 (reminder-scheduling math), Phase 3 (Task must exist).

**Acceptance criteria**: new tasks get a default "1 día antes" reminder unless removed; editing a due date reschedules/removes reminders per §7; completing/deleting a task cancels all pending notifications; permission prompt appears only at first reminder-creating action, not on app launch.

**Test expectations**: unit tests (from Phase 1, extended) for every reschedule branch; component tests for the Reminder picker; a manual/device-level verification checklist for actual OS notification delivery (not something Jest can assert), documented as part of this phase's sign-off.

---

## Phase 5 — Attachments

**Objective**: file attach/view/cleanup flow.

**Features included**: attach flow (pick → validate type/size → copy to sandbox → store record) per `09-file-management.md`; attachment list on task detail; open-with view flow via `expo-sharing`; cleanup-on-task-delete.

**Key files/modules**: `src/lib/files/`, `src/db/repositories/attachment.ts`, attachment list component within `src/features/tasks/`.

**Dependencies**: Phase 3 (Task must exist).

**Acceptance criteria**: files over 25 MB or of a disallowed type are rejected before copy; accepted files are copied into app-private storage and reopenable via "open with"; deleting a task removes its attachment files with zero orphans.

**Test expectations**: unit tests for the type/size validation function; repository integration tests for attachment record CRUD and cascade cleanup; a manual/device-level check for the actual "open with" OS interaction.

---

## Phase 6 — Dashboard

**Objective**: the Home tab's summary widgets.

**Features included**: greeting header, stat tiles (Pendientes/Hoy/Completadas últimos 7 días), "Tareas urgentes" list, "Próximas entregas" list — all per the exact criteria in `03-business-rules.md` §15.

**Key files/modules**: `app/(tabs)/index.tsx`, `src/features/dashboard/`, dashboard-specific query/selector functions built on the Phase 1 domain functions.

**Dependencies**: Phase 3 (tasks must exist to summarize), Phase 4 (not strictly required for widget logic, but realistic dashboard testing benefits from reminders existing).

**Acceptance criteria**: each widget matches its §15 formula exactly, including the rolling-7-day (not calendar-week) window for completions and the union (not intersection) logic for urgent tasks.

**Test expectations**: unit tests for each widget's selector/query function against fixture task sets covering edge cases (e.g. a task exactly 48h out, a low-priority task due tomorrow, completions exactly 7 days old).

---

## Phase 7 — Calendar (month view)

**Objective**: the Calendario tab.

**Features included**: month grid, priority-colored dot indicators per day (`03-business-rules.md` §16), inline day panel on day selection listing that day's tasks, contextual "Añadir tarea" pre-filling the selected date.

**Key files/modules**: `app/(tabs)/calendario/index.tsx`, `src/features/calendar/`.

**Dependencies**: Phase 3 (tasks), Phase 6 not required but shares selector patterns.

**Acceptance criteria**: only month view ships (no week/day toggle — explicitly deferred, see below); day dots reflect priority color; selecting a day never navigates away from Calendario.

**Test expectations**: unit tests for the day → tasks-with-dots grouping function; component tests for the inline day panel rendering and the pre-filled FAB behavior.

---

## Phase 8 — Progress screen

**Objective**: the Progreso tab's statistics.

**Features included**: completion-rate and related statistics derived from stored task/subtask data (read-only screen, no CRUD).

**Key files/modules**: `app/(tabs)/progreso/index.tsx`, `src/features/progress/`.

**Dependencies**: Phase 3 (tasks/subtasks), Phase 1 (`completedLate` data available for a future on-time-rate stat, even if not surfaced yet).

**Acceptance criteria**: statistics are computed from live SQLite data via `useLiveQuery` (no separate Zustand copy, per `07-architecture.md` Rule 1/2); screen has no create/edit/delete affordances.

**Test expectations**: unit tests for each statistic's computation function against fixture data.

---

## Phase 9 — Settings + JSON export/import

**Objective**: minimal Settings screen and the manual backup safety net.

**Features included**: Settings screen (gear icon target) with "Exportar datos" and "Importar datos" only (no theme section, no notification section, per `01-product.md`/`03-business-rules.md`); export flow (serialize → `expo-sharing`); import flow (pick → validate → overwrite-confirmation dialog → full replace) per `03-business-rules.md` §14 and `04-user-flows.md` flows 6–7.

**Key files/modules**: `app/configuracion/index.tsx`, `src/features/settings/`, export/import serialization functions in `src/domain` or `src/db`.

**Dependencies**: Phases 1–5 (all entities must exist to be exportable/importable).

**Acceptance criteria**: export produces a single JSON file containing all entities; import requires explicit confirmation and fully replaces local data (no partial merge); imported reminders are freshly rescheduled since old notification ids are invalid after a full replace.

**Test expectations**: unit tests for the serialize/deserialize functions (round-trip fidelity); an integration test that imports a fixture export and verifies the resulting DB state fully replaces prior fixture data.

---

## Phase 10 — Empty states, confirmations, accessibility, theming cleanup

**Objective**: polish pass across the whole app, closing out MVP scope.

**Features included**: empty-state UI for every list/screen (no subjects yet, no tasks yet, etc.); destructive-action confirmation dialogs standardized across delete task/subject/subtask, close semester, and import-overwrite (`03-business-rules.md` §13); accessibility pass (48px touch targets, Android font-scaling support, priority shown with icon+label not color alone); audit of `src/theme` token usage to ensure no hardcoded hex values remain in component code, so a future dark theme is a token-file change only.

**Key files/modules**: cuts across `src/components`, `src/features/**`, `src/theme/`.

**Dependencies**: all prior phases (this is a cross-cutting pass over everything built so far).

**Acceptance criteria**: every destructive action listed in `03-business-rules.md` §13 shows a confirmation dialog; no screen shows a broken/blank state with zero data; a manual accessibility pass (font scaling at 200%, screen-reader spot check) is completed; a grep-style audit confirms no raw hex colors in `src/features`/`src/components` outside `src/theme` itself.

**Test expectations**: component tests for empty states and confirmation-dialog trigger/cancel/confirm paths; no new domain logic in this phase, so no new pure-function unit tests are expected beyond regression coverage of existing ones.

---

## Fast-follow candidates (explicitly post-MVP)

Not part of Phases 0–10 above; noted here so they aren't lost, but they are out of scope for this roadmap:

- **Calendar week/day views** (toggle deferred from Phase 7, per `01-product.md`).
- **iOS support** (full platform addition — would also require revisiting the 64-pending-notification-limit handling explicitly skipped in `08-notifications.md`).
- **Dark mode UI** (the token groundwork from Phase 10 makes this cheap, but the actual dark palette + Settings toggle is not built in MVP).
- **Cloud accounts / multi-device sync** (`01-product.md` growth path, `07-architecture.md` "Growth path" section).
- **Merge import** (as opposed to v1's full-replace-only import, `03-business-rules.md` §14).
- **Bundling attachment file bytes into JSON export** (v1 exports metadata only, `09-file-management.md`).
- **Notification digest / global notification toggle in Settings** (explicitly dropped for v1, `01-product.md`).
- **On-time completion rate statistic** on the Progress screen, powered by the `completedLate` flag already tracked since Phase 1 but not surfaced in MVP UI.
