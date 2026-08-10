# 02 — Functional Requirements

This document lists the CRUD operations and functional constraints for each entity/feature area. Derivation rules (how status, progress, "vencida", etc. are computed) are the single responsibility of `03-business-rules.md` — this document references them but does not redefine them.

## Semesters

- **Create**: user provides a free-text label (e.g. "2026-1"). Creating a new semester while another is active automatically closes the previously active one (see `03-business-rules.md`, "One active semester" rule). The very first semester ever created becomes active immediately.
- **Read**: list all semesters (active + closed), view details of one semester including its subjects.
- **Update**: only the active semester's label may be edited (assumption: editing the label of a closed semester is blocked, consistent with the read-only-when-closed rule).
- **Close**: manual, user-initiated action ("Cerrar semestre"). Requires confirmation (destructive-style action). Sets `status = closed` and `closedAt = now`. After closing, the semester and everything under it becomes read-only (see `03-business-rules.md`).
- **Delete**: not supported in v1 (assumption — semesters are historical records once created; there is no delete-semester flow in the MVP UI, only close). Deleting would cascade-destroy academic history, which is not a decision the product owner made explicitly, so it is intentionally left out.
- **Constraint**: exactly one semester has `status = active` at all times, from the moment the first semester is created onward. There is never a state with zero semesters after first-run setup.

## Subjects (Materias)

- **Create**: requires name and a semester (defaults to the active semester); course code, professor name, and color are optional/defaulted. Cannot create a subject inside a closed semester.
- **Read**: list subjects grouped/filterable by semester; view a single subject's detail (its task list, professor, code, color).
- **Update**: edit name, course code, professor, color. Blocked if the subject belongs to a closed semester.
- **Delete**: blocked if the subject has any task in "Pendiente" or "En progreso" status — the UI must show the count of blocking tasks and require the user to resolve them (complete, delete, or reassign to another subject) first. If the subject has zero pending/in-progress tasks (i.e. only completed tasks, or none at all), deletion is allowed and any completed tasks referencing that subject are cascade-deleted along with it. Blocked if the subject belongs to a closed semester (closed semesters are read-only regardless of task state).
- **Constraint**: color must be one of the fixed palette values (see `03-business-rules.md`); free-form color entry is not supported.

## Tasks

- **Create**: requires title, subject (FK), due date, due time, and priority. Description, subtasks, reminders, and attachments are optional at creation time. A new task automatically receives one default reminder unless the user removes it during creation (see Reminders below). Cannot create a task under a subject that belongs to a closed semester.
- **Read**: list tasks with filter chips (Todas / Pendientes / En progreso / Completadas / Vencidas — all computed, see `03-business-rules.md`); view full task detail (subtasks, reminders, attachments, derived status/progress).
- **Update**: edit title, description, subject, due date/time, priority, subtasks, reminders, attachments. Editing the due date recalculates relative-offset reminders and may flag/remove past-dated custom reminders (see `03-business-rules.md`). Blocked entirely if the task's subject belongs to a closed semester.
- **Complete**: two equivalent entry points — the inline checkbox on the task list, and the "Marcar como completada" button on the task detail screen. Both invoke the same completion logic: set `completed = true`, set `completedAt = now`, compute and store `completedLate`, auto-check all subtasks (see `03-business-rules.md`), and cancel all pending scheduled notifications for that task.
- **Delete**: requires confirmation. Cancels all pending scheduled notifications for the task and deletes all of its copied attachment files from app storage. Blocked if the task's subject belongs to a closed semester.
- **Constraint**: status ("Pendiente" / "En progreso" / "Completada" / "Vencida") and progress percentage are never directly set by the user — both are always derived (see `03-business-rules.md`).

## Subtasks

- **Create/Update/Delete/Reorder**: managed only from within the parent task's edit form (Nueva/Editar Tarea) or task detail screen. Each subtask has text, a completed flag, and an order position.
- **Constraint**: no individual due date, reminder, or priority on a subtask — those attributes only exist on the parent task. Blocked entirely (add/edit/reorder/remove) if the parent task's subject belongs to a closed semester.
- **Side effect**: checking/unchecking a subtask recomputes the parent task's derived progress and status in real time (see `03-business-rules.md`).

## Reminders

- **Create**: available in two places — (1) as an optional step of the Nueva Tarea form, and (2) from the task detail screen at any time after creation. Each reminder is either a relative offset from the task's due datetime (e.g. "1 día antes") or a custom fixed datetime.
- **Read**: list all reminders attached to a task, shown on the task detail screen.
- **Update**: edit the offset/datetime of an existing reminder; this reschedules its underlying OS notification (cancel + reschedule).
- **Delete**: remove a reminder, which cancels its underlying scheduled OS notification.
- **Default reminder**: every newly created task receives one suggested default reminder automatically (see `03-business-rules.md` for the exact default). The user may edit or remove it during creation; tasks are never created with zero reminders unless the user explicitly removes the default.
- **Constraint**: reminders cannot be added/edited/removed on a task whose subject belongs to a closed semester.

## Attachments

- **Add (attach)**: pick a file via the system file picker; validate type and size; copy it into app-private sandboxed storage; store an attachment record pointing at the local copy. See `09-file-management.md` for the full flow.
- **Read**: list attachments on a task; view/open one via Android's native "open with" intent.
- **Delete**: remove a single attachment (deletes its copied file from app storage) or implicitly delete all of a task's attachments when the task itself is deleted.
- **Constraint**: max 25 MB per file; allowed types are PDF, DOCX, XLSX, PPTX, JPG/JPEG/PNG/HEIC, and TXT. Other types are rejected at the picker level. No total per-task size cap in v1. Blocked entirely on a task whose subject belongs to a closed semester.

## Dashboard

- **Read-only** screen composed of: greeting header, stat tiles (Pendientes / Hoy / Completadas últimos 7 días), a "Tareas urgentes" horizontal list, and a "Próximas entregas" vertical list. Exact composition rules for each widget are defined in `03-business-rules.md`.
- Tapping a task in either list navigates to its detail screen.

## Calendar

- **Read**: month-view grid; days with at least one task show a small dot indicator (see `03-business-rules.md` for dot color rule).
- **Interact**: selecting a day opens an inline panel listing that day's tasks (no screen navigation); the panel includes a contextual "Añadir tarea" action that pre-fills the due date with the selected day.
- **Constraint**: week/day view is out of scope for v1 (see `01-product.md`).

## Progress

- **Read-only** statistics screen derived from stored task/subtask data (e.g. completion rates, per-subject breakdowns). No create/update/delete operations live here.

## Settings

- **Export data**: writes a single JSON file containing all local data (semesters, subjects, tasks, subtasks, reminders, attachments metadata, settings) and opens the system share sheet via `expo-sharing` so the user can save or send it anywhere.
- **Import data**: lets the user pick a previously exported JSON file and restores it. Import **replaces all local data** after an explicit confirmation warning; there is no partial/merge import in v1 (see `03-business-rules.md` and `11-roadmap.md` for the future merge-import note).
- **No theme section**: dark mode is not exposed as a toggle in v1 (see `01-product.md`).
- **No notification settings section**: reminder management is entirely per-task; there is no global notification toggle or overdue-task digest in v1.
