# Sync Phase C — Client-Side Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the UniTask mobile app a working client-side half of multi-device sync — a local outbox of pending changes, `pushChanges()`/`pullChanges()`/`runSync()` against the already-deployed `unitask-sync-server` backend, attachment file upload/download, and UI to log in and trigger sync — so a user's data actually starts flowing between their devices.

**Architecture:** Every domain-mutating repository function enqueues a row into a new local `sync_log` table (a local outbox, keyed by `(entityTable, entityId)`, last-write-wins locally too) right after its own write succeeds. `pushChanges()` drains that outbox in batches to `POST /sync/push`. `pullChanges()` walks `GET /sync/pull?since=<cursor>` pages and applies each operation directly to the matching local table — bypassing the repository layer's `assertTaskEditable`/closed-semester checks, the same way Phase 9's `importBackup` already does for a full-system replace, because a pulled operation represents state another device already validated, not a fresh local edit. Reminders get their OS notification (re)scheduled as part of being applied; attachment metadata upserts/deletes drive a small file upload/download queue built on top of the same "which local attachment differs from what I know is synced" check, no separate queue table. Auth uses the already-deployed `/auth/*` endpoints; only the refresh token is persisted (in `expo-secure-store`, never in SQLite), the access token lives in memory and is re-derived via a refresh call on cold start.

**Tech Stack:** Expo SDK 57, `drizzle-orm/expo-sqlite` (app) / `drizzle-orm/better-sqlite3` (tests), `expo-secure-store` (new dependency), `expo-file-system`'s `File`/`Directory`/`File.createDownloadTask` APIs (already in use), `zod` (already a dependency, used here to validate the pull response shape), Jest via the `jest-expo` preset.

## Global Constraints

- Server contract (already implemented, deployed, and security-hardened at `https://unitask-sync.zdevs.uk` — see `docs/superpowers/plans/2026-09-12-sync-phaseA-backend-auth.md` and `2026-09-13-sync-phaseB-push-pull-attachments.md`):
  - `POST /auth/register {email,password}` → `201 {ok:true}` \| `409`
  - `POST /auth/login {email,password}` → `200 {accessToken,refreshToken}` \| `401`
  - `POST /auth/refresh {refreshToken}` → `200 {accessToken,refreshToken}` (rotated) \| `401`
  - `POST /auth/logout {refreshToken}` → `200 {ok:true}`
  - `POST /sync/push {operations:[{table,entityId,operation:"upsert"|"delete",payload,clientUpdatedAt}]}` (Bearer) → `200 {accepted:string[],rejected:string[]}` (keys are `` `${table}:${entityId}` ``) \| `400`
  - `GET /sync/pull?since=<cursor>` (Bearer) → `200 {operations:[...],cursor:number}`, max 500 rows/page — keep calling with the returned `cursor` until `operations` comes back empty \| `400`
  - `POST /sync/attachments/:attachmentId` (Bearer, multipart, field name `file`) → `200 {ok:true}` \| `400`/`404`/`413` (>25MB)
  - `GET /sync/attachments/:attachmentId` (Bearer) → file stream \| `404`
  - `table`/`entityId` must never contain `:` — the server rejects it with `400` (it's the key separator).
- **SQLite ALTER TABLE limitation, a deliberate scope decision:** SQLite cannot add a `NOT NULL` column to a non-empty table without a full table rebuild, which this plan does not do. Every new `updatedAt`/`createdAt` column added by Task 1 is **nullable**. Every write path touched by Task 3 always sets a real value going forward; anything reading a timestamp for sync purposes falls back with `row.updatedAt ?? row.createdAt ?? <Date.now() at first sync>` (see Task 2's `resolveSyncTimestamp`). This means a row that predates this phase and is never edited again gets treated as "changed right now" the first time it's ever synced — harmless (the server has never seen it either way), not a hidden risk.
- **Sync only covers `semesters`, `subjects`, `tasks`, `subtasks`, `reminders`, `attachments`.** The `settings` (profile) table is explicitly **not synced** in this phase — `syncEmail`/`syncCursor`/`lastSyncAt` added to it are pure local device state about sync itself, never pushed. Syncing the nickname/profile across devices is a plausible fast-follow, not part of this phase.
- **Transactions in this codebase must use a synchronous callback** (`database.transaction((tx) => { tx.insert(...).run(); })`) — both SQLite drivers behind the shared `Database` type reject an `async` transaction callback. Every code sample in this plan that touches an existing transaction respects this; new code never wraps `enqueueChange`'s own write in the domain write's transaction (kept as a plain awaited follow-up call instead, matching the "one-line hook" framing and avoiding this constraint entirely for the sync_log write itself).
- **Pulled operations are applied directly to the schema tables**, never through `createTask`/`addReminder`/etc. — same reasoning `src/domain/backup.ts` + `src/db/repositories/backup.ts` already established for `importBackup`: this is already-validated remote state, not a fresh edit, so `assertTaskEditable`/`SemesterReadOnlyError` must not block it.
- **A subject or task delete cascades in local SQLite via `ON DELETE CASCADE`**, which is invisible to the sync outbox unless explicitly walked — `deleteTask`/`deleteSubject`'s hooks must enqueue a `delete` for every cascaded child row (subtasks, reminders, attachments), not just the row being deleted directly.
- `expo-secure-store` install: `npx expo install expo-secure-store` (resolves to `~57.0.4`, matching the SDK 57 floor already used by every other `expo-*` dependency in `package.json`). No `app.json` config-plugin entry is needed — the plugin only configures biometric (`requireAuthentication`) and iOS keychain-sharing options, neither of which this phase uses (same "skip the plugin, no options needed" call already made for `expo-sharing` in Phase 5).
- `expo-secure-store` key names may only contain alphanumeric characters, `.`, `-`, `_` — the one key this plan uses (`unitask-refresh-token`) already satisfies this.
- No lint/typecheck npm script beyond `npm run lint` (`expo lint`) and `npm test` (jest) exists in this repo — verification after each task is `npm test` + `npm run lint` on touched files only (matches this project's established convention; there is no repo-wide `tsc --noEmit` script, but `npx tsc --noEmit` is safe to run manually to catch type errors this plan's own review misses).
- Every new/modified repository or `lib/sync` function that touches the DB takes `database: Database = defaultDb` as its last parameter (`Database` imported from `@/db/repositories/semester`), matching every existing repository function — this is the injection point every test in this plan uses (real `better-sqlite3` in-memory DB + `migrate(db, {migrationsFolder: "src/db/migrations"})`, never a mock DB).
- `src/lib/sync/` follows the established `src/lib/notifications/`, `src/lib/files/` convention: flat files (no sub-folders), named exports only, custom `Error` subclasses for distinguishable failure modes.

---

### Task 1: Schema migration — sync_log table + updatedAt/createdAt backfill columns

**Files:**
- Create: `src/db/schema/sync-log.ts`
- Modify: `src/db/schema/semester.ts`
- Modify: `src/db/schema/subtask.ts`
- Modify: `src/db/schema/reminder.ts`
- Modify: `src/db/schema/attachment.ts`
- Modify: `src/db/schema/settings.ts`
- Modify: `src/db/schema/index.ts`
- Create: `src/db/migrations/0002_*.sql` (generated — exact filename assigned by drizzle-kit)
- Test: `src/db/repositories/__tests__/sync-log-schema.test.ts`

**Interfaces:**
- Produces: `syncLog` (Drizzle table), `SyncLogEntry = typeof syncLog.$inferSelect`, `NewSyncLogEntry = typeof syncLog.$inferInsert` — columns `entityTable: string`, `entityId: string`, `operation: "upsert" | "delete"`, `updatedAt: Date`, composite primary key `(entityTable, entityId)`.
- Produces (new nullable columns, per Global Constraints): `semesters.updatedAt: Date | null`, `subtasks.createdAt: Date | null`, `subtasks.updatedAt: Date | null`, `reminders.updatedAt: Date | null`, `attachments.updatedAt: Date | null`, `attachments.syncedAt: Date | null` (null = file not yet uploaded to the server), `settings.syncEmail: string | null`, `settings.syncCursor: number | null`, `settings.lastSyncAt: Date | null`.

- [ ] **Step 1: Write the failing test**

Create `src/db/repositories/__tests__/sync-log-schema.test.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { syncLog } from "@/db/schema/sync-log";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("sync_log schema", () => {
  it("inserts and reads back a sync_log row", async () => {
    const db = freshTestDb();
    await db.insert(syncLog).values({
      entityTable: "tasks",
      entityId: "task-1",
      operation: "upsert",
      updatedAt: new Date(1000),
    });

    const rows = await db.select().from(syncLog).where(eq(syncLog.entityId, "task-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe("upsert");
  });

  it("replaces the existing row for the same (entityTable, entityId) instead of duplicating", async () => {
    const db = freshTestDb();
    await db.insert(syncLog).values({
      entityTable: "tasks",
      entityId: "task-2",
      operation: "upsert",
      updatedAt: new Date(1000),
    });
    await db
      .insert(syncLog)
      .values({ entityTable: "tasks", entityId: "task-2", operation: "delete", updatedAt: new Date(2000) })
      .onConflictDoUpdate({
        target: [syncLog.entityTable, syncLog.entityId],
        set: { operation: "delete", updatedAt: new Date(2000) },
      });

    const rows = await db.select().from(syncLog).where(eq(syncLog.entityId, "task-2"));
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe("delete");
  });

  it("allows the new backfill columns to be null on existing tables", async () => {
    const db = freshTestDb();
    const { semesters } = schema;
    await db.insert(semesters).values({
      id: "sem-1",
      label: "2026-1",
      status: "active",
      createdAt: new Date(1000),
      // updatedAt intentionally omitted — must be a legal null.
    });
    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-1"));
    expect(rows[0].updatedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest sync-log-schema.test.ts`
Expected: FAIL — `Cannot find module '@/db/schema/sync-log'`.

- [ ] **Step 3: Add the new schema files/columns**

Create `src/db/schema/sync-log.ts`:

```typescript
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// A local outbox of pending changes to push, keyed by (entityTable, entityId) —
// last write locally wins here too, exactly like the server's own `entities`
// table. `operation: "delete"` is recorded explicitly because the domain row
// itself is already gone by the time this gets pushed — there is nothing left
// to re-read a payload from at push time (see src/lib/sync/queue.ts).
export const syncLog = sqliteTable(
  "sync_log",
  {
    entityTable: text("entity_table").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation", { enum: ["upsert", "delete"] }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityTable, table.entityId] })],
);

export type SyncLogEntry = typeof syncLog.$inferSelect;
export type NewSyncLogEntry = typeof syncLog.$inferInsert;
```

Modify `src/db/schema/semester.ts` — add one line:

```typescript
export const semesters = sqliteTable("semesters", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  status: text("status", { enum: SEMESTER_STATUSES }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  closedAt: integer("closed_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});
```

Modify `src/db/schema/subtask.ts` — add two lines:

```typescript
export const subtasks = sqliteTable("subtasks", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  order: integer("order").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});
```

Modify `src/db/schema/reminder.ts` — add one line after `createdAt`:

```typescript
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});
```

Modify `src/db/schema/attachment.ts` — add two lines after `createdAt`:

```typescript
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
  // Phase C: null means this file has never been uploaded to the sync server.
  syncedAt: integer("synced_at", { mode: "timestamp" }),
});
```

Modify `src/db/schema/settings.ts` — add three lines:

```typescript
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  nickname: text("nickname"),
  fullName: text("full_name"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  // Phase C — local-only sync device state, never pushed/pulled itself.
  // Null syncEmail means this device has no linked sync account yet.
  syncEmail: text("sync_email"),
  syncCursor: integer("sync_cursor"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
});
```

Modify `src/db/schema/index.ts` — add one line:

```typescript
export * from "./semester";
export * from "./subject";
export * from "./task";
export * from "./subtask";
export * from "./reminder";
export * from "./attachment";
export * from "./settings";
export * from "./sync-log";
```

- [ ] **Step 4: Generate and verify the migration**

Run: `npx drizzle-kit generate`
Expected: creates `src/db/migrations/0002_<name>.sql` containing `CREATE TABLE "sync_log" (...)` with the composite primary key, plus 6 `ALTER TABLE ... ADD COLUMN` statements (all nullable — drizzle-kit will not prompt for a default since none of the new columns are `NOT NULL`). Open the generated file and confirm no column in it says `NOT NULL` — if drizzle-kit did add `NOT NULL` anywhere, the corresponding schema line above is missing its nullable form; fix the schema and regenerate.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest sync-log-schema.test.ts`
Expected: PASS (3/3)

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS, all suites green (existing repository tests never set the new nullable columns, so they're unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/ src/db/migrations/ src/db/repositories/__tests__/sync-log-schema.test.ts
git commit -m "feat(sync): add sync_log table and nullable sync timestamp columns"
```

---

### Task 2: `src/lib/sync/queue.ts` — the local outbox

**Files:**
- Create: `src/lib/sync/queue.ts`
- Test: `src/lib/sync/__tests__/queue.test.ts`

**Interfaces:**
- Consumes: `syncLog`, `type SyncLogEntry` from `@/db/schema/sync-log`; `type Database` from `@/db/repositories/semester`.
- Produces: `resolveSyncTimestamp(row: {updatedAt: Date | null; createdAt: Date | null}): Date`; `enqueueChange(table: string, entityId: string, operation: "upsert" | "delete", database?: Database): Promise<void>`; `enqueueCascadeDeleteForTask(taskId: string, database?: Database): Promise<void>`; `getPendingChanges(database?: Database): Promise<SyncLogEntry[]>`; `clearPendingChanges(keys: string[], database?: Database): Promise<void>` (keys are `` `${table}:${entityId}` ``).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/sync/__tests__/queue.test.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { subtasks } from "@/db/schema/subtask";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import { tasks } from "@/db/schema/task";
import {
  resolveSyncTimestamp,
  enqueueChange,
  enqueueCascadeDeleteForTask,
  getPendingChanges,
  clearPendingChanges,
} from "../queue";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("resolveSyncTimestamp", () => {
  it("prefers updatedAt when present", () => {
    expect(resolveSyncTimestamp({ updatedAt: new Date(2000), createdAt: new Date(1000) })).toEqual(
      new Date(2000),
    );
  });

  it("falls back to createdAt when updatedAt is null", () => {
    expect(resolveSyncTimestamp({ updatedAt: null, createdAt: new Date(1000) })).toEqual(new Date(1000));
  });

  it("falls back to the current time when both are null", () => {
    const before = Date.now();
    const result = resolveSyncTimestamp({ updatedAt: null, createdAt: null });
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("enqueueChange / getPendingChanges / clearPendingChanges", () => {
  it("records a new pending change", async () => {
    const db = freshTestDb();
    await enqueueChange("tasks", "task-1", "upsert", db);

    const pending = await getPendingChanges(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ entityTable: "tasks", entityId: "task-1", operation: "upsert" });
  });

  it("replaces the pending entry for the same entity instead of duplicating", async () => {
    const db = freshTestDb();
    await enqueueChange("tasks", "task-2", "upsert", db);
    await enqueueChange("tasks", "task-2", "delete", db);

    const pending = await getPendingChanges(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("delete");
  });

  it("clearPendingChanges removes only the given keys", async () => {
    const db = freshTestDb();
    await enqueueChange("tasks", "task-3", "upsert", db);
    await enqueueChange("tasks", "task-4", "upsert", db);

    await clearPendingChanges(["tasks:task-3"], db);

    const pending = await getPendingChanges(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].entityId).toBe("task-4");
  });
});

describe("enqueueCascadeDeleteForTask", () => {
  it("enqueues a delete for the task and every one of its subtasks/reminders/attachments", async () => {
    const db = freshTestDb();
    await db.insert(subtasks).values({ id: "st-1", taskId: "task-5", text: "x", completed: false, order: 0 });
    await db.insert(reminders).values({
      id: "rem-1",
      taskId: "task-5",
      kind: "fixed",
      offsetValue: null,
      offsetUnit: null,
      fixedDateTime: new Date(5000),
      computedFireAt: new Date(5000),
      notificationId: null,
      createdAt: new Date(1000),
    });
    await db.insert(attachments).values({
      id: "att-1",
      taskId: "task-5",
      originalFileName: "a.pdf",
      storedPath: "/x/a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      createdAt: new Date(1000),
    });

    await enqueueCascadeDeleteForTask("task-5", db);

    const pending = await getPendingChanges(db);
    const keys = pending.map((p) => `${p.entityTable}:${p.entityId}`).sort();
    expect(keys).toEqual(["attachments:att-1", "reminders:rem-1", "subtasks:st-1", "tasks:task-5"].sort());
    expect(pending.every((p) => p.operation === "delete")).toBe(true);
  });

  it("still enqueues the task delete even when it has no children", async () => {
    const db = freshTestDb();
    await enqueueCascadeDeleteForTask("task-6", db);
    const pending = await getPendingChanges(db);
    expect(pending).toEqual([expect.objectContaining({ entityTable: "tasks", entityId: "task-6" })]);
  });
});
```

Note: this test file imports `tasks` but does not insert into it — `enqueueCascadeDeleteForTask` reads children by `taskId` directly, it does not require the parent `tasks` row to exist (the caller always has a real task, this just keeps the test focused). Remove the unused `tasks` import if your editor flags it, or insert a matching task row per test — either is fine; the plan's own Step 3 implementation does not read the `tasks` table.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest queue.test.ts`
Expected: FAIL — `Cannot find module '../queue'`

- [ ] **Step 3: Implement the queue**

Create `src/lib/sync/queue.ts`:

```typescript
import { eq, inArray } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { syncLog, type SyncLogEntry } from "@/db/schema/sync-log";
import { subtasks } from "@/db/schema/subtask";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";

/**
 * Every domain table's `updatedAt` was added as nullable (Task 1's schema
 * migration, per this plan's Global Constraints — SQLite can't add a NOT
 * NULL column to a non-empty table). A row from before this phase, or one
 * whose write path hasn't been touched yet, may have neither timestamp.
 */
export function resolveSyncTimestamp(row: { updatedAt: Date | null; createdAt: Date | null }): Date {
  return row.updatedAt ?? row.createdAt ?? new Date();
}

export async function enqueueChange(
  table: string,
  entityId: string,
  operation: "upsert" | "delete",
  database: Database = defaultDb,
): Promise<void> {
  await database
    .insert(syncLog)
    .values({ entityTable: table, entityId, operation, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [syncLog.entityTable, syncLog.entityId],
      set: { operation, updatedAt: new Date() },
    });
}

/**
 * A subject/task delete cascades to subtasks/reminders/attachments via
 * ON DELETE CASCADE at the SQLite level — invisible to the sync outbox
 * unless walked explicitly. Reads the current children BEFORE the caller
 * performs the actual delete (the rows must still exist to enumerate).
 */
export async function enqueueCascadeDeleteForTask(
  taskId: string,
  database: Database = defaultDb,
): Promise<void> {
  const [subtaskRows, reminderRows, attachmentRows] = await Promise.all([
    database.select({ id: subtasks.id }).from(subtasks).where(eq(subtasks.taskId, taskId)),
    database.select({ id: reminders.id }).from(reminders).where(eq(reminders.taskId, taskId)),
    database.select({ id: attachments.id }).from(attachments).where(eq(attachments.taskId, taskId)),
  ]);

  for (const { id } of subtaskRows) {
    await enqueueChange("subtasks", id, "delete", database);
  }
  for (const { id } of reminderRows) {
    await enqueueChange("reminders", id, "delete", database);
  }
  for (const { id } of attachmentRows) {
    await enqueueChange("attachments", id, "delete", database);
  }
  await enqueueChange("tasks", taskId, "delete", database);
}

export async function getPendingChanges(database: Database = defaultDb): Promise<SyncLogEntry[]> {
  return database.select().from(syncLog);
}

export async function clearPendingChanges(
  keys: string[],
  database: Database = defaultDb,
): Promise<void> {
  if (keys.length === 0) return;
  const pairs = keys.map((key) => {
    const separatorIndex = key.indexOf(":");
    return { table: key.slice(0, separatorIndex), entityId: key.slice(separatorIndex + 1) };
  });
  const byTable = new Map<string, string[]>();
  for (const { table, entityId } of pairs) {
    byTable.set(table, [...(byTable.get(table) ?? []), entityId]);
  }
  for (const [table, entityIds] of byTable) {
    await database
      .delete(syncLog)
      .where(inArray(syncLog.entityId, entityIds) && eq(syncLog.entityTable, table));
  }
}
```

**Note (found in review, fix before Step 4):** `inArray(syncLog.entityId, entityIds) && eq(syncLog.entityTable, table)` uses JS's `&&` operator, not Drizzle's `and()` — this does NOT combine the two conditions into one SQL `WHERE`; it evaluates `inArray(...)` (a truthy SQL fragment object) and discards it, passing only the last expression to `.where()`. Import `and` from `"drizzle-orm"` and write `.where(and(inArray(syncLog.entityId, entityIds), eq(syncLog.entityTable, table)))` instead. The test in Step 1 (`clearPendingChanges removes only the given keys`) passes either way at 1 row per table, so it does not catch this on its own — this note exists precisely so the implementer doesn't ship the buggy version just because the given test happens to pass.

- [ ] **Step 4: Fix the `and()` bug, then run tests to verify they pass**

Apply the fix from the note above, then:

Run: `npx jest queue.test.ts`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/queue.ts src/lib/sync/__tests__/queue.test.ts
git commit -m "feat(sync): add local sync outbox (queue.ts)"
```

---

### Task 3: Hook the 17 repository write functions into the outbox

**Files:**
- Modify: `src/db/repositories/semester.ts`
- Modify: `src/db/repositories/subject.ts`
- Modify: `src/db/repositories/task.ts`
- Modify: `src/db/repositories/subtask.ts`
- Modify: `src/db/repositories/reminder.ts`
- Modify: `src/db/repositories/attachment.ts`
- Modify (tests): the existing `__tests__` file next to each repository above.

**Interfaces:**
- Consumes: `enqueueChange`, `enqueueCascadeDeleteForTask` from `@/lib/sync/queue` (Task 2).
- Produces: no new exports — every function's existing signature and return value stay identical. Only their bodies gain (a) an `updatedAt: new Date()` on tables that didn't already track it, and (b) a trailing `enqueueChange(...)` call.

This task is mechanical but must be exact — for every function below, the new lines go **after** the existing write succeeds (so a failed write never enqueues a phantom change) and **outside** any `database.transaction(...)` synchronous callback (so `enqueueChange`'s own `await` never violates the sync-callback constraint).

- [ ] **Step 1: Write the failing tests**

Add to `src/db/repositories/__tests__/semester.test.ts` (create the `describe` block if the file doesn't already have one for this):

```typescript
import { getPendingChanges } from "@/lib/sync/queue";

describe("semester repository — sync outbox", () => {
  it("createSemester enqueues an upsert for the new semester", async () => {
    const db = freshTestDb();
    const semester = await createSemester("2026-1", db);
    const pending = await getPendingChanges(db);
    expect(pending).toContainEqual(
      expect.objectContaining({ entityTable: "semesters", entityId: semester.id, operation: "upsert" }),
    );
  });

  it("createSemester also enqueues an upsert for a semester it auto-closes", async () => {
    const db = freshTestDb();
    const first = await createSemester("2025-2", db);
    await createSemester("2026-1", db);
    const pending = await getPendingChanges(db);
    expect(pending).toContainEqual(
      expect.objectContaining({ entityTable: "semesters", entityId: first.id, operation: "upsert" }),
    );
  });

  it("closeSemester enqueues an upsert for the closed semester", async () => {
    const db = freshTestDb();
    const semester = await createSemester("2026-1", db);
    await closeSemester(semester.id, db);
    const pending = await getPendingChanges(db);
    expect(pending).toContainEqual(
      expect.objectContaining({ entityTable: "semesters", entityId: semester.id, operation: "upsert" }),
    );
  });
});
```

Add equivalent `describe("... — sync outbox")` blocks (same shape, adapted per table) to `subject.test.ts`, `task.test.ts`, `subtask.test.ts`, `reminder.test.ts`, and `attachment.test.ts`, covering:
- `subject.test.ts`: `createSubject`/`updateSubject` enqueue `subjects` upserts; `deleteSubject` enqueues a `subjects` delete AND a `tasks`/`subtasks`/`reminders`/`attachments` delete for every task it cascades away (use `enqueueCascadeDeleteForTask`'s own test in Task 2 as the template for asserting the full key set).
- `task.test.ts`: `createTask` enqueues a `tasks` upsert (and one `subtasks` upsert per `subtaskTexts` entry); `updateTask` enqueues a `tasks` upsert; `deleteTask` enqueues the full cascade set via `enqueueCascadeDeleteForTask`; `completeTaskAction` enqueues a `tasks` upsert plus a `subtasks` upsert for every auto-checked subtask.
- `subtask.test.ts`: `addSubtask`/`updateSubtaskText`/`toggleSubtaskCompleted` each enqueue a `subtasks` upsert; `deleteSubtask` enqueues a `subtasks` delete; `moveSubtask` enqueues a `subtasks` upsert for **both** swapped rows.
- `reminder.test.ts`: `addReminder` enqueues a `reminders` upsert; `removeReminder` enqueues a `reminders` delete; `cancelAllRemindersForTask` enqueues a `reminders` upsert for every reminder whose `notificationId` it clears; `rescheduleRemindersForTask` enqueues a `reminders` delete for every "remove" action and a `reminders` upsert for every "keep" action.
- `attachment.test.ts`: `addAttachment` enqueues an `attachments` upsert; `removeAttachment` enqueues an `attachments` delete.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — every new "sync outbox" test fails with an empty `pending` array (the hooks don't exist yet).

- [ ] **Step 3: Add the hooks**

`src/db/repositories/semester.ts` — add the import and two calls:

```typescript
import { enqueueChange } from "@/lib/sync/queue";

// ...inside createSemester, after the transaction:
  await database.transaction((tx) => {
    for (const id of plan.semesterIdsToClose) {
      tx.update(semesters)
        .set({ status: "closed", closedAt: now, updatedAt: now })
        .where(eq(semesters.id, id))
        .run();
    }
    tx.insert(semesters).values({ ...newSemester, updatedAt: now }).run();
  });

  for (const id of plan.semesterIdsToClose) {
    await enqueueChange("semesters", id, "upsert", database);
  }
  await enqueueChange("semesters", newSemester.id, "upsert", database);

  return { ...newSemester, closedAt: null, updatedAt: now };

// ...inside closeSemester, after the update:
  await database
    .update(semesters)
    .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
    .where(eq(semesters.id, id));
  await enqueueChange("semesters", id, "upsert", database);
```

`src/db/repositories/subject.ts` — add the import, three calls:

```typescript
import { enqueueChange, enqueueCascadeDeleteForTask } from "@/lib/sync/queue";

// ...inside createSubject, after the insert:
  await database.insert(subjects).values(newSubject);
  await enqueueChange("subjects", newSubject.id, "upsert", database);
  return newSubject as Subject;

// ...inside updateSubject, after the update:
  await database
    .update(subjects)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(subjects.id, id));
  await enqueueChange("subjects", id, "upsert", database);

// ...inside deleteSubject, in the existing cascade loop:
  for (const taskId of check.cascadeDeleteTaskIds ?? []) {
    await cancelAllRemindersForTask(taskId, database);
    await deleteAttachmentFilesForTask(taskId, database);
    await enqueueCascadeDeleteForTask(taskId, database);
  }

  await database.delete(subjects).where(eq(subjects.id, id));
  await enqueueChange("subjects", id, "delete", database);
```

`src/db/repositories/task.ts` — add the import, four calls:

```typescript
import { enqueueChange, enqueueCascadeDeleteForTask } from "@/lib/sync/queue";

// ...inside createTask, after the reminders loop and the due-notification block:
  await enqueueChange("tasks", newTask.id, "upsert", database);
  for (const subtask of newSubtasks) {
    await enqueueChange("subtasks", subtask.id, "upsert", database);
  }
  return { task: newTask as Task, remindersUnscheduled };

// ...inside updateTask, after the update + reschedule call:
  await database
    .update(tasks)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(tasks.id, id));
  await enqueueChange("tasks", id, "upsert", database);

  let remindersRemoved = 0;
  if (input.dueDateTime !== undefined) {
    const result = await rescheduleRemindersForTask(id, input.dueDateTime, database);
    remindersRemoved = result.removedCount;
  }
  return { remindersRemoved };

// ...inside deleteTask, replacing the manual cancel+delete-files+delete sequence:
  await cancelAllRemindersForTask(id, database);
  await deleteAttachmentFilesForTask(id, database);
  await enqueueCascadeDeleteForTask(id, database);
  await database.delete(tasks).where(eq(tasks.id, id));

// ...inside completeTaskAction, after the transaction:
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

  await enqueueChange("tasks", id, "upsert", database);
  for (const subtaskId of result.subtaskIdsToCheck) {
    await enqueueChange("subtasks", subtaskId, "upsert", database);
  }
  await cancelAllRemindersForTask(id, database);
```

`src/db/repositories/subtask.ts` — add the import, `updatedAt`/`createdAt` on every write, five calls:

```typescript
import { enqueueChange } from "@/lib/sync/queue";

// addSubtask:
  const now = new Date();
  const newSubtask: typeof subtasks.$inferInsert = {
    id: randomUUID(),
    taskId,
    text,
    completed: false,
    order: nextOrder,
    createdAt: now,
    updatedAt: now,
  };
  await database.insert(subtasks).values(newSubtask);
  await enqueueChange("subtasks", newSubtask.id, "upsert", database);
  return newSubtask as Subtask;

// updateSubtaskText:
  await database.update(subtasks).set({ text, updatedAt: new Date() }).where(eq(subtasks.id, id));
  await enqueueChange("subtasks", id, "upsert", database);

// toggleSubtaskCompleted:
  await database.update(subtasks).set({ completed, updatedAt: new Date() }).where(eq(subtasks.id, id));
  await enqueueChange("subtasks", id, "upsert", database);

// deleteSubtask:
  await database.delete(subtasks).where(eq(subtasks.id, id));
  await enqueueChange("subtasks", id, "delete", database);

// moveSubtask, replacing the transaction block:
  const now = new Date();
  await database.transaction((tx) => {
    tx.update(subtasks).set({ order: target.order, updatedAt: now }).where(eq(subtasks.id, current.id)).run();
    tx.update(subtasks).set({ order: current.order, updatedAt: now }).where(eq(subtasks.id, target.id)).run();
  });
  await enqueueChange("subtasks", current.id, "upsert", database);
  await enqueueChange("subtasks", target.id, "upsert", database);
```

`src/db/repositories/reminder.ts` — add the import, `updatedAt` on every write, calls in `addReminder`/`removeReminder`/`cancelAllRemindersForTask`/`rescheduleRemindersForTask`:

```typescript
import { enqueueChange } from "@/lib/sync/queue";

// addReminder — the object literal itself gains `updatedAt`, and the insert
// gains a trailing enqueueChange call:
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
    updatedAt: new Date(),
  };
  await database.insert(reminders).values(newReminder);
  await enqueueChange("reminders", newReminder.id, "upsert", database);
  return newReminder as Reminder;

// removeReminder, after the delete:
  await database.delete(reminders).where(eq(reminders.id, id));
  await enqueueChange("reminders", id, "delete", database);

// cancelAllRemindersForTask, inside the loop:
  for (const reminder of pending) {
    await cancelReminderNotification(reminder.notificationId as string);
    await database
      .update(reminders)
      .set({ notificationId: null, updatedAt: new Date() })
      .where(eq(reminders.id, reminder.id));
    await enqueueChange("reminders", reminder.id, "upsert", database);
  }

// rescheduleRemindersForTask, inside the actions loop:
    if (action.action === "remove") {
      if (reminder.notificationId) {
        await cancelReminderNotification(reminder.notificationId);
      }
      await database.delete(reminders).where(eq(reminders.id, reminder.id));
      await enqueueChange("reminders", reminder.id, "delete", database);
      removedCount += 1;
      continue;
    }

    if (action.action === "keep") {
      if (reminder.notificationId) {
        await cancelReminderNotification(reminder.notificationId);
      }
      let newNotificationId: string | null = null;
      if (permission.granted) {
        newNotificationId = await scheduleReminderNotification(action.newFireAt, {
          taskTitle: task.title,
          subjectName,
          dueDateTime: newDueDateTime,
        });
      }
      await database
        .update(reminders)
        .set({ computedFireAt: action.newFireAt, notificationId: newNotificationId, updatedAt: new Date() })
        .where(eq(reminders.id, reminder.id));
      await enqueueChange("reminders", reminder.id, "upsert", database);
    }
```

`src/db/repositories/attachment.ts` — add the import, `updatedAt` on insert, two calls:

```typescript
import { enqueueChange } from "@/lib/sync/queue";

// addAttachment:
  const newAttachment: typeof attachments.$inferInsert = {
    id,
    taskId,
    originalFileName: picked.name,
    storedPath,
    mimeType: picked.mimeType as string,
    sizeBytes,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await database.insert(attachments).values(newAttachment);
  await enqueueChange("attachments", id, "upsert", database);
  return newAttachment as Attachment;

// removeAttachment:
  deleteAttachmentFile(attachment.storedPath);
  await database.delete(attachments).where(eq(attachments.id, id));
  await enqueueChange("attachments", id, "delete", database);
```

- [ ] **Step 4: Run the full suite to verify everything passes**

Run: `npm test`
Expected: PASS, all suites green including every new "sync outbox" test.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/
git commit -m "feat(sync): hook repository writes into the local sync outbox"
```

---

### Task 4: `src/lib/sync/client.ts` — auth + authenticated fetch

**Files:**
- Create: `src/lib/sync/client.ts`
- Create: `__mocks__/expo-secure-store.ts`
- Test: `src/lib/sync/__tests__/client.test.ts`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Produces: `SYNC_API_BASE_URL` (constant, `"https://unitask-sync.zdevs.uk"`); `class SyncAuthError extends Error`; `register(email: string, password: string): Promise<void>`; `login(email: string, password: string): Promise<void>` (persists the refresh token, keeps the access token in memory); `logout(): Promise<void>`; `restoreSession(): Promise<boolean>` (re-derives an access token from the stored refresh token on cold start; returns whether a session was restored); `isLoggedIn(): boolean`; `authenticatedFetch(path: string, init?: RequestInit): Promise<Response>` (attaches the bearer token, retries once after a transparent refresh on `401`, throws `SyncAuthError` if that retry also 401s or no session exists).

- [ ] **Step 1: Install the dependency**

Run: `npx expo install expo-secure-store`
Expected: adds `"expo-secure-store": "~57.0.4"` (or the version `expo install` resolves for this SDK) to `package.json` `dependencies`.

- [ ] **Step 2: Add the Jest mock**

Create `__mocks__/expo-secure-store.ts` (repo root, alongside the existing `expo-notifications.ts`/`expo-sqlite.ts` mocks — auto-loaded by Jest, no `jest.mock(...)` needed):

```typescript
const store = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

// Test-only helper, not part of the real expo-secure-store API — lets tests
// reset state between cases without reaching into the module's internals.
export function __reset(): void {
  store.clear();
}
```

- [ ] **Step 3: Write the failing tests**

Create `src/lib/sync/__tests__/client.test.ts`:

```typescript
import { __reset } from "expo-secure-store";
import {
  register,
  login,
  logout,
  restoreSession,
  isLoggedIn,
  authenticatedFetch,
  SyncAuthError,
} from "../client";

function mockFetchOnce(status: number, body: unknown) {
  return jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe("sync client", () => {
  beforeEach(() => {
    __reset();
    (global as any).fetch = undefined;
  });

  it("register posts credentials and does not throw on 201", async () => {
    global.fetch = mockFetchOnce(201, { ok: true });
    await expect(register("a@b.com", "pw")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "https://unitask-sync.zdevs.uk/auth/register",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("register throws on 409", async () => {
    global.fetch = mockFetchOnce(409, { error: "Email already registered" });
    await expect(register("a@b.com", "pw")).rejects.toThrow();
  });

  it("login stores the refresh token and marks the session as logged in", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");
    expect(isLoggedIn()).toBe(true);
  });

  it("login throws on 401 and does not mark the session as logged in", async () => {
    global.fetch = mockFetchOnce(401, { error: "Invalid credentials" });
    await expect(login("a@b.com", "wrong")).rejects.toThrow();
    expect(isLoggedIn()).toBe(false);
  });

  it("logout clears the session", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");
    global.fetch = mockFetchOnce(200, { ok: true });
    await logout();
    expect(isLoggedIn()).toBe(false);
  });

  it("restoreSession re-derives an access token from the stored refresh token", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");

    // Simulate a cold start: isLoggedIn() would be false until restoreSession runs.
    global.fetch = mockFetchOnce(200, { accessToken: "at-2", refreshToken: "rt-2" });
    const restored = await restoreSession();
    expect(restored).toBe(true);
    expect(isLoggedIn()).toBe(true);
  });

  it("restoreSession returns false when no refresh token was ever stored", async () => {
    const restored = await restoreSession();
    expect(restored).toBe(false);
  });

  it("authenticatedFetch attaches the bearer token", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");

    global.fetch = mockFetchOnce(200, { ok: true });
    await authenticatedFetch("/sync/push", { method: "POST" });
    expect(fetch).toHaveBeenCalledWith(
      "https://unitask-sync.zdevs.uk/sync/push",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer at-1" }) }),
    );
  });

  it("authenticatedFetch refreshes once and retries on a 401, then succeeds", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "at-2", refreshToken: "rt-2" }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);

    const response = await authenticatedFetch("/sync/pull?since=0");
    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("authenticatedFetch throws SyncAuthError when no session exists", async () => {
    await expect(authenticatedFetch("/sync/pull?since=0")).rejects.toThrow(SyncAuthError);
  });

  it("authenticatedFetch throws SyncAuthError when the refresh itself fails", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response);

    await expect(authenticatedFetch("/sync/pull?since=0")).rejects.toThrow(SyncAuthError);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx jest client.test.ts`
Expected: FAIL — `Cannot find module '../client'`

- [ ] **Step 5: Implement the client**

Create `src/lib/sync/client.ts`:

```typescript
import * as SecureStore from "expo-secure-store";

export const SYNC_API_BASE_URL = "https://unitask-sync.zdevs.uk";

const REFRESH_TOKEN_KEY = "unitask-refresh-token";

export class SyncAuthError extends Error {
  constructor(message = "Sync session expired or was never established") {
    super(message);
    this.name = "SyncAuthError";
  }
}

// In-memory only, per this plan's Global Constraints — never written to
// SQLite or SecureStore. Re-derived from the stored refresh token via
// restoreSession() on cold start.
let accessToken: string | null = null;

export function isLoggedIn(): boolean {
  return accessToken !== null;
}

async function parseJsonOrThrow(response: Response, errorMessage: string): Promise<any> {
  if (!response.ok) {
    throw new Error(`${errorMessage} (status ${response.status})`);
  }
  return response.json();
}

export async function register(email: string, password: string): Promise<void> {
  const response = await fetch(`${SYNC_API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await parseJsonOrThrow(response, "No se pudo registrar la cuenta");
}

export async function login(email: string, password: string): Promise<void> {
  const response = await fetch(`${SYNC_API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseJsonOrThrow(response, "Credenciales inválidas");
  accessToken = body.accessToken;
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, body.refreshToken);
}

export async function logout(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (refreshToken) {
    try {
      await fetch(`${SYNC_API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Best-effort server-side revocation — the local session is cleared
      // regardless, since the whole point of logging out locally is to stop
      // this device from acting as this account even if offline.
    }
  }
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;

  const response = await fetch(`${SYNC_API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) return false;

  const body = await response.json();
  accessToken = body.accessToken;
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, body.refreshToken);
  return true;
}

export async function restoreSession(): Promise<boolean> {
  return refreshAccessToken();
}

export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (accessToken === null) {
    const restored = await refreshAccessToken();
    if (!restored) throw new SyncAuthError();
  }

  const withAuth = (headers: HeadersInit | undefined): HeadersInit => ({
    ...headers,
    Authorization: `Bearer ${accessToken}`,
  });

  let response = await fetch(`${SYNC_API_BASE_URL}${path}`, { ...init, headers: withAuth(init.headers) });
  if (response.status !== 401) return response;

  const refreshed = await refreshAccessToken();
  if (!refreshed) throw new SyncAuthError();

  response = await fetch(`${SYNC_API_BASE_URL}${path}`, { ...init, headers: withAuth(init.headers) });
  if (response.status === 401) throw new SyncAuthError();
  return response;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest client.test.ts`
Expected: PASS (12/12)

- [ ] **Step 7: Run the full suite and commit**

Run: `npm test`
Expected: PASS, all suites green.

```bash
git add package.json package-lock.json __mocks__/expo-secure-store.ts src/lib/sync/client.ts src/lib/sync/__tests__/client.test.ts
git commit -m "feat(sync): add auth client with secure refresh-token storage"
```

---

### Task 5: `src/lib/sync/serializers.ts` — per-table payload build/apply

**Files:**
- Create: `src/lib/sync/serializers.ts`
- Test: `src/lib/sync/__tests__/serializers.test.ts`

**Interfaces:**
- Consumes: schema tables from `@/db/schema`; `type Database` from `@/db/repositories/semester`; `resolveSyncTimestamp` from `./queue` (Task 2).
- Produces: `SYNCED_TABLES = ["semesters", "subjects", "tasks", "subtasks", "reminders", "attachments"] as const`; `type SyncedTable = (typeof SYNCED_TABLES)[number]`; `buildPayload(table: SyncedTable, entityId: string, database?: Database): Promise<{payload: unknown; clientUpdatedAt: number} | null>` (null if the row no longer exists — a race between enqueueing and pushing); `applyUpsert(table: string, entityId: string, payload: unknown, database?: Database): Promise<void>` (raw insert-or-update, bypassing repository validation per this plan's Global Constraints); `applyDelete(table: string, entityId: string, database?: Database): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/sync/__tests__/serializers.test.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { buildPayload, applyUpsert, applyDelete } from "../serializers";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("buildPayload", () => {
  it("builds a semesters payload with all fields", async () => {
    const db = freshTestDb();
    await db.insert(semesters).values({ id: "sem-1", label: "2026-1", status: "active", createdAt: new Date(1000) });

    const result = await buildPayload("semesters", "sem-1", db);
    expect(result?.payload).toMatchObject({ id: "sem-1", label: "2026-1", status: "active" });
    expect(result?.clientUpdatedAt).toBeGreaterThan(0);
  });

  it("returns null when the entity no longer exists", async () => {
    const db = freshTestDb();
    const result = await buildPayload("semesters", "missing", db);
    expect(result).toBeNull();
  });
});

describe("applyUpsert / applyDelete", () => {
  it("applyUpsert inserts a new semesters row from a pulled payload", async () => {
    const db = freshTestDb();
    await applyUpsert(
      "semesters",
      "sem-2",
      { id: "sem-2", label: "2026-2", status: "active", createdAt: "2026-01-01T00:00:00.000Z", closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      db,
    );

    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-2"));
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("2026-2");
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("applyUpsert updates an existing row instead of inserting a duplicate", async () => {
    const db = freshTestDb();
    await applyUpsert(
      "semesters",
      "sem-3",
      { id: "sem-3", label: "V1", status: "active", createdAt: "2026-01-01T00:00:00.000Z", closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      db,
    );
    await applyUpsert(
      "semesters",
      "sem-3",
      { id: "sem-3", label: "V2", status: "closed", createdAt: "2026-01-01T00:00:00.000Z", closedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
      db,
    );

    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-3"));
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("V2");
    expect(rows[0].status).toBe("closed");
  });

  it("applyDelete removes the row for the given table and id", async () => {
    const db = freshTestDb();
    await applyUpsert(
      "semesters",
      "sem-4",
      { id: "sem-4", label: "X", status: "active", createdAt: "2026-01-01T00:00:00.000Z", closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      db,
    );
    await applyDelete("semesters", "sem-4", db);

    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-4"));
    expect(rows).toHaveLength(0);
  });

  it("applyUpsert on tasks parses date-string fields into real Date columns", async () => {
    const db = freshTestDb();
    await db.insert(semesters).values({ id: "sem-5", label: "2026-1", status: "active", createdAt: new Date() });
    await db.insert(subjects).values({
      id: "subj-1",
      name: "Cálculo",
      courseCode: null,
      professorName: null,
      color: "blue",
      semesterId: "sem-5",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await applyUpsert(
      "tasks",
      "task-1",
      {
        id: "task-1",
        title: "Entregar informe",
        description: null,
        subjectId: "subj-1",
        dueDateTime: "2026-03-01T10:00:00.000Z",
        priority: "Alta",
        completed: false,
        completedAt: null,
        completedLate: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      db,
    );

    const rows = await db.select().from(tasks).where(eq(tasks.id, "task-1"));
    expect(rows[0].dueDateTime).toBeInstanceOf(Date);
    expect(rows[0].dueDateTime.toISOString()).toBe("2026-03-01T10:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest serializers.test.ts`
Expected: FAIL — `Cannot find module '../serializers'`

- [ ] **Step 3: Implement the serializers**

Create `src/lib/sync/serializers.ts`:

```typescript
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import { resolveSyncTimestamp } from "./queue";

export const SYNCED_TABLES = ["semesters", "subjects", "tasks", "subtasks", "reminders", "attachments"] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

// Every table here has date-typed columns that must round-trip through JSON
// as ISO strings (server payload is `unknown` JSONB — see the design spec)
// and back into real `Date` objects for SQLite. Listed once, driven by both
// buildPayload (implicit — Drizzle already returns Date objects, JSON.stringify
// handles the Date->string direction for free) and applyUpsert (explicit,
// below) since only the incoming direction needs a manual parse.
const DATE_FIELDS_BY_TABLE: Record<SyncedTable, string[]> = {
  semesters: ["createdAt", "closedAt", "updatedAt"],
  subjects: ["createdAt", "updatedAt"],
  tasks: ["dueDateTime", "completedAt", "createdAt", "updatedAt"],
  subtasks: ["createdAt", "updatedAt"],
  reminders: ["fixedDateTime", "computedFireAt", "createdAt", "updatedAt"],
  attachments: ["createdAt", "updatedAt", "syncedAt"],
};

const TABLES = {
  semesters,
  subjects,
  tasks,
  subtasks,
  reminders,
  attachments,
} as const;

function tableFor(table: string) {
  const found = (TABLES as Record<string, (typeof TABLES)[SyncedTable]>)[table];
  if (!found) throw new Error(`Unknown synced table: ${table}`);
  return found;
}

function parseDates(table: SyncedTable, payload: Record<string, unknown>): Record<string, unknown> {
  const result = { ...payload };
  for (const field of DATE_FIELDS_BY_TABLE[table]) {
    const value = result[field];
    if (typeof value === "string") {
      result[field] = new Date(value);
    }
  }
  return result;
}

export async function buildPayload(
  table: SyncedTable,
  entityId: string,
  database: Database = defaultDb,
): Promise<{ payload: unknown; clientUpdatedAt: number } | null> {
  const schemaTable = tableFor(table);
  const rows = await database.select().from(schemaTable as any).where(eq((schemaTable as any).id, entityId)).limit(1);
  const row = rows[0] as (Record<string, unknown> & { updatedAt: Date | null; createdAt: Date | null }) | undefined;
  if (!row) return null;

  const clientUpdatedAt = resolveSyncTimestamp(row).getTime();
  return { payload: row, clientUpdatedAt };
}

export async function applyUpsert(
  table: string,
  entityId: string,
  payload: unknown,
  database: Database = defaultDb,
): Promise<void> {
  if (!(SYNCED_TABLES as readonly string[]).includes(table)) return; // forward-compatible: ignore unknown tables
  const syncedTable = table as SyncedTable;
  const schemaTable = tableFor(syncedTable);
  const row = parseDates(syncedTable, payload as Record<string, unknown>);

  const existing = await database
    .select({ id: (schemaTable as any).id })
    .from(schemaTable as any)
    .where(eq((schemaTable as any).id, entityId))
    .limit(1);

  if (existing.length > 0) {
    await database.update(schemaTable as any).set(row).where(eq((schemaTable as any).id, entityId));
  } else {
    await database.insert(schemaTable as any).values(row);
  }
}

export async function applyDelete(
  table: string,
  entityId: string,
  database: Database = defaultDb,
): Promise<void> {
  if (!(SYNCED_TABLES as readonly string[]).includes(table)) return;
  const schemaTable = tableFor(table as SyncedTable);
  await database.delete(schemaTable as any).where(eq((schemaTable as any).id, entityId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest serializers.test.ts`
Expected: PASS (6/6)

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS, all suites green.

```bash
git add src/lib/sync/serializers.ts src/lib/sync/__tests__/serializers.test.ts
git commit -m "feat(sync): add per-table payload build/apply serializers"
```

---

### Task 6: `src/lib/sync/push.ts` — drain the outbox

**Files:**
- Create: `src/lib/sync/push.ts`
- Test: `src/lib/sync/__tests__/push.test.ts`

**Interfaces:**
- Consumes: `getPendingChanges`, `clearPendingChanges` from `./queue` (Task 2); `buildPayload`, `type SyncedTable` from `./serializers` (Task 5); `authenticatedFetch` from `./client` (Task 4); `attachments`, `type Attachment` schema table/type.
- Produces: `PUSH_BATCH_SIZE = 200`; `interface PushSummary { pushed: number; rejected: number }`; `pushChanges(database?: Database): Promise<PushSummary>`; `uploadPendingAttachmentFiles(database?: Database): Promise<void>` (called by `pushChanges` itself — not meant to be called separately, but exported for direct testing).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/sync/__tests__/push.test.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { attachments } from "@/db/schema/attachment";
import { enqueueChange, getPendingChanges } from "../queue";
import { pushChanges } from "../push";

jest.mock("../client", () => ({
  authenticatedFetch: jest.fn(),
}));
import { authenticatedFetch } from "../client";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("pushChanges", () => {
  beforeEach(() => {
    (authenticatedFetch as jest.Mock).mockReset();
  });

  it("does nothing and returns zero counts when the outbox is empty", async () => {
    const db = freshTestDb();
    const result = await pushChanges(db);
    expect(result).toEqual({ pushed: 0, rejected: 0 });
    expect(authenticatedFetch).not.toHaveBeenCalled();
  });

  it("sends a pending upsert with the current row as payload, then clears it on accept", async () => {
    const db = freshTestDb();
    await db.insert(semesters).values({ id: "sem-1", label: "2026-1", status: "active", createdAt: new Date() });
    await enqueueChange("semesters", "sem-1", "upsert", db);

    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ["semesters:sem-1"], rejected: [] }),
    });

    const result = await pushChanges(db);
    expect(result).toEqual({ pushed: 1, rejected: 0 });
    expect(await getPendingChanges(db)).toEqual([]);

    const [, init] = (authenticatedFetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.operations[0]).toMatchObject({ table: "semesters", entityId: "sem-1", operation: "upsert" });
  });

  it("clears a rejected entry too (the server's newer version wins, a later pull corrects it)", async () => {
    const db = freshTestDb();
    await db.insert(semesters).values({ id: "sem-2", label: "stale", status: "active", createdAt: new Date() });
    await enqueueChange("semesters", "sem-2", "upsert", db);

    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: [], rejected: ["semesters:sem-2"] }),
    });

    const result = await pushChanges(db);
    expect(result).toEqual({ pushed: 0, rejected: 1 });
    expect(await getPendingChanges(db)).toEqual([]);
  });

  it("sends a delete with a null payload, skipping buildPayload entirely", async () => {
    const db = freshTestDb();
    await enqueueChange("semesters", "sem-3", "delete", db);

    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ["semesters:sem-3"], rejected: [] }),
    });

    await pushChanges(db);
    const [, init] = (authenticatedFetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.operations[0]).toMatchObject({ table: "semesters", entityId: "sem-3", operation: "delete", payload: null });
  });

  it("drops a pending upsert whose row no longer exists (enqueued then deleted before push)", async () => {
    const db = freshTestDb();
    await enqueueChange("semesters", "sem-missing", "upsert", db);

    const result = await pushChanges(db);
    expect(result).toEqual({ pushed: 0, rejected: 0 });
    expect(authenticatedFetch).not.toHaveBeenCalled();
    expect(await getPendingChanges(db)).toEqual([]);
  });

  it("leaves the outbox untouched when the request itself fails", async () => {
    const db = freshTestDb();
    await db.insert(semesters).values({ id: "sem-4", label: "x", status: "active", createdAt: new Date() });
    await enqueueChange("semesters", "sem-4", "upsert", db);

    (authenticatedFetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));

    await expect(pushChanges(db)).rejects.toThrow("network down");
    expect(await getPendingChanges(db)).toHaveLength(1);
  });
});

describe("uploadPendingAttachmentFiles (via pushChanges)", () => {
  it("uploads the local file for an attachment whose metadata was just accepted, then marks it synced", async () => {
    const db = freshTestDb();
    await db.insert(attachments).values({
      id: "att-1",
      taskId: "task-1",
      originalFileName: "notes.pdf",
      storedPath: "/local/notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncedAt: null,
    });
    await enqueueChange("attachments", "att-1", "upsert", db);

    (authenticatedFetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accepted: ["attachments:att-1"], rejected: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    await pushChanges(db);

    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
    const [uploadPath, uploadInit] = (authenticatedFetch as jest.Mock).mock.calls[1];
    expect(uploadPath).toBe("/sync/attachments/att-1");
    expect(uploadInit.method).toBe("POST");
    expect(uploadInit.body).toBeInstanceOf(FormData);

    const rows = await db.select().from(attachments).where(eq(attachments.id, "att-1"));
    expect(rows[0].syncedAt).toBeInstanceOf(Date);
  });

  it("does not re-upload a file that already has syncedAt set", async () => {
    const db = freshTestDb();
    await db.insert(attachments).values({
      id: "att-2",
      taskId: "task-1",
      originalFileName: "notes.pdf",
      storedPath: "/local/notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncedAt: new Date(),
    });
    await enqueueChange("attachments", "att-2", "upsert", db);

    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ["attachments:att-2"], rejected: [] }),
    });

    await pushChanges(db);
    expect(authenticatedFetch).toHaveBeenCalledTimes(1); // only the metadata push, no upload call
  });

  it("leaves syncedAt null when the upload request fails, so the next push retries it", async () => {
    const db = freshTestDb();
    await db.insert(attachments).values({
      id: "att-3",
      taskId: "task-1",
      originalFileName: "notes.pdf",
      storedPath: "/local/notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncedAt: null,
    });
    await enqueueChange("attachments", "att-3", "upsert", db);

    (authenticatedFetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accepted: ["attachments:att-3"], rejected: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 413, json: async () => ({ error: "too large" }) });

    await pushChanges(db); // uploadPendingAttachmentFiles must not throw and fail the whole push over one file

    const rows = await db.select().from(attachments).where(eq(attachments.id, "att-3"));
    expect(rows[0].syncedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest push.test.ts`
Expected: FAIL — `Cannot find module '../push'`

- [ ] **Step 3: Implement pushChanges**

Create `src/lib/sync/push.ts`:

```typescript
import { eq, isNull } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { attachments } from "@/db/schema/attachment";
import { getPendingChanges, clearPendingChanges } from "./queue";
import { buildPayload, SYNCED_TABLES, type SyncedTable } from "./serializers";
import { authenticatedFetch } from "./client";

export const PUSH_BATCH_SIZE = 200;

export interface PushSummary {
  pushed: number;
  rejected: number;
}

interface PushOperation {
  table: string;
  entityId: string;
  operation: "upsert" | "delete";
  payload: unknown;
  clientUpdatedAt: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function pushChanges(database: Database = defaultDb): Promise<PushSummary> {
  const pending = await getPendingChanges(database);

  let pushed = 0;
  let rejected = 0;

  // `chunk([], N)` is `[]`, so this loop is simply a no-op when the outbox
  // is empty — deliberately NOT an early return, because
  // uploadPendingAttachmentFiles below must still run even when there is
  // nothing left in sync_log (e.g. a metadata push already succeeded and
  // cleared its outbox entry on a previous call, but that file's upload
  // itself failed and needs retrying now).
  for (const batch of chunk(pending, PUSH_BATCH_SIZE)) {
    const operations: PushOperation[] = [];
    const keysToClearRegardless: string[] = [];

    for (const entry of batch) {
      const key = `${entry.entityTable}:${entry.entityId}`;
      if (entry.operation === "delete") {
        operations.push({
          table: entry.entityTable,
          entityId: entry.entityId,
          operation: "delete",
          payload: null,
          clientUpdatedAt: entry.updatedAt.getTime(),
        });
        continue;
      }

      const built = (SYNCED_TABLES as readonly string[]).includes(entry.entityTable)
        ? await buildPayload(entry.entityTable as SyncedTable, entry.entityId, database)
        : null;
      if (!built) {
        // Enqueued, then the row was deleted again before this push ran —
        // nothing to send, and nothing left worth retrying either.
        keysToClearRegardless.push(key);
        continue;
      }
      operations.push({
        table: entry.entityTable,
        entityId: entry.entityId,
        operation: "upsert",
        payload: built.payload,
        clientUpdatedAt: built.clientUpdatedAt,
      });
    }

    if (keysToClearRegardless.length > 0) {
      await clearPendingChanges(keysToClearRegardless, database);
    }
    if (operations.length === 0) continue;

    const response = await authenticatedFetch("/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations }),
    });
    const body = await response.json();

    // Both accepted AND rejected entries are cleared from the outbox: a
    // rejection means the server already holds a newer write for that
    // entity (last-write-wins), so retrying this stale local write forever
    // would be pointless — the next pullChanges() call brings the server's
    // newer version down and corrects this device.
    await clearPendingChanges([...body.accepted, ...body.rejected], database);
    pushed += body.accepted.length;
    rejected += body.rejected.length;
  }

  await uploadPendingAttachmentFiles(database);

  return { pushed, rejected };
}

/**
 * Uploads the local bytes for every attachment whose metadata has synced
 * but whose file hasn't (`syncedAt IS NULL`) — independent of whether this
 * particular attachment was part of the batch just pushed above, so a file
 * upload that failed on a previous run gets retried here too, with no
 * separate queue table needed. Best-effort per file: one file's failure
 * (e.g. 413 too large, or the device is offline for just that request)
 * must never throw and abort the whole push, since the metadata is already
 * durably synced either way.
 */
export async function uploadPendingAttachmentFiles(database: Database = defaultDb): Promise<void> {
  const pendingFiles = await database.select().from(attachments).where(isNull(attachments.syncedAt));

  for (const attachment of pendingFiles) {
    try {
      const formData = new FormData();
      // React Native's fetch/FormData accepts this {uri,name,type} shape in
      // place of a Blob — the network layer streams the file by URI, no
      // manual read-into-memory step needed.
      formData.append("file", {
        uri: attachment.storedPath,
        name: attachment.originalFileName,
        type: attachment.mimeType,
      } as unknown as Blob);

      const response = await authenticatedFetch(`/sync/attachments/${attachment.id}`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) continue; // leave syncedAt null, retried on the next pushChanges() call

      await database.update(attachments).set({ syncedAt: new Date() }).where(eq(attachments.id, attachment.id));
    } catch {
      // Network failure uploading this one file — leave syncedAt null and
      // move on to the next; never let one bad upload abort the batch.
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest push.test.ts`
Expected: PASS (9/9)

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS, all suites green.

```bash
git add src/lib/sync/push.ts src/lib/sync/__tests__/push.test.ts
git commit -m "feat(sync): add pushChanges to drain the local outbox"
```

---

### Task 7: `src/lib/sync/pull.ts` — apply remote changes, reschedule reminders, queue attachment downloads

**Files:**
- Create: `src/lib/sync/pull.ts`
- Modify: `src/lib/files/index.ts` (one new function)
- Test: `src/lib/sync/__tests__/pull.test.ts`

**Interfaces:**
- Consumes: `applyUpsert`, `applyDelete`, `SYNCED_TABLES` from `./serializers` (Task 5); `authenticatedFetch` from `./client` (Task 4); `getSyncCursor`, `setSyncCursor` from `@/db/repositories/settings` (Task 8 adds these — see that task's note); `scheduleReminderNotification`, `cancelReminderNotification` from `@/lib/notifications`; `deleteAttachmentFile` from `@/lib/files`; `tasks`, `subjects`, `reminders`, `attachments` schema tables.
- Produces (new, in `src/lib/files/index.ts`): `saveDownloadedAttachment(taskId: string, attachmentId: string, originalFileName: string, url: string, accessToken: string): Promise<{ storedPath: string }>`.
- Produces (in `pull.ts`): `interface PullSummary { applied: number }`; `pullChanges(database?: Database): Promise<PullSummary>`.

This task deliberately calls `getSyncCursor`/`setSyncCursor` before Task 8 creates them — implement Task 8's two settings functions first if executing tasks out of order; the subagent-driven-development flow executes tasks in order, so by the time this task runs Task 8 doesn't exist yet. **Do this task's Step 0 first:**

- [ ] **Step 0: Add the two settings functions this task needs (pulled forward from Task 8)**

Modify `src/db/repositories/settings.ts` — add after `saveProfile`:

```typescript
export async function getSyncCursor(database: Database = defaultDb): Promise<number> {
  const rows = await database.select({ syncCursor: settings.syncCursor }).from(settings).limit(1);
  return rows[0]?.syncCursor ?? 0;
}

export async function setSyncCursor(cursor: number, database: Database = defaultDb): Promise<void> {
  const rows = await database.select({ id: settings.id }).from(settings).limit(1);
  const existing = rows[0];
  const now = new Date();
  if (existing) {
    await database.update(settings).set({ syncCursor: cursor, lastSyncAt: now }).where(eq(settings.id, existing.id));
  } else {
    await database.insert(settings).values({
      id: randomUUID(),
      nickname: null,
      fullName: null,
      createdAt: now,
      updatedAt: now,
      syncCursor: cursor,
      lastSyncAt: now,
    });
  }
}
```

Add a test to `src/db/repositories/__tests__/settings.test.ts`:

```typescript
import { getSyncCursor, setSyncCursor } from "@/db/repositories/settings";

describe("settings repository — sync cursor", () => {
  it("defaults to 0 when never set", async () => {
    const db = freshTestDb();
    expect(await getSyncCursor(db)).toBe(0);
  });

  it("persists and reads back a cursor without an existing settings row", async () => {
    const db = freshTestDb();
    await setSyncCursor(42, db);
    expect(await getSyncCursor(db)).toBe(42);
  });

  it("updates the cursor on an existing row without creating a second one", async () => {
    const db = freshTestDb();
    await setSyncCursor(1, db);
    await setSyncCursor(2, db);
    expect(await getSyncCursor(db)).toBe(2);

    const rows = await db.select().from(settings);
    expect(rows).toHaveLength(1);
  });
});
```

Run `npx jest settings.test.ts` to confirm these 3 pass (red→green, same TDD cycle, folded into this step since it's a 2-function prerequisite rather than a whole task on its own).

- [ ] **Step 1: Add the attachment download helper**

Modify `src/lib/files/index.ts` — add after `openAttachment`:

```typescript
/**
 * Downloads a pulled attachment's bytes into this device's local storage,
 * mirroring `copyIntoAttachmentStorage`'s path convention exactly (same
 * `{taskId}/{attachmentId}-{safeName}` shape) so `openAttachment` and
 * every other file helper work identically regardless of whether the file
 * arrived via a local pick/photo or a sync download.
 */
export async function saveDownloadedAttachment(
  taskId: string,
  attachmentId: string,
  originalFileName: string,
  url: string,
  accessToken: string,
): Promise<{ storedPath: string }> {
  const taskDir = new Directory(ATTACHMENTS_ROOT, taskId);
  taskDir.create({ intermediates: true, idempotent: true });

  const safeName = originalFileName.replace(/[/\\]/g, "_") || "archivo";
  const destination = new File(taskDir, `${attachmentId}-${safeName}`);

  const task = File.createDownloadTask(url, destination, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await task.downloadAsync();

  return { storedPath: destination.uri };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/sync/__tests__/pull.test.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import { getSyncCursor } from "@/db/repositories/settings";
import { pullChanges } from "../pull";

jest.mock("../client", () => ({ authenticatedFetch: jest.fn() }));
import { authenticatedFetch } from "../client";

jest.mock("@/lib/notifications", () => ({
  scheduleReminderNotification: jest.fn().mockResolvedValue("os-notif-1"),
  cancelReminderNotification: jest.fn().mockResolvedValue(undefined),
  requestNotificationPermission: jest.fn().mockResolvedValue({ granted: true }),
}));
import { scheduleReminderNotification, cancelReminderNotification } from "@/lib/notifications";

jest.mock("@/lib/files", () => ({
  saveDownloadedAttachment: jest.fn().mockResolvedValue({ storedPath: "/local/att.pdf" }),
}));

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

describe("pullChanges", () => {
  beforeEach(() => {
    (authenticatedFetch as jest.Mock).mockReset();
    (scheduleReminderNotification as jest.Mock).mockClear();
    (cancelReminderNotification as jest.Mock).mockClear();
  });

  it("does nothing when the server has no new operations", async () => {
    const db = freshTestDb();
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ operations: [], cursor: 0 }));

    const result = await pullChanges(db);
    expect(result).toEqual({ applied: 0 });
  });

  it("applies an upsert and advances the persisted cursor", async () => {
    const db = freshTestDb();
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        operations: [
          {
            table: "semesters",
            entityId: "sem-1",
            operation: "upsert",
            payload: { id: "sem-1", label: "2026-1", status: "active", createdAt: "2026-01-01T00:00:00.000Z", closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" },
            clientUpdatedAt: 1000,
          },
        ],
        cursor: 5,
      }),
    );

    const result = await pullChanges(db);
    expect(result).toEqual({ applied: 1 });

    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-1"));
    expect(rows).toHaveLength(1);
    expect(await getSyncCursor(db)).toBe(5);
  });

  it("loops until an empty page comes back, applying every page", async () => {
    const db = freshTestDb();
    (authenticatedFetch as jest.Mock)
      .mockResolvedValueOnce(
        jsonResponse({
          operations: [
            {
              table: "semesters",
              entityId: "sem-a",
              operation: "upsert",
              payload: { id: "sem-a", label: "A", status: "active", createdAt: "2026-01-01T00:00:00.000Z", closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" },
              clientUpdatedAt: 1,
            },
          ],
          cursor: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          operations: [
            {
              table: "semesters",
              entityId: "sem-b",
              operation: "upsert",
              payload: { id: "sem-b", label: "B", status: "active", createdAt: "2026-01-01T00:00:00.000Z", closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" },
              clientUpdatedAt: 2,
            },
          ],
          cursor: 2,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ operations: [], cursor: 2 }));

    const result = await pullChanges(db);
    expect(result).toEqual({ applied: 2 });
    expect(authenticatedFetch).toHaveBeenCalledTimes(3);
    expect((authenticatedFetch as jest.Mock).mock.calls[1][0]).toBe("/sync/pull?since=1");
  });

  it("applies a delete", async () => {
    const db = freshTestDb();
    await db.insert(semesters).values({ id: "sem-2", label: "gone", status: "active", createdAt: new Date() });
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        operations: [{ table: "semesters", entityId: "sem-2", operation: "delete", payload: null, clientUpdatedAt: 10 }],
        cursor: 1,
      }),
    );

    await pullChanges(db);
    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-2"));
    expect(rows).toHaveLength(0);
  });

  it("reschedules the OS notification for a pulled reminder with a future fire time", async () => {
    const db = freshTestDb();
    await db.insert(semesters).values({ id: "sem-3", label: "s", status: "active", createdAt: new Date() });
    await db.insert(subjects).values({ id: "subj-1", name: "Física", courseCode: null, professorName: null, color: "blue", semesterId: "sem-3", createdAt: new Date(), updatedAt: new Date() });
    await db.insert(tasks).values({ id: "task-1", title: "Tarea", description: null, subjectId: "subj-1", dueDateTime: new Date(Date.now() + 86400000), priority: "Alta", completed: false, completedAt: null, completedLate: false, createdAt: new Date(), updatedAt: new Date() });

    const futureFireAt = new Date(Date.now() + 3600000).toISOString();
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        operations: [
          {
            table: "reminders",
            entityId: "rem-1",
            operation: "upsert",
            payload: { id: "rem-1", taskId: "task-1", kind: "fixed", offsetValue: null, offsetUnit: null, fixedDateTime: futureFireAt, computedFireAt: futureFireAt, notificationId: null, createdAt: futureFireAt, updatedAt: futureFireAt },
            clientUpdatedAt: 1,
          },
        ],
        cursor: 1,
      }),
    );

    await pullChanges(db);

    expect(scheduleReminderNotification).toHaveBeenCalledWith(
      new Date(futureFireAt),
      expect.objectContaining({ taskTitle: "Tarea", subjectName: "Física" }),
    );
    const rows = await db.select().from(reminders).where(eq(reminders.id, "rem-1"));
    expect(rows[0].notificationId).toBe("os-notif-1");
  });

  it("cancels the old OS notification before rescheduling an already-pulled reminder", async () => {
    const db = freshTestDb();
    await db.insert(semesters).values({ id: "sem-4", label: "s", status: "active", createdAt: new Date() });
    await db.insert(subjects).values({ id: "subj-2", name: "Química", courseCode: null, professorName: null, color: "blue", semesterId: "sem-4", createdAt: new Date(), updatedAt: new Date() });
    await db.insert(tasks).values({ id: "task-2", title: "T", description: null, subjectId: "subj-2", dueDateTime: new Date(Date.now() + 86400000), priority: "Media", completed: false, completedAt: null, completedLate: false, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(reminders).values({ id: "rem-2", taskId: "task-2", kind: "fixed", offsetValue: null, offsetUnit: null, fixedDateTime: new Date(), computedFireAt: new Date(Date.now() + 3600000), notificationId: "old-notif", createdAt: new Date() });

    const newFireAt = new Date(Date.now() + 7200000).toISOString();
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        operations: [
          {
            table: "reminders",
            entityId: "rem-2",
            operation: "upsert",
            payload: { id: "rem-2", taskId: "task-2", kind: "fixed", offsetValue: null, offsetUnit: null, fixedDateTime: newFireAt, computedFireAt: newFireAt, notificationId: null, createdAt: newFireAt, updatedAt: newFireAt },
            clientUpdatedAt: 2,
          },
        ],
        cursor: 1,
      }),
    );

    await pullChanges(db);
    expect(cancelReminderNotification).toHaveBeenCalledWith("old-notif");
    expect(scheduleReminderNotification).toHaveBeenCalled();
  });

  it("downloads a pulled attachment's file when the local file doesn't exist yet", async () => {
    const { saveDownloadedAttachment } = jest.requireMock("@/lib/files");
    const db = freshTestDb();
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        operations: [
          {
            table: "attachments",
            entityId: "att-1",
            operation: "upsert",
            payload: { id: "att-1", taskId: "task-3", originalFileName: "notes.pdf", storedPath: "/remote/notes.pdf", mimeType: "application/pdf", sizeBytes: 10, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", syncedAt: null },
            clientUpdatedAt: 1,
          },
        ],
        cursor: 1,
      }),
    );

    await pullChanges(db);

    expect(saveDownloadedAttachment).toHaveBeenCalledWith(
      "task-3",
      "att-1",
      "notes.pdf",
      expect.stringContaining("/sync/attachments/att-1"),
      undefined,
    );
    const rows = await db.select().from(attachments).where(eq(attachments.id, "att-1"));
    expect(rows[0].storedPath).toBe("/local/att.pdf");
  });
});
```

Note the last test asserts the download call's 5th argument as `undefined` for `accessToken` — Step 3's implementation resolves the real token from `client.ts`'s module state, which the test's `jest.mock("../client", ...)` replaces entirely (no `accessToken` export). Since `client.ts` deliberately keeps the access token as a private, non-exported module variable (Task 4's Global-Constraints-driven design — "never written to SQLite... in-memory only"), `pull.ts` cannot read it directly either; **Task 4's `client.ts` needs one more export for this to work**: add `export function getAccessToken(): string | null { return accessToken; }` to `client.ts` at this step, update this test to mock it and assert the real token, and drop the "undefined" expectation. This is a real gap the plan's own review caught: write it now, before Step 3 below.

- [ ] **Step 2b: Add the missing `getAccessToken` export and fix the test**

Modify `src/lib/sync/client.ts` — add:

```typescript
export function getAccessToken(): string | null {
  return accessToken;
}
```

Modify the last test in Step 2 to mock and use it:

```typescript
jest.mock("../client", () => ({
  authenticatedFetch: jest.fn(),
  getAccessToken: jest.fn().mockReturnValue("at-1"),
}));
import { authenticatedFetch, getAccessToken } from "../client";

// ...in the "downloads a pulled attachment's file" test, replace the last assertion argument:
    expect(saveDownloadedAttachment).toHaveBeenCalledWith(
      "task-3",
      "att-1",
      "notes.pdf",
      expect.stringContaining("/sync/attachments/att-1"),
      "at-1",
    );
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest pull.test.ts`
Expected: FAIL — `Cannot find module '../pull'`

- [ ] **Step 4: Implement pullChanges**

Create `src/lib/sync/pull.ts`:

```typescript
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { getSyncCursor, setSyncCursor } from "@/db/repositories/settings";
import { tasks } from "@/db/schema/task";
import { subjects } from "@/db/schema/subject";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import {
  scheduleReminderNotification,
  cancelReminderNotification,
  requestNotificationPermission,
} from "@/lib/notifications";
import { saveDownloadedAttachment, attachmentFileExists } from "@/lib/files";
import { applyUpsert, applyDelete } from "./serializers";
import { authenticatedFetch, getAccessToken, SYNC_API_BASE_URL } from "./client";

export interface PullSummary {
  applied: number;
}

interface PulledOperation {
  table: string;
  entityId: string;
  operation: "upsert" | "delete";
  payload: Record<string, unknown> | null;
  clientUpdatedAt: number;
}

async function applyReminderSideEffects(entityId: string, database: Database): Promise<void> {
  const rows = await database.select().from(reminders).where(eq(reminders.id, entityId)).limit(1);
  const reminder = rows[0];
  if (!reminder) return; // just deleted, nothing to (re)schedule

  if (reminder.notificationId) {
    await cancelReminderNotification(reminder.notificationId);
  }

  if (reminder.computedFireAt.getTime() <= Date.now()) {
    await database.update(reminders).set({ notificationId: null }).where(eq(reminders.id, entityId));
    return;
  }

  const taskRows = await database
    .select({ title: tasks.title, subjectId: tasks.subjectId, dueDateTime: tasks.dueDateTime })
    .from(tasks)
    .where(eq(tasks.id, reminder.taskId))
    .limit(1);
  const task = taskRows[0];
  if (!task) return;

  const subjectRows = await database
    .select({ name: subjects.name })
    .from(subjects)
    .where(eq(subjects.id, task.subjectId))
    .limit(1);

  const permission = await requestNotificationPermission();
  let notificationId: string | null = null;
  if (permission.granted) {
    notificationId = await scheduleReminderNotification(reminder.computedFireAt, {
      taskTitle: task.title,
      subjectName: subjectRows[0]?.name ?? "",
      dueDateTime: task.dueDateTime,
    });
  }
  await database.update(reminders).set({ notificationId }).where(eq(reminders.id, entityId));
}

async function applyAttachmentSideEffects(entityId: string, database: Database): Promise<void> {
  const rows = await database.select().from(attachments).where(eq(attachments.id, entityId)).limit(1);
  const attachment = rows[0];
  if (!attachment) return; // just deleted

  if (attachmentFileExists(attachment.storedPath)) return; // already have it locally

  const accessToken = getAccessToken();
  if (!accessToken) return; // shouldn't happen mid-pull, but never crash the pull over one file

  const { storedPath } = await saveDownloadedAttachment(
    attachment.taskId,
    attachment.id,
    attachment.originalFileName,
    `${SYNC_API_BASE_URL}/sync/attachments/${attachment.id}`,
    accessToken,
  );
  await database.update(attachments).set({ storedPath }).where(eq(attachments.id, entityId));
}

export async function pullChanges(database: Database = defaultDb): Promise<PullSummary> {
  let cursor = await getSyncCursor(database);
  let applied = 0;

  while (true) {
    const response = await authenticatedFetch(`/sync/pull?since=${cursor}`);
    const body: { operations: PulledOperation[]; cursor: number } = await response.json();

    for (const op of body.operations) {
      if (op.operation === "delete") {
        await applyDelete(op.table, op.entityId, database);
      } else {
        await applyUpsert(op.table, op.entityId, op.payload, database);
      }

      if (op.table === "reminders") {
        await applyReminderSideEffects(op.entityId, database);
      }
      if (op.table === "attachments" && op.operation === "upsert") {
        await applyAttachmentSideEffects(op.entityId, database);
      }

      applied += 1;
    }

    cursor = body.cursor;
    await setSyncCursor(cursor, database);

    if (body.operations.length === 0) break;
  }

  return { applied };
}
```

This requires one more small addition — `attachmentFileExists` is not yet exported from `src/lib/files/index.ts` (only `deleteAttachmentFile`/`deleteAttachmentDirectoryForTask` check existence internally via `file.exists`). Add it alongside `saveDownloadedAttachment` in Step 1 above:

```typescript
export function attachmentFileExists(storedPath: string): boolean {
  return new File(storedPath).exists;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest pull.test.ts settings.test.ts client.test.ts`
Expected: PASS (all)

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: PASS, all suites green.

```bash
git add src/lib/sync/pull.ts src/lib/sync/__tests__/pull.test.ts src/lib/files/index.ts src/lib/sync/client.ts src/db/repositories/settings.ts src/db/repositories/__tests__/settings.test.ts src/lib/sync/__tests__/client.test.ts
git commit -m "feat(sync): add pullChanges with reminder rescheduling and attachment download"
```

---

### Task 8: `src/lib/sync/index.ts` — `runSync()`, status, and first-time backfill

**Files:**
- Create: `src/lib/sync/index.ts`
- Test: `src/lib/sync/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `pushChanges` from `./push` (Task 6); `pullChanges` from `./pull` (Task 7); `isLoggedIn`, `restoreSession` from `./client` (Task 4); `enqueueChange` from `./queue` (Task 2); `getSyncCursor` from `@/db/repositories/settings`; `semesters`, `subjects`, `tasks`, `subtasks`, `reminders`, `attachments` schema tables.
- Produces: `interface SyncResult { pushed: number; rejected: number; pulled: number }`; `class SyncNotConfiguredError extends Error`; `runSync(database?: Database): Promise<SyncResult>` (throws `SyncNotConfiguredError` if no session exists — callers decide whether that's worth surfacing); `isSyncConfigured(): Promise<boolean>`; `enqueueEverythingForInitialPush(database?: Database): Promise<void>` (walks every row in every synced table and enqueues an upsert for it — call once, right after a device's first successful login/register, so pre-existing local data actually reaches the server).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/sync/__tests__/index.test.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { getPendingChanges } from "../queue";
import { runSync, isSyncConfigured, enqueueEverythingForInitialPush, SyncNotConfiguredError } from "../index";

jest.mock("../push", () => ({ pushChanges: jest.fn().mockResolvedValue({ pushed: 0, rejected: 0 }) }));
jest.mock("../pull", () => ({ pullChanges: jest.fn().mockResolvedValue({ applied: 0 }) }));
jest.mock("../client", () => ({ isLoggedIn: jest.fn(), restoreSession: jest.fn() }));
import { pushChanges } from "../push";
import { pullChanges } from "../pull";
import { isLoggedIn, restoreSession } from "../client";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("runSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("pushes then pulls, in that order, when a session already exists", async () => {
    const db = freshTestDb();
    (isLoggedIn as jest.Mock).mockReturnValue(true);
    (pushChanges as jest.Mock).mockResolvedValueOnce({ pushed: 3, rejected: 1 });
    (pullChanges as jest.Mock).mockResolvedValueOnce({ applied: 5 });

    const result = await runSync(db);
    expect(result).toEqual({ pushed: 3, rejected: 1, pulled: 5 });

    const pushOrder = (pushChanges as jest.Mock).mock.invocationCallOrder[0];
    const pullOrder = (pullChanges as jest.Mock).mock.invocationCallOrder[0];
    expect(pushOrder).toBeLessThan(pullOrder);
  });

  it("tries restoreSession when no in-memory session exists, then proceeds if it succeeds", async () => {
    const db = freshTestDb();
    (isLoggedIn as jest.Mock).mockReturnValue(false);
    (restoreSession as jest.Mock).mockResolvedValueOnce(true);

    await runSync(db);
    expect(restoreSession).toHaveBeenCalled();
    expect(pushChanges).toHaveBeenCalled();
  });

  it("throws SyncNotConfiguredError when no session exists and restoreSession fails", async () => {
    const db = freshTestDb();
    (isLoggedIn as jest.Mock).mockReturnValue(false);
    (restoreSession as jest.Mock).mockResolvedValueOnce(false);

    await expect(runSync(db)).rejects.toThrow(SyncNotConfiguredError);
    expect(pushChanges).not.toHaveBeenCalled();
  });
});

describe("isSyncConfigured", () => {
  it("reflects isLoggedIn()", () => {
    (isLoggedIn as jest.Mock).mockReturnValue(true);
    expect(isSyncConfigured()).toBe(true);
  });
});

describe("enqueueEverythingForInitialPush", () => {
  it("enqueues every existing row across every synced table", async () => {
    const db = freshTestDb();
    await db.insert(semesters).values({ id: "sem-1", label: "2026-1", status: "active", createdAt: new Date() });
    await db.insert(subjects).values({ id: "subj-1", name: "Física", courseCode: null, professorName: null, color: "blue", semesterId: "sem-1", createdAt: new Date(), updatedAt: new Date() });
    await db.insert(tasks).values({ id: "task-1", title: "T", description: null, subjectId: "subj-1", dueDateTime: new Date(), priority: "Alta", completed: false, completedAt: null, completedLate: false, createdAt: new Date(), updatedAt: new Date() });

    await enqueueEverythingForInitialPush(db);

    const pending = await getPendingChanges(db);
    const keys = pending.map((p) => `${p.entityTable}:${p.entityId}`).sort();
    expect(keys).toEqual(["semesters:sem-1", "subjects:subj-1", "tasks:task-1"]);
    expect(pending.every((p) => p.operation === "upsert")).toBe(true);
  });

  it("is a no-op on an empty database", async () => {
    const db = freshTestDb();
    await enqueueEverythingForInitialPush(db);
    expect(await getPendingChanges(db)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/sync/__tests__/index.test.ts`
Expected: FAIL — `Cannot find module '../index'`

- [ ] **Step 3: Implement**

Create `src/lib/sync/index.ts`:

```typescript
import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import { enqueueChange } from "./queue";
import { pushChanges } from "./push";
import { pullChanges } from "./pull";
import { isLoggedIn, restoreSession } from "./client";

export class SyncNotConfiguredError extends Error {
  constructor() {
    super("No hay una sesión de sincronización activa");
    this.name = "SyncNotConfiguredError";
  }
}

export interface SyncResult {
  pushed: number;
  rejected: number;
  pulled: number;
}

export function isSyncConfigured(): boolean {
  return isLoggedIn();
}

export async function runSync(database: Database = defaultDb): Promise<SyncResult> {
  if (!isLoggedIn()) {
    const restored = await restoreSession();
    if (!restored) throw new SyncNotConfiguredError();
  }

  const pushResult = await pushChanges(database);
  const pullResult = await pullChanges(database);

  return { pushed: pushResult.pushed, rejected: pushResult.rejected, pulled: pullResult.applied };
}

const SYNCED_TABLE_DEFS = [
  { name: "semesters" as const, table: semesters },
  { name: "subjects" as const, table: subjects },
  { name: "tasks" as const, table: tasks },
  { name: "subtasks" as const, table: subtasks },
  { name: "reminders" as const, table: reminders },
  { name: "attachments" as const, table: attachments },
];

/**
 * Called once, right after a device's first successful login/register
 * (Configuración's "Sincronizar" section, Task 10) — the server has no
 * record yet of this device's pre-existing local data, so every row across
 * every synced table is queued as an upsert, exactly the same way any other
 * edit gets queued. No separate "initial sync" code path in push.ts itself.
 */
export async function enqueueEverythingForInitialPush(database: Database = defaultDb): Promise<void> {
  for (const { name, table } of SYNCED_TABLE_DEFS) {
    const rows = await database.select({ id: (table as any).id }).from(table as any);
    for (const { id } of rows) {
      await enqueueChange(name, id, "upsert", database);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/sync/__tests__/index.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS, all suites green.

```bash
git add src/lib/sync/index.ts src/lib/sync/__tests__/index.test.ts
git commit -m "feat(sync): add runSync orchestrator and first-time-login backfill"
```

---

### Task 9: `useAutoSync` — foreground + periodic trigger

**Files:**
- Create: `src/lib/sync/useAutoSync.ts`
- Modify: `app/(tabs)/_layout.tsx`
- Test: `src/lib/sync/__tests__/useAutoSync.test.ts`

**Interfaces:**
- Consumes: `runSync`, `isSyncConfigured`, `SyncNotConfiguredError` from `./index` (Task 8).
- Produces: `SYNC_INTERVAL_MS = 10 * 60 * 1000`; `useAutoSync(): void` (a hook with no return value — side-effect only, matches this codebase's other side-effect-only hooks).

This hook is added to `app/(tabs)/_layout.tsx` — the tab navigator, mounted once the user is past onboarding and inside the main app — deliberately **not** `app/_layout.tsx`, which per this plan's research already carries three documented navigation-race fixes and must stay minimal-diff (see this plan's Global Constraints).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/sync/__tests__/useAutoSync.test.ts`:

```typescript
import { renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";

import { useAutoSync } from "../useAutoSync";

jest.mock("../index", () => ({
  runSync: jest.fn().mockResolvedValue({ pushed: 0, rejected: 0, pulled: 0 }),
  isSyncConfigured: jest.fn().mockReturnValue(true),
}));
import { runSync, isSyncConfigured } from "../index";

describe("useAutoSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("runs a sync once on mount when sync is configured", async () => {
    renderHook(() => useAutoSync());
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("does not run a sync on mount when sync is not configured", async () => {
    (isSyncConfigured as jest.Mock).mockReturnValueOnce(false);
    renderHook(() => useAutoSync());
    await Promise.resolve();
    expect(runSync).not.toHaveBeenCalled();
  });

  it("runs another sync every SYNC_INTERVAL_MS while mounted", async () => {
    renderHook(() => useAutoSync());
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(10 * 60 * 1000);
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it("runs a sync when the app returns to the foreground", async () => {
    renderHook(() => useAutoSync());
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(1);

    AppState.currentState = "active";
    // @ts-expect-error — react-native's AppState mock exposes this test helper
    AppState._emitter?.emit("change", "active");
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it("swallows a SyncNotConfiguredError instead of throwing", async () => {
    const { SyncNotConfiguredError } = jest.requireActual("../index");
    (runSync as jest.Mock).mockRejectedValueOnce(new SyncNotConfiguredError());
    expect(() => renderHook(() => useAutoSync())).not.toThrow();
  });
});
```

If `react-native`'s Jest preset in this project doesn't expose `AppState._emitter` for tests (`jest-expo`'s RN mock version-dependent), replace the foreground test with a direct call to the hook's registered listener instead: capture the callback via `jest.spyOn(AppState, "addEventListener")` and invoke it manually with `"active"`. Confirm which approach works by running the test first — this is exactly why Step 2 runs it before assuming either shape.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest useAutoSync.test.ts`
Expected: FAIL — `Cannot find module '../useAutoSync'`. If the mock-shape issue from the note above surfaces instead, fix the test per that note first, confirm it now fails for the right reason (missing module), then proceed.

- [ ] **Step 3: Implement**

Create `src/lib/sync/useAutoSync.ts`:

```typescript
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { runSync, isSyncConfigured, SyncNotConfiguredError } from "./index";

export const SYNC_INTERVAL_MS = 10 * 60 * 1000;

async function trySync(): Promise<void> {
  if (!isSyncConfigured()) return;
  try {
    await runSync();
  } catch (error) {
    if (error instanceof SyncNotConfiguredError) return;
    // Network failures and everything else are swallowed here too, per the
    // design spec §6: a failed sync attempt is retried on the next trigger
    // (foreground, timer, or manual button), never surfaced as a thrown
    // error to whatever mounted this hook.
  }
}

export function useAutoSync(): void {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    trySync();

    const interval = setInterval(trySync, SYNC_INTERVAL_MS);

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        trySync();
      }
      appState.current = nextState;
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest useAutoSync.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Wire it into the tab navigator**

Modify `app/(tabs)/_layout.tsx`:

```typescript
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { useAutoSync } from "@/lib/sync/useAutoSync";

export default function TabsLayout() {
  useAutoSync();

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      {/* ...unchanged... */}
    </Tabs>
  );
}
```

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: PASS, all suites green.

```bash
git add src/lib/sync/useAutoSync.ts src/lib/sync/__tests__/useAutoSync.test.ts "app/(tabs)/_layout.tsx"
git commit -m "feat(sync): add foreground/periodic auto-sync trigger"
```

---

### Task 10: Configuración UI — login/register + "Sincronizar ahora"

**Files:**
- Modify: `app/configuracion/index.tsx`

**Interfaces:**
- Consumes: `register`, `login`, `logout`, `isLoggedIn` from `@/lib/sync/client`; `runSync`, `enqueueEverythingForInitialPush` from `@/lib/sync`; `getSyncCursor` from `@/db/repositories/settings` (already exists as of Task 7).

No new automated tests — matches this project's own established convention that pure-UI screen wiring (as opposed to domain/repository logic) doesn't get a `.tsx` component test (see e.g. Phase 6/6.5/9's UI tasks). Verified instead by this task's own on-device checklist item in Task 11.

- [ ] **Step 1: Add the Sincronizar section**

Modify `app/configuracion/index.tsx` — add imports:

```typescript
import { register, login, logout, isLoggedIn } from "@/lib/sync/client";
import { runSync, enqueueEverythingForInitialPush, SyncNotConfiguredError } from "@/lib/sync";
```

Add state, right after the existing `importing` state:

```typescript
  const [syncEmail, setSyncEmail] = useState("");
  const [syncPassword, setSyncPassword] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncLoggedIn, setSyncLoggedIn] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    setSyncLoggedIn(isLoggedIn());
  }, []);
```

Add handlers, after `handleImportPress`/`runImport`:

```typescript
  async function handleSyncAuth(mode: "login" | "register") {
    if (!syncEmail.trim() || !syncPassword) {
      Alert.alert("Datos incompletos", "Ingresá un email y una contraseña.");
      return;
    }
    setSyncing(true);
    try {
      if (mode === "register") {
        await register(syncEmail.trim(), syncPassword);
      }
      await login(syncEmail.trim(), syncPassword);
      await enqueueEverythingForInitialPush();
      setSyncLoggedIn(true);
      setSyncPassword("");
      setSyncStatus("Cuenta vinculada. Sincronizando…");
      await handleSyncNow();
    } catch {
      Alert.alert("Error", "No se pudo iniciar sesión de sincronización.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const result = await runSync();
      setSyncStatus(
        `Última sincronización: ${new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })} · ${result.pulled} cambio(s) recibido(s), ${result.pushed} enviado(s).`,
      );
    } catch (error) {
      if (error instanceof SyncNotConfiguredError) {
        setSyncLoggedIn(false);
        setSyncStatus(null);
      } else {
        setSyncStatus("No se pudo sincronizar. Se reintentará automáticamente.");
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncLogout() {
    setSyncing(true);
    try {
      await logout();
      setSyncLoggedIn(false);
      setSyncStatus(null);
    } finally {
      setSyncing(false);
    }
  }
```

Add the section JSX, between the "Datos" `dataSection` block and the "Puntualidad" one:

```tsx
          <View style={styles.dataSection}>
            <Text style={styles.sectionTitle}>Sincronizar</Text>
            {syncLoggedIn ? (
              <>
                <Text style={styles.sectionNote}>
                  {syncStatus ?? "Cuenta vinculada. Sincroniza automáticamente cada 10 minutos."}
                </Text>
                <TouchableOpacity
                  style={[styles.secondaryButton, syncing && styles.saveButtonDisabled]}
                  onPress={handleSyncNow}
                  disabled={syncing}
                >
                  <Text style={styles.secondaryButtonText}>
                    {syncing ? "Sincronizando…" : "Sincronizar ahora"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryButton, syncing && styles.saveButtonDisabled]}
                  onPress={handleSyncLogout}
                  disabled={syncing}
                >
                  <Text style={styles.secondaryButtonText}>Cerrar sesión de sincronización</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.sectionNote}>
                  Vinculá una cuenta para compartir tus datos entre dispositivos.
                </Text>
                <TextInput
                  style={styles.input}
                  value={syncEmail}
                  onChangeText={setSyncEmail}
                  placeholder="Email"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <TextInput
                  style={styles.input}
                  value={syncPassword}
                  onChangeText={setSyncPassword}
                  placeholder="Contraseña"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                />
                <TouchableOpacity
                  style={[styles.secondaryButton, syncing && styles.saveButtonDisabled]}
                  onPress={() => handleSyncAuth("login")}
                  disabled={syncing}
                >
                  <Text style={styles.secondaryButtonText}>Iniciar sesión</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryButton, syncing && styles.saveButtonDisabled]}
                  onPress={() => handleSyncAuth("register")}
                  disabled={syncing}
                >
                  <Text style={styles.secondaryButtonText}>Crear cuenta</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this file.

Run: `npm run lint`
Expected: clean on `app/configuracion/index.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/configuracion/index.tsx
git commit -m "feat(sync): add Sincronizar section to Configuración"
```

---

### Task 11: Device verification (DoD)

No agent drives an emulator for this phase (matches this project's established split for UI-heavy phases — e.g. Phase 7/8's own device-checklist convention). This task produces the checklist file and runs the final automated gate only.

- [ ] **Step 1: Final automated check**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 2: Write the on-device checklist**

Create `.superpowers/sdd/phaseC-device-checklist.md`:

```markdown
# Phase C — Client Sync Engine — On-Device Checklist

Prerequisite: the sync backend from Phases A/B is live at
https://unitask-sync.zdevs.uk and has the C1/I1-I8/M1-M7 fixes deployed.

1. **First-time link, device A**: Configuración → Sincronizar → Crear cuenta
   with a fresh email. Confirm it doesn't error, and that the status line
   shows a sync completed shortly after (pushed count > 0 if this device
   already has data).
2. **Second device, same account**: fresh install (or clear app data),
   Configuración → Sincronizar → Iniciar sesión with the same account.
   Confirm the device's existing dataset (semesters/subjects/tasks/
   subtasks/reminders) appears after the first automatic sync.
3. **Create a task offline on device A**: turn on airplane mode, create a
   task, turn airplane mode back off, open device B (or press
   "Sincronizar ahora" on B) — confirm the task appears on B.
4. **Delete a task on one device**: confirm it disappears on the other
   after that device's next sync.
5. **Edit the same task on both devices while both are offline**, then
   reconnect both — confirm the result is one predictable version on both
   (last write wins), not a crash or a duplicate row.
6. **Reminder sync**: create a task with a reminder on device A, sync
   device B, confirm the reminder actually fires as a notification on
   device B at the right time (not just that the row exists).
7. **Attachment sync**: attach a photo to a task on device A, open the
   same task on device B — confirm the attachment downloads and opens
   (may take a moment the first time, per the design's lazy-download
   decision).
8. **Foreground trigger**: background the app on device A for a few
   minutes with a pending change, then reopen it — confirm a sync runs
   without pressing the manual button.
9. **Logout**: Configuración → Cerrar sesión de sincronización on one
   device — confirm further local edits do NOT sync until logging back in
   (the outbox should still queue them locally, just not be sent).
10. **Closed-semester edge case**: with a semester closed on device A,
    confirm a pulled change to one of that semester's tasks (created on
    device B before A closed it) still applies cleanly on A — this is the
    "bypass assertTaskEditable for pulled operations" decision from this
    plan's Global Constraints; a crash or a silently-dropped operation
    here would mean that decision wasn't correctly implemented.
```

- [ ] **Step 3: Commit**

```bash
git add .superpowers/sdd/phaseC-device-checklist.md
git commit -m "docs: add Phase C on-device verification checklist"
```
