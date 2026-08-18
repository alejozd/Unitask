# Phase 9 — Settings + JSON export/import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan has NOT been approved for execution.** It was written per an explicit "write the plan, do not run it" instruction (2026-08-17). Do not dispatch Task 1 until a human explicitly approves execution, the same gate every prior phase in this project has gone through.

**Goal:** Extend `app/configuracion/index.tsx` (Phase 6.6's minimal profile screen — same file, not a new screen, per `11-roadmap.md`'s explicit note) with "Exportar datos" and "Importar datos" actions, per `01-product.md`/`03-business-rules.md` §14 and `04-user-flows.md` flows 6–7: export serializes all local data to a single JSON file and opens the share sheet; import picks a previously exported file, validates it, shows an explicit irreversible-replace warning, and on confirm fully replaces local data — no merge.

**Architecture:** A pure `src/domain/backup.ts` module handles JSON shape/version validation and has zero DB/query code, matching every prior phase's domain/UI split. A `src/db/repositories/backup.ts` module does the actual reads (export) and the destructive delete-all + insert-all (import) inside one synchronous `database.transaction(...)` (the same pattern `semester.ts`'s `createSemester` already established for a multi-table write), plus the OS-notification cancel/reschedule side effects that must run outside that transaction. The screen (`app/configuracion/index.tsx`) calls the repository functions and renders two buttons plus the mandatory confirmation dialog for import.

**Tech Stack:** `expo-document-picker` (already installed, Phase 5), `expo-file-system`'s `File`/`Paths` (already installed, Phase 5 — this plan's export path is the first use of `File.write`, verified against the [SDK 57 FileSystem docs](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/): `new File(dir, name).create()` then `.write(content)`), `expo-sharing` (already installed, Phase 5), Drizzle ORM (existing `db.transaction` pattern), Jest (TDD for the domain layer) — **no new packages, no native rebuild**.

## Global Constraints

- **No new dependencies.** Every native module this phase needs (document picker, file system, sharing) is already installed and configured from Phase 5 — no new `app.json` plugin entries, no `npx expo run:android` rebuild required.
- **Single supported backup version, no migration logic.** `BACKUP_VERSION = 1`. A file with a missing or different `version` field is rejected outright with a distinct "unsupported version" reason — there is exactly one version to migrate *to* since this is the first export format this app has ever shipped, so a migration path is speculative until a second version actually exists (YAGNI).
- **Full replace only, no merge** — `11-roadmap.md`'s explicit v1 scope; `03-business-rules.md` §14 and `04-user-flows.md` flow 7 both describe import as a total overwrite. Merge import is an explicit fast-follow candidate, not this phase.
- **Attachment FILES are not embedded in the export — metadata only** (`03-business-rules.md` §14, spec-explicit). The export/import UI copy must say so explicitly (e.g. an inline note under "Exportar datos": "Los archivos adjuntos no se incluyen, solo su información") so this isn't a silent surprise data-loss trap when a user restores on a new device and finds attachment rows that point at files that don't exist there.
- **Basic shape/version validation only, not deep schema validation** (`04-user-flows.md` flow 7 step 3 says "basic shape/version check", not exhaustive per-field validation). `parseBackupFile` checks: valid JSON, correct `version`, all 7 expected table keys present as arrays, and that each row's *known date fields* parse to a valid `Date` (guards against silently importing `Invalid Date` into the DB). It does **not** validate FK integrity, enum membership (e.g. a corrupted `priority` value), or field completeness beyond that — a deliberately shallow bar matching the roadmap's own wording, not a full-blown schema validator (Zod or similar) which would be a new dependency this plan's first constraint already rules out.
- **Import bypasses `assertTaskEditable`/closed-semester enforcement entirely, for every table.** This is a deliberate, phase-defining decision — **flag for explicit human confirmation when approving this plan's execution, matching every prior phase's pattern for a plan's own added assumptions** (Phase 6's §15 "Tareas urgentes" ambiguity, Phase 8's `overallCompletionRate` contract, etc.): import is a full-system replace, not a per-entity edit, so the ordinary "closed semester is read-only" rule (§11) does not apply to it — a backup taken while a semester was closed must still restore that semester's tasks correctly. Task 2's repository functions write directly via `database.delete`/`database.insert`, never through `task.ts`/`subject.ts`/etc.'s create/update functions (which enforce §11 and would incorrectly block restoring closed-semester data).
- **Imported reminders are always rescheduled fresh — old `notificationId` values from the export are always discarded on import**, even if they happen to look plausible (`04-user-flows.md` flow 7 step 6, spec-explicit, not an assumption). Every imported reminder row is inserted with `notificationId: null` first; a second pass after the transaction commits calls `requestNotificationPermission` once, then `scheduleReminderNotification` for every reminder whose imported `computedFireAt` is still in the future, mirroring `addReminder`'s existing scheduling logic (`src/db/repositories/reminder.ts`) — reused conceptually, not literally, since `addReminder` also enforces `assertTaskEditable` and generates a new id, neither of which applies when restoring rows that already have their own id.
- **All previously scheduled OS notifications are cancelled before the destructive delete**, not after — read every existing `reminders.notificationId` (not null) from the live DB and cancel each via `cancelReminderNotification` (`@/lib/notifications`) before the transaction runs. This must happen as a separate async pass before `database.transaction(...)`, exactly like `semester.ts`'s `cancelRemindersForSemester` — the transaction callback itself must stay synchronous (`better-sqlite3` rejects an async transaction function; see `semester.ts`'s own comment on this).
- **Export file is written to `Paths.cache`, not `Paths.document`.** It's transient share output the app never needs to read back — matches `expo-document-picker`'s own `copyToCacheDirectory` convention already used for attachments (Phase 5), as opposed to attachments' `Paths.document` (persistent, private) storage.
- **Export is pretty-printed JSON** (`JSON.stringify(backupFile, null, 2)`), not minified — this plan's own assumption, since neither `03-business-rules.md` nor `11-roadmap.md` specifies a format; human-inspectability (the user can open the file and sanity-check it) outweighs the negligible size cost at this app's realistic data volumes. Flag as an assumption in Task 1's report.
- **Confirmation dialog required before import replace** (`03-business-rules.md` §13, already covered by rule 13's "Import data (overwrite warning)" line) — reuses the existing `Alert.alert(title, message, [cancel, destructive])` pattern already established for semester close / task / subject deletion, not a new dialog component.
- **No new component test.** Matching Phase 8's precedent (the established convention for non-pilot phases), this screen is verified via domain tests (Task 1) + repository integration tests (Task 2) + the on-device DoD pass (Task 4) only — no `.tsx` test file.
- **Every color in the new UI comes from `@/theme`**, zero new hardcoded hex values beyond the same pre-existing `"#FFFFFF"`-on-solid-color pattern already backlogged for Phase 10 (`colors.primary`-background button text, etc.) — do not invent a new hex value.

---

### Task 1: Backup serialization domain module (TDD)

**Files:**
- Create: `src/domain/backup.ts`
- Create: `src/domain/__tests__/backup.test.ts`

**Interfaces:**
- Consumes: `type Semester` from `@/db/schema/semester`; `type Subject` from `@/db/schema/subject`; `type Task` from `@/db/schema/task`; `type Subtask` from `@/db/schema/subtask`; `type Reminder` from `@/db/schema/reminder`; `type Attachment` from `@/db/schema/attachment`; `type Settings` from `@/db/schema/settings` — type-only imports, this module has zero DB/query code.
- Produces: `BACKUP_VERSION`, `type BackupTables`, `type BackupFile`, `serializeBackup(tables, now)`, `type BackupParseResult`, `parseBackupFile(jsonText)`.

**Given code:**

```typescript
// src/domain/backup.ts
import type { Semester } from "@/db/schema/semester";
import type { Subject } from "@/db/schema/subject";
import type { Task } from "@/db/schema/task";
import type { Subtask } from "@/db/schema/subtask";
import type { Reminder } from "@/db/schema/reminder";
import type { Attachment } from "@/db/schema/attachment";
import type { Settings } from "@/db/schema/settings";

/**
 * 03-business-rules.md §14 / 04-user-flows.md flows 6-7: a single JSON file
 * containing every local table. There is exactly one supported version —
 * a migration path is speculative until a second version actually exists
 * (YAGNI, see this plan's Global Constraints).
 */
export const BACKUP_VERSION = 1;

export interface BackupTables {
  semesters: Semester[];
  subjects: Subject[];
  tasks: Task[];
  subtasks: Subtask[];
  reminders: Reminder[];
  attachments: Attachment[];
  settings: Settings[];
}

export interface BackupFile {
  version: typeof BACKUP_VERSION;
  exportedAt: string; // ISO 8601
  data: BackupTables;
}

/**
 * Wraps the raw table rows with a version + export timestamp.
 * `JSON.stringify` on the result automatically serializes every `Date`
 * field to an ISO string (native `Date.prototype.toJSON` behavior) — no
 * manual per-field conversion needed on the export side. The repository
 * layer (Task 2) is the one that actually calls `JSON.stringify`.
 */
export function serializeBackup(tables: BackupTables, now: Date = new Date()): BackupFile {
  return { version: BACKUP_VERSION, exportedAt: now.toISOString(), data: tables };
}

export type BackupParseResult =
  | { valid: true; data: BackupTables }
  | { valid: false; reason: "not-json" | "unsupported-version" | "wrong-shape" };

const TABLE_KEYS = [
  "semesters",
  "subjects",
  "tasks",
  "subtasks",
  "reminders",
  "attachments",
  "settings",
] as const;

// Known Date-typed fields per table (see each src/db/schema/*.ts file) —
// these come back as ISO strings from JSON.parse and must be converted
// back to real Date objects before the repository layer can insert them.
const DATE_FIELDS: Record<(typeof TABLE_KEYS)[number], string[]> = {
  semesters: ["createdAt", "closedAt"],
  subjects: ["createdAt", "updatedAt"],
  tasks: ["dueDateTime", "completedAt", "createdAt", "updatedAt"],
  subtasks: [],
  reminders: ["fixedDateTime", "computedFireAt", "createdAt"],
  attachments: ["createdAt"],
  settings: ["createdAt", "updatedAt"],
};

function reviveDates(rows: unknown[], dateFields: string[]): unknown[] | null {
  const revived: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return null;
    const next: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    for (const field of dateFields) {
      const value = next[field];
      if (value === null || value === undefined) continue; // nullable date field
      if (typeof value !== "string") return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      next[field] = parsed;
    }
    revived.push(next);
  }
  return revived;
}

/**
 * Basic shape/version check only (04-user-flows.md flow 7 step 3's own
 * wording) — NOT a full schema validator. Confirms JSON parses, the
 * version matches exactly, all 7 table keys exist as arrays, and every
 * row's known date fields parse to a valid Date. Does not check FK
 * integrity, enum membership, or field completeness beyond that.
 */
export function parseBackupFile(jsonText: string): BackupParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { valid: false, reason: "not-json" };
  }

  if (typeof raw !== "object" || raw === null) {
    return { valid: false, reason: "wrong-shape" };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== BACKUP_VERSION) {
    return { valid: false, reason: "unsupported-version" };
  }
  if (typeof candidate.data !== "object" || candidate.data === null) {
    return { valid: false, reason: "wrong-shape" };
  }
  const data = candidate.data as Record<string, unknown>;

  const result: Partial<BackupTables> = {};
  for (const key of TABLE_KEYS) {
    const rows = data[key];
    if (!Array.isArray(rows)) {
      return { valid: false, reason: "wrong-shape" };
    }
    const revived = reviveDates(rows, DATE_FIELDS[key]);
    if (revived === null) {
      return { valid: false, reason: "wrong-shape" };
    }
    result[key] = revived as never;
  }

  return { valid: true, data: result as BackupTables };
}
```

**Test cases (`src/domain/__tests__/backup.test.ts`):**

1. `serializeBackup` — wraps tables with the correct `version` and an `exportedAt` matching the injected `now` (ISO string).
2. `serializeBackup` with all-empty table arrays — still produces a valid `BackupFile` (an empty backup is legitimate, e.g. exporting before any data exists).
3. `parseBackupFile` — a round trip (`JSON.stringify(serializeBackup(fixtureTables))` → `parseBackupFile`) recovers table rows whose date fields are real `Date` instances equal (`.getTime()`) to the originals — the core "must not break the round trip" guarantee.
4. `parseBackupFile` — malformed JSON text → `{ valid: false, reason: "not-json" }`.
5. `parseBackupFile` — valid JSON but `version: 2` (or missing) → `{ valid: false, reason: "unsupported-version" }`.
6. `parseBackupFile` — valid JSON, correct version, but `data` missing one of the 7 table keys → `{ valid: false, reason: "wrong-shape" }`.
7. `parseBackupFile` — a table value that isn't an array (e.g. `tasks: {}`) → `{ valid: false, reason: "wrong-shape" }`.
8. `parseBackupFile` — a row with an unparseable date string (e.g. `createdAt: "not-a-date"`) → `{ valid: false, reason: "wrong-shape" }`.
9. `parseBackupFile` — a row with a legitimately-`null` nullable date field (e.g. `semesters[0].closedAt: null`, an active semester) → stays `null` after parsing, not rejected.
10. `parseBackupFile` — `subtasks` rows (which have zero date fields) pass through unchanged.

- [ ] **Step 1: Write the failing tests** (`src/domain/__tests__/backup.test.ts`), confirm true RED (`src/domain/backup.ts` doesn't exist yet).
- [ ] **Step 2: Implement `src/domain/backup.ts`** using the given code above (adapt only if a test written in Step 1 reveals a genuine gap — do not silently deviate from the given code otherwise).
- [ ] **Step 3: Confirm GREEN**

```bash
npx jest src/domain/__tests__/backup.test.ts
```

- [ ] **Step 4: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check src/domain/backup.ts src/domain/__tests__/backup.test.ts
npm test
```

`npm test` should be 199/199 (23 suites) — 189 existing + 10 new.

- [ ] **Step 5: Commit**

```bash
git add src/domain/backup.ts src/domain/__tests__/backup.test.ts
git commit -m "feat: add backup serialize/parse domain module (TDD)"
```

---

### Task 2: Backup repository (export read + destructive import write)

**Files:**
- Create: `src/db/repositories/backup.ts`
- Create: `src/db/repositories/__tests__/backup.test.ts`

**Interfaces:**
- Consumes: `serializeBackup`, `type BackupTables` from `@/domain/backup` (Task 1); `db` (default), all 7 schema tables from `@/db/schema`; `cancelReminderNotification`, `requestNotificationPermission`, `scheduleReminderNotification` from `@/lib/notifications`; the `Database` type alias pattern already established in `semester.ts`/`settings.ts` (`BaseSQLiteDatabase<"async" | "sync", unknown, typeof schema>`).
- Produces: `exportBackupJson(database?)`, `type ImportResult`, `importBackup(tables, database?)`.

**Given code:**

```typescript
// src/db/repositories/backup.ts
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { db as defaultDb } from "@/db/client";
import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import { settings } from "@/db/schema/settings";
import {
  cancelReminderNotification,
  requestNotificationPermission,
  scheduleReminderNotification,
} from "@/lib/notifications";
import { serializeBackup, type BackupTables } from "@/domain/backup";

export type Database = BaseSQLiteDatabase<"async" | "sync", unknown, typeof schema>;

/** Reads every row of every table — the export side is pure reads, no writes. */
async function readAllTables(database: Database): Promise<BackupTables> {
  return {
    semesters: await database.select().from(semesters),
    subjects: await database.select().from(subjects),
    tasks: await database.select().from(tasks),
    subtasks: await database.select().from(subtasks),
    reminders: await database.select().from(reminders),
    attachments: await database.select().from(attachments),
    settings: await database.select().from(settings),
  };
}

/** Pretty-printed per this plan's Global Constraints — human-inspectable. */
export async function exportBackupJson(database: Database = defaultDb): Promise<string> {
  const tables = await readAllTables(database);
  return JSON.stringify(serializeBackup(tables), null, 2);
}

export interface ImportResult {
  remindersScheduled: number;
  remindersUnscheduled: number;
}

/**
 * Full-replace import (03-business-rules.md §14 / 04-user-flows.md flow 7):
 * cancels every currently-scheduled OS notification, wipes all 7 tables,
 * inserts every imported row verbatim (original ids/timestamps preserved —
 * a true replace, not an id-regenerating import), then reschedules a fresh
 * OS notification for every imported reminder still due in the future.
 * Deliberately bypasses assertTaskEditable/closed-semester enforcement for
 * every table — see this plan's Global Constraints for why.
 */
export async function importBackup(
  tables: BackupTables,
  database: Database = defaultDb,
): Promise<ImportResult> {
  // Cancel existing notifications BEFORE the wipe — must be a separate async
  // pass; the transaction callback below must stay synchronous (see
  // semester.ts's identical note on this constraint).
  const existingReminders = await database
    .select({ notificationId: reminders.notificationId })
    .from(reminders);
  for (const { notificationId } of existingReminders) {
    if (notificationId) {
      await cancelReminderNotification(notificationId);
    }
  }

  // Child-to-parent delete order, parent-to-child insert order — explicit,
  // not relying on ON DELETE CASCADE quirks for a full-table wipe.
  // Imported reminders are inserted with notificationId forced to null;
  // the real value is never trustworthy across devices (Global Constraints).
  await database.transaction((tx) => {
    tx.delete(attachments).run();
    tx.delete(reminders).run();
    tx.delete(subtasks).run();
    tx.delete(tasks).run();
    tx.delete(subjects).run();
    tx.delete(semesters).run();
    tx.delete(settings).run();

    if (tables.semesters.length > 0) tx.insert(semesters).values(tables.semesters).run();
    if (tables.subjects.length > 0) tx.insert(subjects).values(tables.subjects).run();
    if (tables.tasks.length > 0) tx.insert(tasks).values(tables.tasks).run();
    if (tables.subtasks.length > 0) tx.insert(subtasks).values(tables.subtasks).run();
    if (tables.reminders.length > 0) {
      tx.insert(reminders)
        .values(tables.reminders.map((r) => ({ ...r, notificationId: null })))
        .run();
    }
    if (tables.attachments.length > 0) tx.insert(attachments).values(tables.attachments).run();
    if (tables.settings.length > 0) tx.insert(settings).values(tables.settings).run();
  });

  // Reschedule fresh notifications for every still-future reminder.
  const permission = await requestNotificationPermission();
  let remindersScheduled = 0;
  let remindersUnscheduled = 0;
  const now = Date.now();
  for (const reminder of tables.reminders) {
    if (reminder.computedFireAt.getTime() <= now) continue; // already due/past — leave unscheduled
    if (!permission.granted) {
      remindersUnscheduled += 1;
      continue;
    }
    const task = tables.tasks.find((t) => t.id === reminder.taskId);
    const subject = task ? tables.subjects.find((s) => s.id === task.subjectId) : undefined;
    const notificationId = await scheduleReminderNotification(reminder.computedFireAt, {
      taskTitle: task?.title ?? "",
      subjectName: subject?.name ?? "",
      dueDateTime: task?.dueDateTime ?? reminder.computedFireAt,
    });
    await database
      .update(reminders)
      .set({ notificationId })
      .where(sql`${reminders.id} = ${reminder.id}`);
    remindersScheduled += 1;
  }

  return { remindersScheduled, remindersUnscheduled };
}
```

**Note for the implementer:** the last `database.update(...).where(sql...)` line needs `eq(reminders.id, reminder.id)` from `drizzle-orm` (`import { eq } from "drizzle-orm"`) exactly like every other repository in this codebase — the given code above uses a raw `sql` tag as a placeholder to keep the snippet self-contained; replace it with the real `eq()` import, matching `reminder.ts`'s own established style. Flag this correction in the task report if made silently, per this project's "given code is not infallible" precedent (Phase 2/3 found real bugs in verbatim brief code the same way).

**Test cases (`src/db/repositories/__tests__/backup.test.ts`, in-memory `better-sqlite3`, `jest.mock("@/lib/notifications")` matching `reminder.test.ts`/`semester.test.ts`'s established pattern):**

1. `exportBackupJson` on an empty DB — returns a parseable `BackupFile` with all 7 arrays empty.
2. `exportBackupJson` on a seeded DB (1 semester, 1 subject, 2 tasks, subtasks, 1 reminder, 1 attachment, 1 settings row) — round-trips through `parseBackupFile` and recovers the exact row counts and field values.
3. `importBackup` — wipes pre-existing seeded data and replaces it with the imported tables; verify via direct `select()` on all 7 tables that ONLY the imported rows exist afterward (not a merge).
4. `importBackup` — cancels every pre-existing reminder's OS notification (mock call count/args asserted) BEFORE the wipe.
5. `importBackup` — an imported reminder with `computedFireAt` in the future and `notificationId` set in the JSON gets a **freshly scheduled** notification with a **different** id, not the imported one (proves the "always discard the old id" rule, not just "leave it alone if present").
6. `importBackup` — an imported reminder with `computedFireAt` in the past is left with `notificationId: null`, not scheduled, and does not increment `remindersUnscheduled` (it's correctly skipped, not a failure).
7. `importBackup` — notification permission denied → reminders due in the future increment `remindersUnscheduled`, no `scheduleReminderNotification` call attempted for those.
8. `importBackup` — importing data for a semester with `status: "closed"` succeeds without throwing (proves the deliberate bypass of `assertTaskEditable` from the Global Constraints — a naive reuse of `addReminder`/`createTask` here would incorrectly throw `SemesterReadOnlyError`).
9. `importBackup` — importing all-empty tables (a legitimate empty backup) succeeds and leaves the DB fully empty, no crash on the conditional zero-row inserts.

- [ ] **Step 1: Write the failing tests**, confirm RED.
- [ ] **Step 2: Implement `src/db/repositories/backup.ts`** using the given code above, applying the `eq()` correction noted.
- [ ] **Step 3: Confirm GREEN**

```bash
npx jest src/db/repositories/__tests__/backup.test.ts
```

- [ ] **Step 4: Run the full combined check** — expect roughly 208-209/209 tests (23 → 24 suites, ~9 new tests; exact count depends on final test list above).

```bash
npx tsc --noEmit
npm run lint
npx prettier --check src/db/repositories/backup.ts src/db/repositories/__tests__/backup.test.ts
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/backup.ts src/db/repositories/__tests__/backup.test.ts
git commit -m "feat: add backup export/import repository (TDD)"
```

---

### Task 3: Wire "Exportar datos" / "Importar datos" into the Settings screen

**Files:**
- Modify: `app/configuracion/index.tsx` — add a "Datos" section below the existing profile form, per Phase 6.6's note that this screen is extended, not replaced.

**Interfaces:**
- Consumes: `exportBackupJson`, `importBackup` from `@/db/repositories/backup` (Task 2); `parseBackupFile`, `type BackupTables` from `@/domain/backup` (Task 1); `getDocumentAsync` from `expo-document-picker`; `File`, `Paths` from `expo-file-system`; `isAvailableAsync`, `shareAsync` from `expo-sharing`; `router` from `expo-router` (already imported); `colors` from `@/theme` (already imported).

**Given code (additions to the existing file — insert after the profile `form` block, before the closing `SafeAreaView`; existing imports/state/handlers untouched):**

```tsx
// New imports, added to the existing import block:
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

import { exportBackupJson, importBackup } from "@/db/repositories/backup";
import { parseBackupFile, type BackupTables } from "@/domain/backup";

// New state, alongside the existing nickname/fullName/loaded/saving state:
const [exporting, setExporting] = useState(false);
const [importing, setImporting] = useState(false);

// New handlers:
async function handleExport() {
  setExporting(true);
  try {
    const json = await exportBackupJson();
    const file = new File(Paths.cache, `unitask-backup-${Date.now()}.json`);
    file.create();
    file.write(json);
    const available = await Sharing.isAvailableAsync();
    if (available) {
      await Sharing.shareAsync(file.uri, { mimeType: "application/json" });
    }
  } catch {
    Alert.alert("Error", "No se pudo exportar los datos.");
  } finally {
    setExporting(false);
  }
}

function reasonMessage(reason: "not-json" | "unsupported-version" | "wrong-shape"): string {
  switch (reason) {
    case "not-json":
      return "El archivo no es un JSON válido.";
    case "unsupported-version":
      return "Este archivo no es una copia de seguridad de UniTask compatible.";
    case "wrong-shape":
      return "El archivo no tiene el formato esperado de una copia de seguridad de UniTask.";
  }
}

async function handleImportPress() {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/json",
    copyToCacheDirectory: true,
  });
  if (result.canceled) return;

  const asset = result.assets[0];
  const jsonText = await new File(asset.uri).text();
  const parsed = parseBackupFile(jsonText);
  if (!parsed.valid) {
    Alert.alert("Archivo inválido", reasonMessage(parsed.reason));
    return;
  }

  Alert.alert(
    "¿Reemplazar todos los datos?",
    "Esta acción reemplazará TODOS los datos actuales y no se puede deshacer. Los archivos adjuntos no se restauran, solo su información.",
    [
      { text: "Cancelar", style: "cancel" },
      { text: "Reemplazar", style: "destructive", onPress: () => runImport(parsed.data) },
    ],
  );
}

async function runImport(data: BackupTables) {
  setImporting(true);
  try {
    const result = await importBackup(data);
    Alert.alert(
      "Datos importados",
      result.remindersUnscheduled > 0
        ? `${result.remindersScheduled} recordatorio(s) reprogramado(s). ${result.remindersUnscheduled} no se pudieron reprogramar (permiso de notificaciones).`
        : `${result.remindersScheduled} recordatorio(s) reprogramado(s).`,
      [{ text: "OK", onPress: () => router.replace("/(tabs)") }],
    );
  } catch {
    Alert.alert("Error", "No se pudo importar los datos.");
  } finally {
    setImporting(false);
  }
}
```

```tsx
{/* New JSX section, rendered after the existing profile `form` View, still inside the `loaded` branch: */}
<View style={styles.dataSection}>
  <Text style={styles.sectionTitle}>Datos</Text>
  <Text style={styles.sectionNote}>
    Los archivos adjuntos no se incluyen en la exportación, solo su información.
  </Text>
  <TouchableOpacity
    style={[styles.secondaryButton, exporting && styles.saveButtonDisabled]}
    onPress={handleExport}
    disabled={exporting || importing}
  >
    <Text style={styles.secondaryButtonText}>
      {exporting ? "Exportando…" : "Exportar datos"}
    </Text>
  </TouchableOpacity>
  <TouchableOpacity
    style={[styles.secondaryButton, importing && styles.saveButtonDisabled]}
    onPress={handleImportPress}
    disabled={exporting || importing}
  >
    <Text style={styles.secondaryButtonText}>
      {importing ? "Importando…" : "Importar datos"}
    </Text>
  </TouchableOpacity>
</View>
```

```tsx
// New styles, added to the existing StyleSheet.create({...}) object:
dataSection: { padding: 20, gap: 8, marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
sectionNote: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
secondaryButton: {
  borderWidth: 1,
  borderColor: colors.primary,
  borderRadius: 8,
  paddingVertical: 14,
  alignItems: "center",
},
secondaryButtonText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
```

**Constraints specific to this task:**
- Both buttons disabled while either `exporting` or `importing` is true — no concurrent export+import.
- Import navigates to the Dashboard (`router.replace("/(tabs)")`) only after the success alert's OK press, matching `04-user-flows.md` flow 7 step 7 ("App returns to Dashboard reflecting the newly imported state") — not immediately on import completing underneath a still-open alert.
- If the user cancels at the confirmation dialog (`style: "cancel"`), no data is touched — matches flow 7's explicit "If the user cancels... no data is touched" line. `handleImportPress`'s early `if (result.canceled) return` for the document picker itself covers the picker-cancel case too.

- [ ] **Step 1: Apply the given code above to `app/configuracion/index.tsx`.**
- [ ] **Step 2: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check "app/configuracion/index.tsx"
npm test
```

Expected: same test count as the end of Task 2 — this is UI-only wiring, no new tests (Global Constraints).

- [ ] **Step 3: Commit**

```bash
git add "app/configuracion/index.tsx"
git commit -m "feat: wire export/import into the Settings screen"
```

---

### Task 4: Full Phase 9 Definition of Done verification

**Files:** none (verification-only task).

**Verification split (matching Phase 7/8's precedent — do not spend tokens driving an emulator for this phase):** the implementer runs the automated combined check only and produces an on-device checklist document; the human performs the actual on-device walkthrough. **This phase's checklist carries one addition Phase 7/8 didn't need: a mandatory device-DB-backup step before testing import**, since a botched import test on the human's real device data is irreversible by design (this is the entire point of the feature) — same data-safety precedent as Phase 5 Task 7's SQLite backup before testing a closed-semester delete-block.

- [ ] **Step 1: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check .
npm test
```

Expected: all green, no regressions in any suite from Phases 0–8. If anything fails, fix it, re-verify, and commit the fix before proceeding.

- [ ] **Step 2: Write the on-device checklist for the human**

Write `.superpowers/sdd/phase9-device-checklist.md`. Base it on:

0. **Before anything else**, back up the real device DB (`adb exec-out run-as <package> cat databases/unitask.db > backup.db`, or export via the app's own new "Exportar datos" button first and save that JSON somewhere safe) — do this before touching "Importar datos" at all.
1. Open Configuración — confirm a new "Datos" section appears below the existing profile form, with a note that attachment files aren't included.
2. Tap "Exportar datos" — confirm the system share sheet opens with a `.json` file; save/send it somewhere accessible, then open it in a text viewer and confirm it looks like a sane JSON structure with `version`, `exportedAt`, and `data` containing arrays for all 7 tables.
3. Tap "Importar datos", pick a non-JSON file (e.g. a photo) — confirm an "Archivo inválido" alert appears and nothing changes.
4. Tap "Importar datos", pick the JSON exported in step 2 — confirm the destructive-replace warning dialog appears; tap "Cancelar" — confirm no data changed (spot-check a task still exists).
5. Tap "Importar datos" again, pick the same file, tap "Reemplazar" — confirm a success alert appears mentioning how many reminders were rescheduled, then confirm the app lands on the Dashboard showing the restored data.
6. Spot-check the restored data matches what was exported: same semesters/subjects/tasks, a scheduled reminder shows no "(no programado)" suffix on Task detail (proves it was genuinely rescheduled, not left with the old dead notification id).
7. If reachable without further destructive action: export data from a state that includes a **closed** semester, then re-import it — confirm the closed semester's tasks/subjects come back correctly (proves the deliberate `assertTaskEditable` bypass from this plan's Global Constraints works, not just the active-semester path).
8. Restore the real backup from Step 0 at the end of this checklist, so the device is left in its original state, not the test file's data.

- [ ] **Step 3: Write the Phase 9 implementation report**

Write `.superpowers/sdd/task-4-report.md` (check first whether a stale report from an earlier phase's differently-numbered final task exists at a colliding path — this project has hit that collision before, in Phases 3/4/5/7 — overwrite if so). Include the combined-check output and a pointer to the checklist file from Step 2.

- [ ] **Step 4: No commit expected for the checklist itself**

Only commit if Step 1 surfaced and required a real fix.

---

### After Task 4: whole-branch review

Matches this project's established "UI phases done inline, whole-branch review only at the end" working mode (confirmed with the human for this stretch of phases) — dispatch one whole-branch review across `origin/master..HEAD` after Task 4, before pushing, same as Phases 6/7/8.
