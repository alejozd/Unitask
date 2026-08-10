# 06 — Data Model

All entities below are persisted locally via Drizzle ORM over `expo-sqlite` (see `07-architecture.md`). Identifiers are UUID strings (assumption: generated client-side, so the model is stable for a future remote-sync reconciliation without renumbering local rows). Timestamps are stored as ISO-8601 strings or SQLite integer epoch millis — exact column type is an implementation detail of the Drizzle schema, not a discovery-phase decision.

---

## Semester

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | string (UUID) | no | Primary key |
| `label` | string | no | Free text, e.g. "2026-1" |
| `status` | enum(`active`, `closed`) | no | Exactly one `active` semester at all times (see `03-business-rules.md` §10) |
| `createdAt` | datetime | no | |
| `closedAt` | datetime | yes | Set only when `status` transitions to `closed` |

**Relationships**: one Semester → many Subjects.

---

## Subject (Materia)

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | string (UUID) | no | Primary key |
| `name` | string | no | Required |
| `courseCode` | string | yes | e.g. "MAT-201" |
| `professorName` | string | yes | |
| `color` | enum (palette key) | no | One of the fixed palette values (`03-business-rules.md` §8); defaults to a palette color if unspecified |
| `semesterId` | string (UUID, FK → Semester.id) | no | Required |
| `createdAt` | datetime | no | |
| `updatedAt` | datetime | no | |

**Relationships**: many Subjects → one Semester. One Subject → many Tasks.

**Read-only when closed**: a Subject whose `semesterId` points at a Semester with `status = closed` cannot be created, edited, or deleted (`03-business-rules.md` §11). Enforced at the business-logic layer, not just the UI.

---

## Task

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | string (UUID) | no | Primary key |
| `title` | string | no | Required |
| `description` | string | yes | |
| `subjectId` | string (UUID, FK → Subject.id) | no | Required |
| `dueDate` | date | no | Stored as a single combined date+time value **(assumption: the Nueva Tarea form presents "due date" and "due time" as two separate fields per the product spec, but they are persisted as one `dueDateTime` timestamp column since every business rule — status, "vencida", reminder offsets — operates on a single instant)** |
| `priority` | enum(`Alta`, `Media`, `Baja`) | no | Drives the stripe color: High `#EF4444`, Medium `#F59E0B`, Low `#10B981` (all three get a colored stripe) |
| `completed` | boolean | no | Default `false`. User-set via completion action only (`03-business-rules.md` §5) |
| `completedAt` | datetime | yes | Set once, at completion |
| `completedLate` | boolean | no | Default `false`. Set once at completion (`03-business-rules.md` §4); never recalculated afterward |
| `createdAt` | datetime | no | |
| `updatedAt` | datetime | no | |

**Not stored (derived at read time — see below)**: status label, "vencida", progress %.

**Relationships**: many Tasks → one Subject. One Task → many Subtasks, many Reminders, many Attachments.

**Read-only when closed**: a Task whose Subject belongs to a closed Semester cannot be created, edited, completed, or deleted (`03-business-rules.md` §11).

---

## Subtask

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | string (UUID) | no | Primary key |
| `taskId` | string (UUID, FK → Task.id) | no | Required |
| `text` | string | no | |
| `completed` | boolean | no | Default `false` |
| `order` | integer | no | Position within the parent task's list |

**Relationships**: many Subtasks → one Task. Cascade-deleted when the parent Task is deleted.

No individual due date, reminder, or priority — those attributes exist only on the parent Task.

---

## Reminder

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | string (UUID) | no | Primary key |
| `taskId` | string (UUID, FK → Task.id) | no | Required |
| `kind` | enum(`relative`, `fixed`) | no | |
| `offsetValue` | integer | yes | Required when `kind = relative`, e.g. `1` |
| `offsetUnit` | enum(`minutes`, `hours`, `days`) | yes | Required when `kind = relative`, e.g. `days` |
| `fixedDateTime` | datetime | yes | Required when `kind = fixed` |
| `computedFireAt` | datetime | no | Absolute fire time, always kept up to date: for `relative`, recomputed as `task.dueDate - offset`; for `fixed`, equal to `fixedDateTime` |
| `notificationId` | string | yes | The identifier returned by `expo-notifications` when the OS notification is scheduled; `null` once fired or cancelled |
| `createdAt` | datetime | no | |

**Relationships**: many Reminders → one Task. Cascade-deleted when the parent Task is deleted; individually deleted per the reschedule rules in `03-business-rules.md` §7.

---

## Attachment

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | string (UUID) | no | Primary key |
| `taskId` | string (UUID, FK → Task.id) | no | Required |
| `originalFileName` | string | no | Name as picked by the user, shown in UI |
| `storedPath` | string | no | Path to the copied file inside app-private sandbox storage (see `09-file-management.md`) |
| `mimeType` | string | no | Validated against the allowed-type list at attach time (`03-business-rules.md` §9) |
| `sizeBytes` | integer | no | Validated against the 25 MB max at attach time |
| `createdAt` | datetime | no | |

**Relationships**: many Attachments → one Task. Cascade-deleted (record + underlying file) when the parent Task is deleted (`03-business-rules.md` §6, §9).

---

## Settings

A single-row (singleton) table for the local device's preferences.

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | string (fixed, e.g. `"singleton"`) | no | Always exactly one row |
| `createdAt` | datetime | no | |
| `updatedAt` | datetime | no | |

**(assumption)**: kept intentionally minimal for v1 — no theme field (dark mode is hidden entirely, not just defaulted, per `01-product.md`), no global notification toggle (reminder management is per-task, per `03-business-rules.md`). The table exists mainly as a stable extension point for future preferences (e.g. a theme choice once dark mode ships) rather than to hold any MVP-visible setting today.

---

## User / Profile

There is no explicit User/Profile table in v1. The app operates as a single implicit local user with no authentication — all data belongs to "the device's one user" by default. This keeps the schema simple while not precluding a future `User` table and remote account association being introduced alongside sync support (`01-product.md`).

---

## Entity-relationship summary

```
Semester 1───N Subject 1───N Task 1───N Subtask
                                  │
                                  ├───N Reminder
                                  │
                                  └───N Attachment

Settings — standalone singleton, no relationships
```

---

## Derived (not stored) fields — summary

These values are **never** persisted as columns; they are always computed at read time from the stored fields above, per the exact formulas in `03-business-rules.md`:

| Derived value | Computed from | Rule reference |
|---|---|---|
| Task status label (Pendiente / En progreso / Completada / Vencida) | `completed`, `completedAt`, subtask completion ratio, `dueDate`, current time | §1 |
| "Vencida" (overdue) flag | `dueDate`, `completed`, current time | §3 |
| Progress % | completed subtasks / total subtasks (or binary 0↔100 with zero subtasks) | §2 |
