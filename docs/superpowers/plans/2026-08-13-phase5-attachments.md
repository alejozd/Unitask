# Phase 5 — Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user attach files to a task (pick → validate → copy into app-private storage → list), open an attachment via the OS "open with" sheet, and have attachment files cleaned up automatically when their task (or its subject, via cascade) is deleted.

**Architecture:** A thin `src/lib/files/` wrapper is the sole point of contact with `expo-document-picker`, `expo-file-system`, and `expo-sharing` (mirrors Phase 4's `src/lib/notifications/`). A pure domain function validates type/size before anything touches disk. An `attachment.ts` repository orchestrates validate → copy → DB row, and is wired into `deleteTask`/`deleteSubject`'s existing cascade-cleanup points exactly like Phase 4's reminder cancellation was. One new UI component (`AttachmentList`) is wired into the Task detail screen only — Nueva Tarea/Editar Tarea are explicitly out of scope (see Global Constraints).

**Tech Stack:** `expo-document-picker`, `expo-file-system` (SDK 57's new class-based `File`/`Directory`/`Paths` API — see Global Constraints), `expo-sharing`, Drizzle ORM (schema/table already exist from Phase 1), Jest + `jest.mock`.

## Global Constraints

- **Scope**: attach/view/remove is wired into the Task detail screen (`app/tarea/[id]/index.tsx`) ONLY, matching `docs/11-roadmap.md`'s Phase 5 acceptance criteria exactly ("attachment list on task detail" — Nueva/Editar Tarea are not mentioned). `09-file-management.md` mentions Nueva/Editar Tarea as a possible entry point too, but attaching requires a real `taskId` for the storage path (`{taskId}/{attachmentId}-{name}`), and no task exists yet during Nueva Tarea's draft state — building a draft-attachment flow (temp storage, re-copy on save) is unnecessary complexity the roadmap doesn't ask for. **(assumption, matching the docs' own "(assumption)" convention)**.
- **`expo-file-system` SDK 57 uses the NEW class-based API** (`File`, `Directory`, `Paths` — constructed with `new File(...)`, `new Directory(...)`, instance methods/properties like `.exists`, `.size`, `.copy()`, `.delete()`, `.create()`). The OLD function-based API (`FileSystem.copyAsync`, `FileSystem.makeDirectoryAsync`, `FileSystem.deleteAsync`, `FileSystem.getInfoAsync`, etc.) is **deprecated and throws at runtime** unless imported from `expo-file-system/legacy`. **Never import anything from `expo-file-system/legacy` in this codebase** — use the class-based API exclusively. Verified against `https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/` directly (per this project's `AGENTS.md` mandate to check exact versioned docs, not training-data assumptions) — every legacy method's doc entry explicitly says `> Deprecated: ... This method will throw in runtime.`
- **Storage location**: files are copied into `Paths.document` (the app's private, OS-stable document directory — NOT `Paths.cache`, which the OS can clear without warning), under `attachments/{taskId}/{attachmentId}-{originalFileName}`, per `09-file-management.md`'s storage convention.
- **View flow**: uses `expo-sharing`'s `shareAsync` exclusively — this is `09-file-management.md`'s explicit architectural pick (not `expo-intent-launcher`, not raw `Linking`). UniTask never renders any file type itself.
- **Validation order is strict**: type + size are checked BEFORE any copy happens. A rejected file must produce zero bytes written to app storage (`09-file-management.md` step 3: "no copy occurs" on rejection).
- **Never trust the picker's reported size**: `expo-document-picker`'s `DocumentPickerAsset.size` is optional (can be `undefined` depending on the OS/picker). The authoritative size is read from the picked file itself (`new File(uri).size`) before validating — never validated against a possibly-missing picker-reported value.
- **Max size**: 25 MB per file, exactly `≤` (not `<`) — a file at exactly `25 * 1024 * 1024` bytes is allowed, only strictly greater is rejected (`03-business-rules.md` §9: "Max size: 25 MB per file (hard limit)"). No aggregate per-task cap in v1.
- **Allowed types** (`03-business-rules.md` §9): PDF, DOCX, XLSX, PPTX, JPG/JPEG, PNG, HEIC, TXT — checked by MIME type. A missing/unrecognized MIME type is rejected (type reason), never silently accepted.
- **Closed-semester enforcement is a REPOSITORY-layer guarantee, not a UI-layer one** (`03-business-rules.md` §11): `addAttachment` and `removeAttachment` (Task 3) each independently call `assertTaskEditable` (from `@/db/repositories/task-access`, the same Phase 4 extraction reminders use) and throw `SemesterReadOnlyError` — this must hold even if called directly (tests, future screens, a CLI), never relying on a screen disabling a button as the only guard. Task 3's tests assert this directly against the repository functions, with no UI involved.
- **Sandbox file cleanup on EVERY deletion route, each with its own test** — three distinct routes, all wired by this plan, none may be skipped: (1) `removeAttachment` deletes that one attachment's file (Task 3); (2) `deleteTask` deletes its task's whole attachment directory (Task 4); (3) `deleteSubject`'s cascade-delete of blocked-free tasks deletes each cascade-removed task's attachment directory (Task 4, mirrors the existing reminder-cancellation cascade). Task 3 and Task 4's test steps each include one test per route asserting the corresponding `@/lib/files` cleanup function was actually called — not merely that the DB row/cascade succeeded.
- **Atomicity: a failed copy must leave neither a DB row nor a partial file on disk.** `addAttachment` (Task 3) only inserts the `attachments` row AFTER `copyIntoAttachmentStorage` (Task 1) resolves successfully, so a thrown copy error already guarantees no DB row is written — Task 3 has an explicit test for this (mocks `copyIntoAttachmentStorage` to reject, asserts zero rows). The harder half is the file side: `expo-file-system`'s `File.copy()` can throw mid-write (disk full, permission revoked, source vanished mid-copy), which can leave a truncated destination file behind with no DB row ever referencing it — an orphan nothing would ever clean up otherwise. Task 1's `copyIntoAttachmentStorage` wraps the copy in a try/catch that deletes any partially-written destination file before rethrowing (see Task 1 Step 4's code). **Disclosed limitation, not a gap to silently paper over**: this specific cleanup path cannot be meaningfully unit-tested (it needs a real native-module-backed partial write to trigger, which Jest can't produce, and forcing one on a real device — filling storage, revoking permissions mid-copy — is impractical within Task 7's "one short on-device pass" constraint). It is verified by code review (the try/catch is straightforward and its logic is the entire guarantee) rather than by an automated or on-device test — Task 7's report must say this explicitly, not claim it was exercised when it wasn't.
- **Type/size limits are cited from `03-business-rules.md` §9 both in code AND in tests**, not just one or the other — Task 2's `attachment-validation.ts` has doc comments quoting §9 directly above `MAX_ATTACHMENT_SIZE_BYTES`/`ALLOWED_ATTACHMENT_MIME_TYPES`, and Task 2's test file opens with a comment citing the same section, so the rule's source is traceable from both the implementation and the specs that pin it down.
- **Schema already exists**: `src/db/schema/attachment.ts` (the `attachments` table, with `ON DELETE CASCADE` to `tasks`) was created in Phase 1 and is unchanged by this phase — Phase 5 adds no migration work, only `src/lib/files/`, `src/domain/attachment-validation.ts`, `src/db/repositories/attachment.ts`, and UI.
- **No component unit tests**: matching this codebase's established convention (`ReminderPicker.tsx`, `TaskForm.tsx` have no `.test.tsx` files), `AttachmentList.tsx` is verified via the final on-device DoD walkthrough (Task 7), not a component test.
- **Testing native wrappers**: `src/lib/files/index.ts` itself is untested (thin wrapper around native SDKs, matching Phase 4's `src/lib/notifications/index.ts` precedent) — verified via the repository layer's tests (which `jest.mock("@/lib/files")` wholesale, matching the established `jest.mock("@/lib/notifications")` pattern) and the final on-device walkthrough. The one exception is the atomicity partial-file cleanup (previous bullet) — that specific branch is verified by code review only, per that bullet's disclosed limitation, not by any test or on-device step.

---

### Task 1: `expo-document-picker`/`expo-file-system`/`expo-sharing` dependencies + `src/lib/files/` wrapper

**Files:**
- Modify: `app.json` (dependencies + `plugins` array, only if a package actually registers a config plugin — check before adding, do not add blindly; `expo-crypto` in this codebase's own `package.json` is an example of a dependency that needs NO plugins entry)
- Create: `src/lib/files/index.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `pickDocument(): Promise<PickedDocument | null>`, `PickedDocument { uri: string; name: string; mimeType: string | null }`, `getFileSizeBytes(uri: string): number`, `copyIntoAttachmentStorage(sourceUri: string, taskId: string, attachmentId: string, originalFileName: string): Promise<{ storedPath: string }>`, `deleteAttachmentFile(storedPath: string): void`, `deleteAttachmentDirectoryForTask(taskId: string): void`, `openAttachment(storedPath: string, mimeType: string): Promise<void>` — all from `@/lib/files`.

- [ ] **Step 1: Install the three dependencies**

```bash
npx expo install expo-document-picker expo-file-system expo-sharing
```

Let the tool resolve versions (do not hand-pin), matching every prior native-dependency task in this project (Phase 3 Task 3, Phase 4 Task 1).

- [ ] **Step 2: Check whether any of the three packages register a config plugin**

```bash
node -e "console.log(require('expo-document-picker/package.json').main, require('expo-document-picker/package.json').app || 'no app.plugin')"
node -e "console.log(require('expo-file-system/package.json').main)"
node -e "console.log(require('expo-sharing/package.json').main)"
```

Also check for an `app.plugin.js` at each package's root: `ls node_modules/expo-document-picker/app.plugin.js node_modules/expo-file-system/app.plugin.js node_modules/expo-sharing/app.plugin.js 2>&1`. Only add a package name to `app.json`'s `"plugins"` array if it has one AND you have a concrete reason to configure it (e.g. `expo-sharing`'s plugin exists to enable the iOS Share Extension / Android incoming-share intent-filter — this project only ever calls `shareAsync` to share OUT, never registers as a share TARGET, so `expo-sharing` almost certainly does NOT need a plugins entry for this phase's usage; confirm by reading its plugin's own default config before deciding). If a package has no plugin at all (like `expo-crypto`, already a dependency in this codebase with no plugins entry), do not add one.

- [ ] **Step 3: Confirm the exact `File`/`Directory` instance API against the installed package**

```bash
grep -n "exists\|size\|class File\|class Directory\|copy(\|delete(\|create(" node_modules/expo-file-system/src/FileSystem.types.ts node_modules/expo-file-system/src/File.ts node_modules/expo-file-system/src/Directory.ts 2>&1 | head -80
```

(Exact file paths may differ slightly by installed version — if the above doesn't match, `find node_modules/expo-file-system/src -iname "*.ts" | xargs grep -ln "class File"` first.) Confirm: `File` and `Directory` instances expose `.exists: boolean` and `.uri: string` as plain properties (not methods, not requiring an `await`), `File` also exposes `.size: number | null`; `.copy(destination)` returns `Promise<void>`; `.delete()` returns `void` (synchronous); `Directory.create(options)` is synchronous. If any of these differ from what Step 4 below assumes, adjust Step 4's code to match the real API — do not silently keep code that doesn't match what you just confirmed.

- [ ] **Step 4: Write the wrapper module**

Create `src/lib/files/index.ts`:

```ts
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";

// Files.document (not Files.cache) — the OS can clear the cache directory
// without warning; the document directory is private and stable
// (09-file-management.md's persistence requirement).
const ATTACHMENTS_ROOT = new Directory(Paths.document, "attachments");

export interface PickedDocument {
  uri: string;
  name: string;
  mimeType: string | null;
}

/**
 * Opens the system document picker. Returns null if the user cancelled.
 * `mimeType` can legitimately come back null from the OS picker — callers
 * must not assume it's always present (see this plan's Global Constraints).
 */
export async function pickDocument(): Promise<PickedDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? null,
  };
}

/**
 * Reads the authoritative size of a file at `uri`, in bytes. Never trust
 * `DocumentPickerAsset.size` instead of this — it's optional and can be
 * missing depending on the OS/picker (Global Constraints).
 */
export function getFileSizeBytes(uri: string): number {
  return new File(uri).size ?? 0;
}

/**
 * Copies a picked file into this task's private attachment directory
 * ({Paths.document}/attachments/{taskId}/{attachmentId}-{originalFileName},
 * per 09-file-management.md), creating intermediate directories as needed.
 * Caller (the repository layer) is responsible for validating BEFORE
 * calling this — no validation happens here.
 *
 * Atomicity: if `copy()` throws partway (disk full, permission revoked,
 * source vanished mid-copy), any partially-written destination file is
 * deleted before rethrowing — a thrown error here must never leave an
 * orphaned partial file that nothing else would ever reference or clean
 * up, since the caller only inserts a DB row after this resolves.
 */
export async function copyIntoAttachmentStorage(
  sourceUri: string,
  taskId: string,
  attachmentId: string,
  originalFileName: string,
): Promise<{ storedPath: string }> {
  const taskDir = new Directory(ATTACHMENTS_ROOT, taskId);
  taskDir.create({ intermediates: true, idempotent: true });

  const sourceFile = new File(sourceUri);
  const destination = new File(taskDir, `${attachmentId}-${originalFileName}`);
  try {
    await sourceFile.copy(destination);
  } catch (error) {
    if (destination.exists) {
      destination.delete();
    }
    throw error;
  }

  return { storedPath: destination.uri };
}

/** Deletes one attachment's copied file. Safe to call if it no longer exists. */
export function deleteAttachmentFile(storedPath: string): void {
  const file = new File(storedPath);
  if (file.exists) {
    file.delete();
  }
}

/**
 * Deletes an entire task's attachment directory (and everything inside
 * it) in one call — used on task deletion, per 09-file-management.md's
 * "single directory delete" convention. Safe to call if the directory
 * doesn't exist (e.g. a task that never had attachments).
 */
export function deleteAttachmentDirectoryForTask(taskId: string): void {
  const taskDir = new Directory(ATTACHMENTS_ROOT, taskId);
  if (taskDir.exists) {
    taskDir.delete();
  }
}

/**
 * Hands the file to the OS "open with" flow via the system share sheet
 * (09-file-management.md's View flow) — UniTask never renders any file
 * type itself. No-ops (does not throw) if sharing isn't available on this
 * device, matching expo-sharing's own recommended availability check.
 */
export async function openAttachment(storedPath: string, mimeType: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) return;
  await Sharing.shareAsync(storedPath, { mimeType });
}
```

- [ ] **Step 5: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0. If `tsc` fails on the `File`/`Directory` API calls, re-check Step 3's findings — the installed version's exact method/property names take precedence over this plan's code.

- [ ] **Step 6: Verify the native build succeeds**

```bash
npx expo run:android
```

Expected: `BUILD SUCCESSFUL`. These are 3 new native modules (same category as `expo-notifications` in Phase 4 Task 1) — a green `tsc`/lint does not confirm the native side links correctly, the build must actually run.

- [ ] **Step 7: Commit**

```bash
git add app.json package.json package-lock.json "src/lib/files/index.ts"
git commit -m "feat: add file-management dependencies and files wrapper"
```

---

### Task 2: Attachment validation domain function (TDD)

**Files:**
- Create: `src/domain/attachment-validation.ts`
- Create: `src/domain/__tests__/attachment-validation.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain function, no dependency on Task 1).
- Produces: `MAX_ATTACHMENT_SIZE_BYTES: number`, `ALLOWED_ATTACHMENT_MIME_TYPES: readonly string[]`, `validateAttachment(candidate: { mimeType: string | null; sizeBytes: number }): AttachmentValidationResult`, `AttachmentValidationResult = { valid: true } | { valid: false; reason: "type" | "size" }`.

- [ ] **Step 1: Write the failing tests**

Create `src/domain/__tests__/attachment-validation.test.ts`:

```ts
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  validateAttachment,
} from "@/domain/attachment-validation";

// Limits under test are 03-business-rules.md §9: "Max size: 25 MB per file
// (hard limit)"; "Allowed types: PDF, DOCX, XLSX, PPTX, JPG/JPEG, PNG,
// HEIC, TXT. Any other file type is rejected."
describe("validateAttachment", () => {
  it("accepts a PDF under the size limit", () => {
    expect(validateAttachment({ mimeType: "application/pdf", sizeBytes: 1024 })).toEqual({
      valid: true,
    });
  });

  it("accepts every allowed type at a small size", () => {
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "image/jpeg",
      "image/png",
      "image/heic",
      "text/plain",
    ];
    for (const mimeType of allowedTypes) {
      expect(validateAttachment({ mimeType, sizeBytes: 1024 })).toEqual({ valid: true });
    }
  });

  it("accepts a file at exactly the 25 MB limit", () => {
    expect(
      validateAttachment({ mimeType: "application/pdf", sizeBytes: MAX_ATTACHMENT_SIZE_BYTES }),
    ).toEqual({ valid: true });
  });

  it("rejects a file one byte over the 25 MB limit, reason size", () => {
    expect(
      validateAttachment({
        mimeType: "application/pdf",
        sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1,
      }),
    ).toEqual({ valid: false, reason: "size" });
  });

  it("rejects a disallowed type, reason type", () => {
    expect(validateAttachment({ mimeType: "application/zip", sizeBytes: 1024 })).toEqual({
      valid: false,
      reason: "type",
    });
  });

  it("rejects a null mimeType, reason type", () => {
    expect(validateAttachment({ mimeType: null, sizeBytes: 1024 })).toEqual({
      valid: false,
      reason: "type",
    });
  });

  it("checks type before size when both are invalid", () => {
    expect(
      validateAttachment({ mimeType: "application/zip", sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1 }),
    ).toEqual({ valid: false, reason: "type" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/domain/__tests__/attachment-validation.test.ts
```

Expected: FAIL — `Cannot find module '@/domain/attachment-validation'`.

- [ ] **Step 3: Implement**

Create `src/domain/attachment-validation.ts`:

```ts
/** 03-business-rules.md §9: 25 MB per file, hard limit, no aggregate cap in v1. */
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

/** 03-business-rules.md §9: PDF, DOCX, XLSX, PPTX, JPG/JPEG, PNG, HEIC, TXT. */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/heic",
  "text/plain",
] as const;

export interface AttachmentCandidate {
  mimeType: string | null;
  sizeBytes: number;
}

export type AttachmentValidationResult =
  | { valid: true }
  | { valid: false; reason: "type" | "size" };

/**
 * Type is checked before size (03-business-rules.md §9 lists type first) —
 * order matters only for which single `reason` a doubly-invalid file
 * reports, not for the pass/fail outcome.
 */
export function validateAttachment(candidate: AttachmentCandidate): AttachmentValidationResult {
  const isAllowedType =
    candidate.mimeType !== null &&
    (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(candidate.mimeType);
  if (!isAllowedType) {
    return { valid: false, reason: "type" };
  }
  if (candidate.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    return { valid: false, reason: "size" };
  }
  return { valid: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/domain/__tests__/attachment-validation.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check src/domain/attachment-validation.ts src/domain/__tests__/attachment-validation.test.ts
```

Expected: all clean. If prettier fails, run `npx prettier --write src/domain/attachment-validation.ts src/domain/__tests__/attachment-validation.test.ts` and re-check.

- [ ] **Step 6: Commit**

```bash
git add src/domain/attachment-validation.ts src/domain/__tests__/attachment-validation.test.ts
git commit -m "feat: add attachment type/size validation (TDD)"
```

---

### Task 3: Attachment repository (TDD)

**Files:**
- Create: `src/db/repositories/attachment.ts`
- Create: `src/db/repositories/__tests__/attachment.test.ts`

**Interfaces:**
- Consumes: `assertTaskEditable` from `@/db/repositories/task-access` (Phase 4 extraction); `validateAttachment` from `@/domain/attachment-validation` (Task 2); `getFileSizeBytes`, `copyIntoAttachmentStorage`, `deleteAttachmentFile`, `deleteAttachmentDirectoryForTask`, `type PickedDocument` from `@/lib/files` (Task 1 — reused directly, not re-declared, since it's structurally exactly what this repository needs from a picked file); `attachments`, `type Attachment` from `@/db/schema/attachment` (exists since Phase 1); `type Database` from `@/db/repositories/semester`.
- Produces: `addAttachment(taskId: string, picked: PickedDocument, database?: Database): Promise<Attachment>`, `removeAttachment(id: string, database?: Database): Promise<void>`, `deleteAttachmentFilesForTask(taskId: string, database?: Database): Promise<void>`, `AttachmentValidationError` (class, `.reason: "type" | "size"`) — all from `@/db/repositories/attachment`. `deleteAttachmentFilesForTask` is consumed by Task 4 (`task.ts`'s `deleteTask`, `subject.ts`'s `deleteSubject` cascade).

Check the existing test file `src/db/repositories/__tests__/reminder.test.ts` before writing this task's tests — copy its exact `jest.mock("@/lib/notifications")` / seed-helper / in-memory-db setup pattern, substituting `@/lib/files` and the `attachments` table.

- [ ] **Step 1: Write the failing tests**

Create `src/db/repositories/__tests__/attachment.test.ts`. This mirrors `src/db/repositories/__tests__/reminder.test.ts`'s exact structure — same `freshTestDb()` helper (a fresh `better-sqlite3` in-memory DB per test, migrated, with `foreign_keys = ON`), same `seedTaskInActiveSemester(db, dueDateTime)` seed helper (creates an active semester + subject + task, returns `{ semesterId, task }`), same "close the semester mid-test" technique (`await db.update(semesters).set({ status: "closed", closedAt: new Date() });` — no separate closed-semester seed helper exists), same per-test `const db = freshTestDb();` (not a shared `beforeEach`-scoped `db`), and `SemesterReadOnlyError` imported from `@/db/repositories/subject` (its established re-export point, already used by every other repository test file):

```ts
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { attachments } from "@/db/schema/attachment";
import { createTask } from "@/db/repositories/task";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import {
  addAttachment,
  AttachmentValidationError,
  deleteAttachmentFilesForTask,
  removeAttachment,
} from "@/db/repositories/attachment";
import * as files from "@/lib/files";

jest.mock("@/lib/files");
const mockedFiles = jest.mocked(files);

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFiles.getFileSizeBytes.mockReturnValue(1024);
  mockedFiles.copyIntoAttachmentStorage.mockResolvedValue({
    storedPath: "/fake/attachments/task-1/attachment-1-file.pdf",
  });
});

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
  const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  const { task } = await createTask(
    { title: "Tarea", subjectId, dueDateTime, priority: "Media" },
    db,
  );
  return { semesterId, task };
}

const VALID_PICKED = { uri: "content://picked/file.pdf", name: "notas.pdf", mimeType: "application/pdf" };

describe("addAttachment", () => {
  it("validates, copies, and inserts a row for a valid file", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);

    const attachment = await addAttachment(task.id, VALID_PICKED, db);

    expect(attachment.originalFileName).toBe("notas.pdf");
    expect(attachment.mimeType).toBe("application/pdf");
    expect(attachment.sizeBytes).toBe(1024);
    expect(mockedFiles.copyIntoAttachmentStorage).toHaveBeenCalledWith(
      VALID_PICKED.uri,
      task.id,
      attachment.id,
      "notas.pdf",
    );
    const rows = await db.select().from(attachments).where(eq(attachments.id, attachment.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects an oversized file without copying it", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    mockedFiles.getFileSizeBytes.mockReturnValue(26 * 1024 * 1024);

    await expect(
      addAttachment(task.id, { ...VALID_PICKED, name: "big.pdf" }, db),
    ).rejects.toThrow(AttachmentValidationError);
    expect(mockedFiles.copyIntoAttachmentStorage).not.toHaveBeenCalled();
  });

  it("rejects a disallowed type without copying it", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);

    await expect(
      addAttachment(
        task.id,
        { uri: "content://picked/archive.zip", name: "archive.zip", mimeType: "application/zip" },
        db,
      ),
    ).rejects.toThrow(AttachmentValidationError);
    expect(mockedFiles.copyIntoAttachmentStorage).not.toHaveBeenCalled();
  });

  it("throws SemesterReadOnlyError on a closed semester, without copying", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(addAttachment(task.id, VALID_PICKED, db)).rejects.toThrow(SemesterReadOnlyError);
    expect(mockedFiles.copyIntoAttachmentStorage).not.toHaveBeenCalled();
  });

  it("inserts no DB row when the copy fails (atomicity)", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    mockedFiles.copyIntoAttachmentStorage.mockRejectedValue(new Error("disk full"));

    await expect(addAttachment(task.id, VALID_PICKED, db)).rejects.toThrow("disk full");

    const rows = await db.select().from(attachments).where(eq(attachments.taskId, task.id));
    expect(rows).toHaveLength(0);
  });
});

describe("removeAttachment", () => {
  it("deletes the file and the row", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const attachment = await addAttachment(task.id, VALID_PICKED, db);

    await removeAttachment(attachment.id, db);

    expect(mockedFiles.deleteAttachmentFile).toHaveBeenCalledWith(attachment.storedPath);
    const rows = await db.select().from(attachments).where(eq(attachments.id, attachment.id));
    expect(rows).toHaveLength(0);
  });

  it("throws on a closed semester, without deleting the file", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const attachment = await addAttachment(task.id, VALID_PICKED, db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });
    mockedFiles.deleteAttachmentFile.mockClear();

    await expect(removeAttachment(attachment.id, db)).rejects.toThrow(SemesterReadOnlyError);
    expect(mockedFiles.deleteAttachmentFile).not.toHaveBeenCalled();
  });

  it("throws a not-found error for a nonexistent id", async () => {
    const db = freshTestDb();
    await expect(removeAttachment("nonexistent-id", db)).rejects.toThrow("Attachment not found");
  });
});

describe("deleteAttachmentFilesForTask", () => {
  it("deletes the task's attachment directory", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);

    await deleteAttachmentFilesForTask(task.id, db);

    expect(mockedFiles.deleteAttachmentDirectoryForTask).toHaveBeenCalledWith(task.id);
  });

  it("throws on a closed semester, without deleting", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(deleteAttachmentFilesForTask(task.id, db)).rejects.toThrow(SemesterReadOnlyError);
    expect(mockedFiles.deleteAttachmentDirectoryForTask).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/db/repositories/__tests__/attachment.test.ts
```

Expected: FAIL — `Cannot find module '@/db/repositories/attachment'`.

- [ ] **Step 3: Implement**

Create `src/db/repositories/attachment.ts`:

```ts
import { randomUUID } from "expo-crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { assertTaskEditable } from "@/db/repositories/task-access";
import { attachments, type Attachment } from "@/db/schema/attachment";
import { validateAttachment } from "@/domain/attachment-validation";
import {
  copyIntoAttachmentStorage,
  deleteAttachmentDirectoryForTask,
  deleteAttachmentFile,
  getFileSizeBytes,
  type PickedDocument,
} from "@/lib/files";

export class AttachmentValidationError extends Error {
  constructor(public reason: "type" | "size") {
    super(
      reason === "size"
        ? "El archivo supera el tamaño máximo permitido (25 MB)."
        : "Tipo de archivo no permitido.",
    );
    this.name = "AttachmentValidationError";
  }
}

export async function addAttachment(
  taskId: string,
  picked: PickedDocument,
  database: Database = defaultDb,
): Promise<Attachment> {
  await assertTaskEditable(taskId, database);

  const sizeBytes = getFileSizeBytes(picked.uri);
  const validation = validateAttachment({ mimeType: picked.mimeType, sizeBytes });
  if (!validation.valid) {
    throw new AttachmentValidationError(validation.reason);
  }

  const id = randomUUID();
  const { storedPath } = await copyIntoAttachmentStorage(picked.uri, taskId, id, picked.name);

  const newAttachment: typeof attachments.$inferInsert = {
    id,
    taskId,
    originalFileName: picked.name,
    storedPath,
    mimeType: picked.mimeType as string, // validated non-null above (invalid type would have thrown)
    sizeBytes,
    createdAt: new Date(),
  };
  await database.insert(attachments).values(newAttachment);
  return newAttachment as Attachment;
}

async function getAttachmentOrThrow(id: string, database: Database) {
  const rows = await database.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  const attachment = rows[0];
  if (!attachment) throw new Error(`Attachment not found: ${id}`);
  return attachment;
}

export async function removeAttachment(id: string, database: Database = defaultDb): Promise<void> {
  const attachment = await getAttachmentOrThrow(id, database);
  await assertTaskEditable(attachment.taskId, database);

  deleteAttachmentFile(attachment.storedPath);
  await database.delete(attachments).where(eq(attachments.id, id));
}

/**
 * Deletes every copied attachment file for a task in one call (its whole
 * attachment directory), WITHOUT touching the attachment rows themselves —
 * used by task deletion (rows cascade-delete via ON DELETE CASCADE a
 * moment later, Task 4) and by subject-deletion cascade (mirrors Phase 4
 * Task 4's cancelAllRemindersForTask), where the rows are about to
 * cascade-away too and only the on-disk bytes need explicit cleanup.
 */
export async function deleteAttachmentFilesForTask(
  taskId: string,
  database: Database = defaultDb,
): Promise<void> {
  await assertTaskEditable(taskId, database);
  deleteAttachmentDirectoryForTask(taskId);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/db/repositories/__tests__/attachment.test.ts
```

Expected: PASS, all tests (9 in the template above — adjust the exact count if you matched `reminder.test.ts`'s helper structure with more/fewer cases).

- [ ] **Step 5: Run the full combined check**

```bash
npm test
npx tsc --noEmit
npm run lint
npx prettier --check .
```

Expected: all clean, no regressions in any other suite.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/attachment.ts src/db/repositories/__tests__/attachment.test.ts
git commit -m "feat: add Attachment repository (TDD)"
```

---

### Task 4: Wire attachment cleanup into task/subject deletion (TDD)

**Files:**
- Modify: `src/db/repositories/task.ts`
- Modify: `src/db/repositories/subject.ts`
- Modify: `src/db/repositories/__tests__/task.test.ts`
- Modify: `src/db/repositories/__tests__/subject.test.ts`

**Interfaces:**
- Consumes: `deleteAttachmentFilesForTask` from `@/db/repositories/attachment` (Task 3).
- Produces: nothing new — `deleteTask`/`deleteSubject`'s existing signatures are unchanged, only their bodies gain a call.

- [ ] **Step 1: Write the failing tests**

In `src/db/repositories/__tests__/task.test.ts`, find the existing `jest.mock("@/lib/notifications")` line (around line 21) and add right next to it:

```ts
jest.mock("@/lib/files");
```

Add the import `import * as files from "@/lib/files";` alongside the existing `import * as notifications from "@/lib/notifications";`, and `const mockedFiles = jest.mocked(files);` alongside `const mockedNotifications = jest.mocked(notifications);`. No new `beforeEach` mock setup is needed for `mockedFiles` — `deleteAttachmentDirectoryForTask` is a `void`-returning mock and jest's auto-mock already returns `undefined`, matching how this file's own `mockedNotifications.cancelReminderNotification` needs an explicit `.mockResolvedValue(undefined)` (async) but a sync void mock does not.

Find this file's `describe("deleteTask", ...)` block (uses `seedActiveSemesterWithSubject(db)`, which returns `{ subjectId }`) and add:

```ts
it("deletes the task's attachment files", async () => {
  const db = freshTestDb();
  const { subjectId } = await seedActiveSemesterWithSubject(db);
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  const { task } = await createTask(
    { title: "Con adjunto", subjectId, dueDateTime: future, priority: "Media" },
    db,
  );

  await deleteTask(task.id, db);

  expect(mockedFiles.deleteAttachmentDirectoryForTask).toHaveBeenCalledWith(task.id);
});
```

In `src/db/repositories/__tests__/subject.test.ts`, find the existing `jest.mock("@/lib/notifications")` line (around line 21, added for the Phase 4 Task 4 cascade-cancellation test) and add `jest.mock("@/lib/files")` + the same `mockedFiles` import/mock pattern as above. Find the existing test `"cancels pending reminder notifications for tasks a subject-deletion cascade removes"` (around line 161 — seeds a Vencida task directly via `db.insert(tasks).values(...)` plus a pending reminder via `db.insert(reminders).values(...)`, then calls `deleteSubject`) and add a sibling test reusing the identical Vencida-task fixture, with an attachment row instead of a reminder row:

```ts
it("deletes attachment files for tasks a subject-deletion cascade removes", async () => {
  const db = freshTestDb();
  const semesterId = await seedActiveSemester(db);
  const subject = await createSubject({ name: "Física", color: "sky", semesterId }, db);

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
  await db.insert(attachments).values({
    id: "attachment-1",
    taskId: "task-vencida",
    originalFileName: "notas.pdf",
    storedPath: "/fake/attachments/task-vencida/attachment-1-notas.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    createdAt: new Date(),
  });

  await deleteSubject(subject.id, db);

  expect(mockedFiles.deleteAttachmentDirectoryForTask).toHaveBeenCalledWith("task-vencida");
});
```

Add `import { attachments } from "@/db/schema/attachment";` to this file's import block if not already present (`reminders` is already imported there for the sibling test above — add `attachments` the same way).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/db/repositories/__tests__/task.test.ts src/db/repositories/__tests__/subject.test.ts
```

Expected: FAIL — the two new assertions fail (`deleteAttachmentDirectoryForTask` never called), everything else in both files still passes.

- [ ] **Step 3: Implement — `task.ts`**

In `src/db/repositories/task.ts`, add to the import block:

```ts
import { deleteAttachmentFilesForTask } from "@/db/repositories/attachment";
```

Change `deleteTask`:

```ts
export async function deleteTask(id: string, database: Database = defaultDb): Promise<void> {
  await assertTaskEditable(id, database);

  // Cancel pending OS notifications before the cascade-delete removes the
  // reminder rows themselves — cancelAllRemindersForTask needs the rows
  // to still exist to know their notificationIds.
  await cancelAllRemindersForTask(id, database);

  // Delete copied attachment files before the cascade-delete removes the
  // attachment rows themselves — same ordering reason as reminders above.
  await deleteAttachmentFilesForTask(id, database);

  // Subtasks, reminders, and attachments cascade-delete automatically via
  // ON DELETE CASCADE (Phase 1 schema) now that PRAGMA foreign_keys=ON is
  // active on-device (Phase 2 Task 1) — no manual row cleanup needed here.
  await database.delete(tasks).where(eq(tasks.id, id));
}
```

- [ ] **Step 4: Implement — `subject.ts`**

In `src/db/repositories/subject.ts`, add to the import block:

```ts
import { deleteAttachmentFilesForTask } from "@/db/repositories/attachment";
```

Change the cascade-cleanup loop inside `deleteSubject`:

```ts
  // Cancel pending OS notifications and delete attachment files for every
  // task this deletion cascades away, BEFORE the cascade-delete removes
  // their reminder/attachment rows. A task here can be Vencida (overdue
  // but incomplete), which can still have a live pending reminder or
  // attachment files — only Completada tasks are guaranteed to have
  // already had reminders cancelled, via completeTaskAction.
  for (const taskId of check.cascadeDeleteTaskIds ?? []) {
    await cancelAllRemindersForTask(taskId, database);
    await deleteAttachmentFilesForTask(taskId, database);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx jest src/db/repositories/__tests__/task.test.ts src/db/repositories/__tests__/subject.test.ts
```

Expected: PASS, all tests in both files.

- [ ] **Step 6: Run the full combined check**

```bash
npm test
npx tsc --noEmit
npm run lint
npx prettier --check .
```

Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories/task.ts src/db/repositories/subject.ts src/db/repositories/__tests__/task.test.ts src/db/repositories/__tests__/subject.test.ts
git commit -m "feat: clean up attachment files on task/subject deletion (TDD)"
```

---

### Task 5: `AttachmentList` component

**Files:**
- Create: `src/components/AttachmentList.tsx`

**Interfaces:**
- Consumes: `pickDocument`, `type PickedDocument` from `@/lib/files` (Task 1); `colors` from `@/theme`.
- Produces: `AttachmentList` (component), `formatFileSize(bytes: number): string`, `AttachmentListItem { id: string; originalFileName: string; sizeBytes: number; storedPath: string; mimeType: string }` — from `@/components/AttachmentList`. `onPick`/`onOpen`/`onRemove` callback props are wired to repository calls by the consuming screen (Task 6), matching `ReminderPicker`'s `onAdd` callback pattern — this component does no DB or repository I/O itself, only the native picker call.

- [ ] **Step 1: Write the component**

Create `src/components/AttachmentList.tsx`:

```tsx
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { pickDocument, type PickedDocument } from "@/lib/files";
import { colors } from "@/theme";

/** Human-readable file size, shared by every screen that lists attachments. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AttachmentListItem {
  id: string;
  originalFileName: string;
  sizeBytes: number;
  storedPath: string;
  mimeType: string;
}

export interface AttachmentListProps {
  attachments: AttachmentListItem[];
  busy: boolean;
  onPick: (picked: PickedDocument) => void;
  onOpen: (attachment: AttachmentListItem) => void;
  onRemove: (attachmentId: string) => void;
}

export function AttachmentList({ attachments, busy, onPick, onOpen, onRemove }: AttachmentListProps) {
  const [picking, setPicking] = useState(false);

  async function handlePickPress() {
    setPicking(true);
    try {
      const picked = await pickDocument();
      if (picked) onPick(picked);
    } finally {
      setPicking(false);
    }
  }

  return (
    <View style={styles.container}>
      {attachments.map((attachment) => (
        <View key={attachment.id} style={styles.row}>
          <TouchableOpacity
            style={styles.info}
            disabled={busy}
            onPress={() => onOpen(attachment)}
          >
            <Text style={styles.name} numberOfLines={1}>
              {attachment.originalFileName}
            </Text>
            <Text style={styles.size}>{formatFileSize(attachment.sizeBytes)}</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={() => onRemove(attachment.id)}>
            <Text style={styles.remove}>Quitar</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity
        style={styles.addButton}
        disabled={busy || picking}
        onPress={handlePickPress}
      >
        <Text style={styles.addButtonText}>
          {picking ? "Abriendo selector…" : "Añadir archivo"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, paddingVertical: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  info: { flex: 1, marginRight: 8 },
  name: { fontSize: 15, color: colors.text },
  size: { fontSize: 12, color: colors.textMuted },
  remove: { color: colors.danger, fontSize: 13, fontWeight: "600" },
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

- [ ] **Step 2: Verify TypeScript, lint, and prettier are clean**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check src/components/AttachmentList.tsx
```

Expected: all clean. No test run for this task (Global Constraints — no component unit tests in this codebase; verified on-device in Task 7).

- [ ] **Step 3: Commit**

```bash
git add src/components/AttachmentList.tsx
git commit -m "feat: add AttachmentList component"
```

---

### Task 6: Wire `AttachmentList` into the Task detail screen

**Files:**
- Modify: `app/tarea/[id]/index.tsx`

**Interfaces:**
- Consumes: `AttachmentList`, `type AttachmentListItem` from `@/components/AttachmentList` (Task 5); `addAttachment`, `removeAttachment`, `AttachmentValidationError` from `@/db/repositories/attachment` (Task 3); `openAttachment` from `@/lib/files` (Task 1); `attachments` schema from `@/db/schema/attachment`; `type PickedDocument` from `@/lib/files`.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add imports**

In `app/tarea/[id]/index.tsx`, add to the existing import block (alongside the Phase 4 reminder imports):

```ts
import { AttachmentList, type AttachmentListItem } from "@/components/AttachmentList";
import { addAttachment, AttachmentValidationError, removeAttachment } from "@/db/repositories/attachment";
import { attachments } from "@/db/schema/attachment";
import { openAttachment, type PickedDocument } from "@/lib/files";
```

- [ ] **Step 2: Add the `useLiveQuery` for attachments**

Right after the existing `taskReminders` derivation (`const taskReminders = reminderRows ?? [];`), add:

```ts
  const { data: attachmentRows } = useLiveQuery(
    db.select().from(attachments).where(eq(attachments.taskId, id)),
  );
  const taskAttachments = attachmentRows ?? [];
```

- [ ] **Step 3: Add the three handlers**

Right after the existing `handleRemoveReminder` function, add:

```ts
  async function handlePickAttachment(picked: PickedDocument) {
    setBusy(true);
    try {
      await addAttachment(id, picked);
    } catch (error) {
      if (error instanceof AttachmentValidationError) {
        Alert.alert(
          "Archivo no válido",
          error.reason === "size"
            ? "El archivo supera el tamaño máximo permitido (25 MB)."
            : "Ese tipo de archivo no está permitido.",
        );
      } else {
        handleActionError(error, "No se pudo añadir el archivo.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenAttachment(attachment: AttachmentListItem) {
    try {
      await openAttachment(attachment.storedPath, attachment.mimeType);
    } catch {
      Alert.alert("Error", "No se pudo abrir el archivo.");
    }
  }

  async function handleRemoveAttachment(attachmentId: string) {
    setBusy(true);
    try {
      await removeAttachment(attachmentId);
    } catch (error) {
      handleActionError(error, "No se pudo eliminar el archivo.");
    } finally {
      setBusy(false);
    }
  }
```

- [ ] **Step 4: Add the Adjuntos section to the JSX**

Right after the `<ReminderPicker onAdd={handleAddReminder} />` line and before the `<View style={styles.actions}>` block, add:

```tsx
      <Text style={styles.sectionTitle}>Adjuntos</Text>
      <AttachmentList
        attachments={taskAttachments}
        busy={busy}
        onPick={handlePickAttachment}
        onOpen={handleOpenAttachment}
        onRemove={handleRemoveAttachment}
      />
```

- [ ] **Step 5: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check "app/tarea/[id]/index.tsx"
```

Expected: all clean.

- [ ] **Step 6: Verify on a real Android emulator/device**

```bash
npx expo run:android
```

Expected walkthrough: open a task's detail screen, confirm the "Adjuntos" section renders (empty initially); tap "Añadir archivo", pick a small valid file (e.g. a PDF or PNG) from the system picker, confirm it appears in the list immediately with a correct size label; tap it, confirm the OS "open with" sheet appears; tap "Quitar", confirm it disappears from the list.

- [ ] **Step 7: Commit**

```bash
git add "app/tarea/[id]/index.tsx"
git commit -m "feat: wire attachments into Task detail screen"
```

---

### Task 7: Full Phase 5 Definition of Done verification

**Files:** none (verification-only task, matching Phase 4 Task 9's precedent).

**Interfaces:** none.

- [ ] **Step 1: Run the full combined check**

```bash
npm test
npx tsc --noEmit
npm run lint
npx prettier --check .
```

Expected: all green, no regressions in any suite from Phases 0-4.

- [ ] **Step 2: On-device walkthrough — happy path**

On the running emulator/device (rebuild via `npx expo run:android` first only if Task 6's build isn't still current):
1. Open an existing task's detail screen (or create one). Confirm the "Adjuntos" section is empty.
2. Tap "Añadir archivo", pick a small valid PDF (or PNG/JPG). Confirm it appears in the list with the correct filename and a human-readable size (e.g. "245.0 KB").
3. Tap the attachment. Confirm the Android "open with"/share sheet appears listing apps that can handle that MIME type.
4. Pick a second valid file of a different allowed type (e.g. a `.txt` file). Confirm both now appear in the list.

- [ ] **Step 3: On-device walkthrough — rejection paths**

1. Pick a disallowed file type (e.g. a `.zip` or `.apk` if one exists on the test device — or any type not in the allowed list). Confirm an "Archivo no válido" alert appears and NOTHING is added to the list.
2. Pull the on-device attachments directory to confirm no bytes were written for the rejected file:

```bash
adb exec-out run-as com.alejozd.unitask ls -la /data/data/com.alejozd.unitask/files/attachments/<taskId>/ 2>&1
```

Expected: only the 2 files from Step 2 are present, nothing from the rejected pick. (If no file over 25 MB is available on the test device/emulator to exercise the size-rejection path, note that explicitly in the report rather than fabricating a pass — this is an acceptable, disclosed gap, not something to skip silently.)

- [ ] **Step 4: On-device walkthrough — removal and cascade cleanup**

1. Tap "Quitar" on one of the 2 valid attachments from Step 2. Confirm it disappears from the list immediately.
2. Pull the directory again to confirm that specific file's bytes are gone but the other attachment's file remains:

```bash
adb exec-out run-as com.alejozd.unitask ls -la /data/data/com.alejozd.unitask/files/attachments/<taskId>/ 2>&1
```

3. Delete the whole task (via the existing "Eliminar tarea" button). Confirm the entire task's attachment directory is gone:

```bash
adb exec-out run-as com.alejozd.unitask ls -la /data/data/com.alejozd.unitask/files/attachments/<taskId>/ 2>&1
```

Expected: `No such file or directory` (zero orphaned bytes, matching `03-business-rules.md` §9's "no orphaned files" requirement).

- [ ] **Step 5: On-device walkthrough — closed-semester block**

1. Navigate to a task under a closed semester (or close the active semester on a task that has attachments, if the test data allows).
2. Confirm "Añadir archivo" and "Quitar" both surface the existing "Semestre cerrado" alert instead of silently succeeding or crashing.

- [ ] **Step 6: Write the Phase 5 DoD report**

Write `.superpowers/sdd/task-7-report.md` documenting the combined check output and each walkthrough step's actual result (pass/fail per step, not just an overall "it works") — check first whether a stale `task-7-report.md` from an earlier phase already exists at that path (a recurring issue in this project — Phase 3 Tasks 1/3, Phase 4 Tasks 1/7/9 all hit this) and overwrite it if so, never trust it unread. Explicitly note the atomicity partial-file cleanup's disclosed limitation (Global Constraints) — verified by code review only, not by a test or an on-device forced-failure — rather than silently omitting it or implying it was exercised.

- [ ] **Step 7: No commit expected**

This is a verification-only task (matching Phase 4 Task 9's precedent) — no commit unless Step 2-5 surface a real bug requiring a fix, in which case fix it, re-run the combined check, and commit the fix with a message describing what was found.
