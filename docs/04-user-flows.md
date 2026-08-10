# 04 — User Flows

Step-by-step flows for UniTask's key journeys. Screen names match `05-navigation.md`; derivation/cascade rules referenced here are defined precisely in `03-business-rules.md`.

---

## 1. First run (mandatory data bootstrap)

Triggered the very first time the app is opened, when zero semesters exist locally.

1. App launches directly into a minimal first-run prompt — **not** a marketing/tutorial carousel — explaining that UniTask organizes work by academic semester and asking the user to create their first one.
2. User enters a semester label (e.g. "2026-1") and confirms.
3. The new semester is created and automatically set as `active` (it's the first one, so there is no previous active semester to close — rule in `03-business-rules.md` §10 only applies from the second semester onward).
4. App navigates to the Dashboard, which is now in an empty state ("No tienes materias todavía" or similar) since no subjects exist yet.
5. User taps the FAB ("+") on Dashboard or Materias to create their first subject: enters name, optionally course code/professor, picks a color from the fixed palette (§8), confirms. The active semester is implied automatically.
6. Once at least one subject exists, the user can create their first task from the Materias, Tareas, or Calendario FAB (see flow 2 below).

This is the only unavoidable "onboarding" step — it is data bootstrap (you cannot have a subject without a semester), not a feature tutorial.

---

## 2. Create a task (with reminders and attachments)

1. User taps the FAB ("+") from Home, Tareas, or Calendario (Calendario pre-fills the due date if a day is already selected in the inline panel).
2. Nueva Tarea modal opens (slide-up, with a close "X").
3. User fills required fields: title, subject (picker, defaults to none — must be explicitly chosen), due date, due time, priority (Alta/Media/Baja).
4. User optionally adds a description.
5. User optionally adds subtasks (text items, orderable).
6. Reminders step: the form already shows **one default reminder** ("1 día antes") pre-populated per `03-business-rules.md` §7. The user may edit its offset, add more reminders (relative or custom fixed-datetime, via the Reminder picker component), or remove it entirely.
7. User optionally attaches files: opens the system document/image picker, selects a file; the app validates type and size (§9) and shows an error inline if rejected; on success, the file is copied to app-private storage and listed as an attachment.
8. User confirms ("Guardar" / "Crear tarea"). The task is created with:
   - `completed = false`, derived status starts as "Pendiente" (assuming due date is in the future and there are no completed subtasks yet).
   - Each configured reminder is scheduled as a local OS notification (see `08-notifications.md`).
9. Modal closes; user lands back on the originating screen, where the new task now appears in the relevant list.

If the subject picker is empty (no subjects exist), the user is redirected to create a subject first (see flow 1, step 5).

---

## 3. Complete a task

Two equivalent entry points:

**A. From the task list (quick-complete):**
1. User taps the inline checkbox next to a task row.
2. Completion logic runs immediately (`03-business-rules.md` §5): `completed = true`, `completedAt = now`, `completedLate` computed, all subtasks auto-checked, all pending reminders for the task cancelled.
3. The row updates in place to reflect "Completada" status (and disappears from filters like "Pendientes" / "Vencidas" if currently applied).

**B. From the task detail screen:**
1. User opens a task's detail screen (tap the task in any list).
2. User taps the full-width "Marcar como completada" button.
3. Same completion logic as (A) runs.
4. Detail screen updates: subtasks all show checked, progress shows 100%, status badge shows "Completada", and the reminders section reflects that no notifications are pending for this task.

---

## 4. Edit a task's due date (and reminder impact)

1. User opens a task's detail screen and taps "Editar" (or equivalent), which opens the same Nueva Tarea form component in edit mode (header reads "Editar Tarea", fields pre-filled, route carries the task's id).
2. User changes the due date and/or due time and confirms.
3. Business logic (`03-business-rules.md` §7) processes each reminder still attached to the task that has not yet fired:
   - Relative-offset reminders: recomputed against the new due datetime; rescheduled if still in the future, or automatically removed (with an in-app notice) if the recomputed fire time would now be in the past.
   - Custom fixed-datetime reminders: left untouched if still valid (before the new due date and still in the future); automatically removed (with the same notice) if they'd now fire at/after the new deadline or are already in the past.
4. User returns to the task detail screen and sees the updated due date and the (possibly shortened) reminder list, with a brief notice if any reminder was auto-removed.

Blocked entirely (edit option not available / disabled) if the task's subject belongs to a closed semester.

---

## 5. Close a semester

1. User opens the semester switcher/history screen (or the currently-active semester's context) and taps "Cerrar semestre" on the active semester.
2. Confirmation dialog appears, warning that the semester and everything inside it (subjects, tasks) will become read-only.
3. User confirms.
4. The semester's `status` is set to `closed`, `closedAt = now`.
5. From this point, every subject and task under that semester is read-only across the entire app (`03-business-rules.md` §11) — create/edit/delete actions are disabled wherever that data appears (subject list, task list, calendar, dashboard historical views).
6. If this was the active semester, the user is prompted (or automatically routed) to create a new semester before they can create further subjects/tasks, since the "one active semester" invariant (§10) requires an active semester to exist for any new work — **(assumption: closing the only active semester without creating a replacement leaves the app with zero active semesters; the simplest resolution is to immediately show the "create a semester" prompt from flow 1, reusing that same screen)**.

---

## 6. Export data

1. User opens Settings (gear icon in header).
2. User taps "Exportar datos".
3. App serializes all local data into a single JSON file (semesters, subjects, tasks, subtasks, reminders, attachment metadata, settings).
4. System share sheet opens via `expo-sharing`, letting the user save the file locally, send it via email/chat/cloud-drive app, etc.
5. No data is modified by this action; it is read-only.

---

## 7. Import data

1. User opens Settings and taps "Importar datos".
2. System file picker opens; user selects a previously exported JSON file.
3. App validates the file is a well-formed UniTask export (basic shape/version check).
4. **Warning confirmation dialog**: explicitly tells the user that importing will **replace all current local data** and cannot be undone, and asks for confirmation.
5. On confirm: all existing local data is cleared and replaced with the imported data's semesters, subjects, tasks, subtasks, reminders, attachment metadata, and settings.
6. All previously scheduled OS notifications are cancelled and reminders present in the imported data are rescheduled fresh (since old notification ids are no longer valid after a full data replace) — **(assumption, consistent with `08-notifications.md`)**.
7. App returns to Dashboard reflecting the newly imported state.

If the user cancels at step 4, no data is touched.

---

## 8. Delete a subject blocked by pending tasks

1. User opens a subject's detail screen (or long-press/menu action from the Materias list) and selects "Eliminar materia".
2. App checks the subject's tasks for any in "Pendiente" or "En progreso" status (`03-business-rules.md` §12).
3. **If blocking tasks exist**: instead of a normal confirmation dialog, the app shows a blocking message stating the count of pending/in-progress tasks and that they must be resolved first (completed, deleted, or reassigned to another subject) before the subject can be deleted. No delete occurs.
4. User resolves the blocking tasks (e.g. completes or deletes them, or edits them to point at a different subject) and retries.
5. **If no blocking tasks remain** (subject has only completed tasks, or none at all): a standard destructive-action confirmation dialog appears ("Esta acción eliminará la materia y sus tareas completadas"), and on confirm the subject is deleted along with cascade-deleting any completed tasks (and their subtasks/reminders/attachments) that referenced it.

Also blocked entirely (delete option unavailable) if the subject belongs to a closed semester, independent of task state.
