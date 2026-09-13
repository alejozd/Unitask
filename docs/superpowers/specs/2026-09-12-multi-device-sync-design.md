# Multi-Device Sync — Design

**Date:** 2026-09-12
**Status:** Approved for planning (pending final spec review)

## 1. Problem and scope

UniTask is currently local-first only: all data lives in a per-device SQLite database (Drizzle ORM, `expo-sqlite`), with no backend, no accounts, and no cross-device data sharing. The only existing cross-device mechanism is the Phase 9 JSON export/import feature, which is a manual, full-replace backup — not a sync mechanism.

The user (a single person) will likely install UniTask on a second device (a tablet) in addition to their phone, and expects the same data — semesters, subjects, tasks, subtasks, reminders, attachments, profile — to be available and stay consistent across both.

**In scope:**
- One user account, exactly two (or more, unbounded in principle) devices belonging to that one person.
- Sync of all 7 domain tables: `semesters`, `subjects`, `tasks`, `subtasks`, `reminders`, `attachments` (metadata **and** file contents), `settings`.
- Real email/password authentication (chosen over a lightweight device-pairing code, to leave the door open to future multi-user use).
- Sync triggered on app foreground, on a periodic timer while foregrounded, and via a manual "Sincronizar ahora" action — explicitly **not** real-time/live (no WebSocket requirement).

**Out of scope (explicitly deferred):**
- Multiple distinct user accounts with separate data sets (single-user-per-account model only, for now).
- Real-time/instant propagation while both apps are open simultaneously.
- Rich conflict UI ("this changed on your other device, pick a version") — conflicts resolve silently via last-write-wins.
- Anything beyond what's needed for one person's two devices to converge to the same state.

## 2. Current state (verified against the codebase)

- Client DB: `src/db/client.ts` — `expo-sqlite` + Drizzle, schema in `src/db/schema/*`.
- `tasks` and `subjects` already have `createdAt`/`updatedAt` columns.
- `semesters` has `createdAt`/`closedAt` only — **no `updatedAt`**.
- `reminders` has `createdAt` only — **no `updatedAt`**.
- `subtasks` and `attachments` have **no timestamp columns at all**.
- All deletes today are physical (`DELETE`, several via `ON DELETE CASCADE`) — there is no soft-delete/tombstone concept anywhere in the schema.
- Every write path is already centralized in `src/db/repositories/*` (e.g. `createTask`, `updateTask`, `deleteTask`, `addSubtask`, `addReminder`, `addAttachment`, `saveProfile`, `createSemester`, `closeSemester`) — there is no ad-hoc `db.insert(...)` scattered across screens.
- Every read path (`app/(tabs)/*`, `app/tarea/[id]/index.tsx`, etc.) uses `useLiveQuery` directly against the domain tables, with no existing notion of filtering out "deleted" rows (because nothing is ever soft-deleted today).
- Attachments: metadata row in `attachments` table + a real file under `{Paths.document}/attachments/{taskId}/...` on-device (`src/lib/files/index.ts`). Phase 9's export/import already established the precedent of NOT round-tripping attachment binaries (only metadata), disclosed to the user as a known limitation.
- No backend, no auth, no network client of any kind exists in this codebase today.

These facts directly shape section 4 below (why an append-only change log was chosen over per-table `updatedAt`/`deletedAt` diffing).

## 3. High-level architecture

```
Phone (Expo app)             Tablet (Expo app)
  SQLite (source of truth      SQLite (source of truth
   for offline use, unchanged)  for offline use, unchanged)
        |                              |
   sync client (new)             sync client (new)
        |                              |
        +----------- HTTPS ------------+
                      |
              Cloudflare (TLS + proxy)
                      |
        Sync API on the user's Ubuntu server
        (Node + Fastify, managed by pm2)
                      |
                 PostgreSQL
```

- The app remains local-first: every screen keeps reading and writing its local SQLite exactly as it does today, offline-capable. Sync is an additive layer, not a replacement for the current data flow.
- Backend: Fastify (TypeScript) + Drizzle against PostgreSQL — same ORM already used client-side, different driver.
- Deployment: one more Node process under the user's existing `pm2`, exposed through a dedicated subdomain behind Cloudflare, same pattern as the user's other sites.
- Auth: email + password (bcrypt-hashed), short-lived JWT access token + longer-lived refresh token stored via `expo-secure-store` on-device.

## 4. Sync protocol

### 4.1 Why an append-only change log, not per-table `updatedAt`/`deletedAt` diffing

The obvious alternative — add `updatedAt` to every table (backfilling the four that lack it) and `deletedAt` to every table, then diff by timestamp — was rejected because it requires converting every physical `DELETE` in the app to a soft-delete, which in turn requires adding a `deletedAt IS NULL` filter to **every existing read query** across every screen (Dashboard, Calendario, Mis Tareas, Progreso, task detail). That is a much larger and riskier blast radius than the write-side-only change described below, given this codebase's read paths currently have zero notion of soft-deleted rows.

Instead: a local-only `sync_log` table records every mutation as it happens, and existing read paths are untouched.

### 4.2 Local schema addition

```
sync_log (client-only table, not part of the 7 domain tables)
  id             integer primary key autoincrement
  entityTable    text        -- e.g. "tasks"
  entityId       text        -- the domain row's own id
  operation      text        -- "upsert" | "delete"
  payload        text (json) -- full row snapshot for "upsert"; null for "delete"
  clientUpdatedAt integer    -- timestamp, used only for last-write-wins tie-breaking
  syncedAt       integer     -- null until the server has accepted this entry
```

Every write-path repository function (`createTask`, `updateTask`, `deleteTask`, `addSubtask`, `toggleSubtask`, `removeSubtask`, `createSubject`, `deleteSubject`, `addReminder`, the reminder cancel/reschedule helpers, `addAttachment`, `removeAttachment`, `saveProfile`, `createSemester`, `closeSemester`) gets one additional call to append the corresponding `sync_log` row, inside the same transaction where one exists. This is the single largest-surface change in this project (roughly 15 call sites across as many files), though each individual change is a one-line insert.

### 4.3 Push

`POST /sync/push` sends every `sync_log` row where `syncedAt IS NULL`. For each operation, the server applies it only if its `clientUpdatedAt` is at or after the server's currently stored value for that `(userId, table, entityId)` — otherwise the incoming operation is dropped as stale (a genuinely older write arriving late loses to whatever is already stored). The server returns which log ids were accepted so the client can mark them `syncedAt`.

This is the full conflict-resolution policy: **last write wins**, silently. Given a single person operating two devices, a true simultaneous conflicting edit (same row, edited on both devices, both offline, before either syncs) is rare; accepting silent LWW here is a deliberate scope decision, not an oversight. A "this was changed elsewhere" notice is a plausible fast-follow, not part of this design.

### 4.4 Pull

`GET /sync/pull?since=<serverSeq>` returns every operation with a server-assigned sequence number greater than the client's last-seen cursor, in ascending order. The cursor is a server-side counter, not wall-clock time — this avoids any dependence on clock sync between the phone and the tablet. The client applies each operation (upsert or delete against the matching local table by id) and stores the new high-water-mark cursor.

Applying pulled operations in ascending `serverSeq` order respects foreign-key order in the overwhelming common case, because the app itself only ever creates a child row (task, subtask, reminder, attachment) after its parent already exists. A first-time full pull (a fresh device, `since=0`) exercises this same code path with a large batch — no separate "initial sync" endpoint is needed.

### 4.5 Attachments

The attachment's metadata row (filename, mime type, size, `taskId`) travels through the same `sync_log`/push/pull mechanism as every other table. The file's bytes are handled separately:
- `POST /sync/attachments/:attachmentId` (multipart) uploads the file after (or alongside) the metadata sync.
- `GET /sync/attachments/:attachmentId` downloads it, authorized against the requesting user's own data only.
- A device that pulls an attachment's metadata but has no local file for it fetches the file lazily — when the task is opened, or via a small background download queue — rather than bulk-downloading every attachment on every sync. This mirrors the existing "Archivo no disponible" fallback UX (`AttachmentFileNotFoundError`, `src/lib/files/index.ts`) from Phase 9, but resolves it by downloading instead of surfacing a permanent failure.

### 4.6 When sync runs

- On app foreground/launch.
- On a periodic timer while the app is foregrounded, every 10 minutes (a fixed constant, adjustable later if it proves too eager or too slow in practice).
- On explicit user action: a "Sincronizar ahora" button in `app/configuracion/index.tsx`, next to the existing Exportar/Importar actions.
- Opportunistically: a best-effort, non-blocking push attempt right after any local write, so a device's own changes reach the server promptly even between periodic ticks (this does not make the *other* device's pull real-time — it only shortens how long a change waits before it's available to be pulled).

## 5. Server API and data model

### 5.1 Endpoints

- `POST /auth/register` — `{ email, password }`
- `POST /auth/login` — `{ email, password }` → `{ accessToken, refreshToken }`
- `POST /auth/refresh` — `{ refreshToken }` → rotated `{ accessToken, refreshToken }`
- `POST /auth/logout` — `{ refreshToken }` → revokes it
- `POST /sync/push` — `{ operations: [...] }` → `{ accepted: [...ids], rejected: [...ids] }`
- `GET /sync/pull?since=<cursor>` → `{ operations: [...], cursor }`
- `POST /sync/attachments/:attachmentId` (multipart) → `{ ok: true }`
- `GET /sync/attachments/:attachmentId` → file stream

All `/sync/*` endpoints require `Authorization: Bearer <accessToken>`; every query is scoped to the token's `userId`.

### 5.2 PostgreSQL schema

The server does not mirror the 7 domain tables individually — it does not need to understand tasks/subjects/reminders as distinct relational shapes. A single generic store is sufficient:

```
users            id, email, passwordHash, createdAt
refresh_tokens   id, userId, tokenHash, expiresAt, revokedAt
entities         userId, table, entityId, payload (jsonb), deleted (bool),
                 serverSeq (autoincrement), updatedAt
```

The server trusts the client's payloads and does not re-validate domain business rules (e.g. "a subtask requires an existing task") — the same trust model Phase 9's full-replace import already established for a full-system write. This keeps the backend intentionally small: it is a generic, per-user, ordered JSON relay, not a second implementation of UniTask's domain model.

Attachment files are stored on disk under a per-user, per-task directory (e.g. `<data-dir>/attachments/<userId>/<taskId>/<attachmentId>-<filename>`), referenced by the corresponding `entities` row's payload.

## 6. Client-side changes

- New module `src/lib/sync/` (same convention as `src/lib/notifications/`, `src/lib/files/`):
  - Schema/migration: adds `updatedAt` to `semesters`, `reminders`, `subtasks`, `attachments` (backfilled from `createdAt` for existing rows); adds the new `sync_log` table.
  - `pushChanges()`, `pullChanges()`, `runSync()` — orchestration, wired to app-foreground, the periodic timer, and the manual button described in §4.6.
  - The ~15 one-line hooks into existing repository functions described in §4.2.
  - Attachment upload/download queue described in §4.5.
- New dependency: `expo-secure-store`, for the refresh token (never stored in plain SQLite alongside app data).
- Network failures during sync are caught and swallowed at the `runSync()` level — a failed sync attempt is retried on the next trigger, never surfaced as an app error to the user beyond (optionally) a subtle "no se pudo sincronizar" indicator.

## 7. Deployment

- A new Node/Fastify process added to the user's existing `pm2` setup, with `DATABASE_URL` and a JWT signing secret in its environment.
- A new, dedicated PostgreSQL database (`unitask_sync`) on the user's existing PostgreSQL instance — a separate database rather than a schema inside an existing one, for simpler isolated backups and credentials.
- A dedicated subdomain (e.g. `api.unitask.<domain>`) behind Cloudflare, proxied the same way as the user's other sites; routed to the new pm2 process via whatever reverse proxy (nginx/Caddy) already fronts the other sites, or via a Cloudflare Tunnel if the user prefers not to open an additional port.
- Attachment files stored on the server's local disk under the sync API's data directory; no object storage service is introduced for this scale.

## 8. Testing and verification

- **Backend:** unit tests for push/pull (including the last-write-wins acceptance/rejection logic), the full auth flow (register/login/refresh/expiry/revocation), and that a user can never read or write another user's `entities` rows or attachment files.
- **Client:** unit tests confirming each hooked repository function writes the expected `sync_log` entry; unit tests for applying a batch of pulled operations to local SQLite (upsert/delete correctness, ordering).
- **Manual on-device checklist** (same convention already used at the end of every phase in this project):
  1. Create a task offline on the phone; go online; open the tablet app (or press "Sincronizar ahora") and confirm the task appears.
  2. Delete a task on one device; confirm it disappears on the other after syncing.
  3. Edit the same task on both devices while both are offline, then reconnect both — confirm the result is one predictable version, not a crash or duplicate.
  4. Take a photo attachment on the phone; open the same task on the tablet; confirm the attachment downloads and opens.
  5. Log in with the same account on a brand-new install (simulating the tablet's first setup) and confirm the full existing dataset arrives via the initial pull.

## 9. Explicit trade-offs and deferred items

- **Silent last-write-wins** instead of conflict surfacing — acceptable given the single-user, two-device, non-simultaneous-use profile; revisit if real conflicts are ever observed in practice.
- **No real-time propagation** — a device only sees another device's changes after its own next sync trigger (foreground open, periodic tick, or manual button), never instantly while both apps are open.
- **Attachments download lazily, not eagerly** — avoids a large upfront transfer on a new device, at the cost of a brief "downloading…" moment the first time an older attachment is opened on a device that never had it.
- **Single-user-per-account model only** — the schema (`entities` keyed by `userId`) does not preclude adding real multi-user sharing later, but nothing in this design implements it.
