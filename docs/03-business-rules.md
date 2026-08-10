# 03 — Business Rules

This is the single source of truth for everything UniTask decides automatically. Every derived value, cascade, and default described here must be implemented exactly as specified — no free interpretation at implementation time. Where a rule required filling a gap not explicitly given by the product owner, it is marked **(assumption)**.

---

## 1. Task status derivation

Task status is **never** stored as a free-form field the user sets directly. It is always computed, at read time, from stored fields (`completed`, `completedAt`, subtask completion ratio, `dueDateTime`, current time):

| Status | Condition |
|---|---|
| **Pendiente** | `completed == false` AND progress == 0% AND `dueDateTime >= now` |
| **En progreso** | `completed == false` AND progress > 0% AND progress < 100% |
| **Completada** | `completed == true` (regardless of due date, subtask state, or progress) |
| **Vencida** | `completed == false` AND `dueDateTime < now` (regardless of progress) |

Evaluation order matters: check `completed` first (→ Completada), then check `dueDateTime < now` (→ Vencida), then fall back to the progress-based Pendiente/En progreso split. This means an incomplete task past its due date is always "Vencida," even if it has partial progress — "Vencida" takes priority over "En progreso" for incomplete tasks.

"En progreso" is never chosen by the user; it becomes true automatically the instant any subtask is checked (progress > 0%) and the task itself has not been marked complete.

### Filter chips

The task list exposes five filter chips: **Todas / Pendientes / En progreso / Completadas / Vencidas**. All except "Todas" and "Completadas" are computed with the table above at query/render time — "Vencidas" and "En progreso" are never persisted as stored status values anywhere.

---

## 2. Progress calculation

Progress is **always** auto-computed from subtask completion — there is no manual/independent progress field, and it is **not stored** in the database (derived at read time):

```
progress = (completed subtasks) / (total subtasks) * 100
```

- If a task has **zero subtasks**: progress is binary — 0% until the task is marked complete, then 100%. It is not left "undefined" or hidden; the UI simply shows 0% or 100%.
- Progress recomputes live any time a subtask's completed flag changes, or the task's own `completed` flag changes.

---

## 3. "Vencida" (overdue) derivation

"Vencida" is a computed label/filter, never a stored enum value. It is computed at read time as:

```
vencida = (dueDateTime < now) AND (completed == false)
```

If a task is completed **after** its due date, it immediately stops being labeled or filtered as "Vencida" everywhere in the app (lists, dashboard, calendar) the moment `completed` becomes `true` — because the formula above short-circuits on `completed == false`.

---

## 4. Late-completion tracking (`completedLate`)

Internally, every task carries a stored boolean `completedLate`, computed **once**, at the moment of completion, and never recalculated afterward:

```
completedLate = (completedAt > dueDateTimeAtCompletion)
```

- Default value: `false` (for tasks not yet completed, and for tasks completed on or before their due date).
- Set exactly once, when the task transitions to `completed == true`.
- Not surfaced in MVP UI. It exists purely to preserve data for a future statistic (e.g. an "on-time completion rate"). Do not discard this value — persist it even though no v1 screen displays it.

---

## 5. Task completion logic

Both completion entry points — the task list's inline checkbox and the task detail screen's "Marcar como completada" button — invoke the exact same logic:

1. Set `completed = true`.
2. Set `completedAt = now`.
3. Compute and store `completedLate` (rule 4 above).
4. **Auto-check all subtasks** — every subtask under the task is force-set to `completed = true` **(assumption)**. Rationale: keeps the subtask checklist visually consistent with a task that is now 100% done; the alternative (leaving unchecked subtasks under a "completed" task) reads as a contradiction in the UI.
5. Cancel every still-pending scheduled local notification associated with the task's reminders (`expo-notifications` `cancelScheduledNotificationAsync` per reminder that has a live notification id).

Completing a task force-completes it regardless of prior subtask state — a task can be marked complete with 0 of 5 subtasks checked, and step 4 will check the remaining 5 automatically.

Un-completing a task (if the UI ever allows toggling the checkbox back off) is out of scope for this discovery — **(assumption)**: if implemented, it should NOT retroactively un-check subtasks or clear `completedLate`, since `completedLate` is a one-time historical marker. This is noted for implementation but not required for MVP.

---

## 6. Task deletion

Deleting a task:

1. Cancels every still-pending scheduled local notification tied to its reminders.
2. Deletes every copied attachment file belonging to the task from app-private storage (no orphaned files).
3. Cascade-deletes its subtasks, reminders, and attachment records (standard FK cascade).

Blocked entirely if the task's subject belongs to a closed semester (see rule 11).

---

## 7. Reminders — defaults, scheduling, and cancellation

- **Default reminder on task creation**: every new task automatically receives one suggested reminder — a relative offset of **"1 día antes"** (1 day / 24 hours before `dueDateTime`) **(assumption: this exact offset was given as the example default in product decisions and is adopted as the concrete default)**. The user may edit or delete it during the Nueva Tarea flow. A task is only ever created with zero reminders if the user explicitly removes this default.
- **Cancellation on completion or deletion**: completing a task (rule 5) or deleting a task (rule 6) cancels all of that task's still-pending scheduled OS notifications.
- **Rescheduling on due-date edit**: when a task's `dueDateTime` is edited, apply the following to every reminder still attached to the task that has **not yet fired**:
  - **Relative-offset reminders**: recompute `newFireAt = newDueDateTime - offset`.
    - If `newFireAt` is still in the future (`> now`): cancel the old scheduled OS notification and schedule a new one at `newFireAt`; update the stored absolute fire time.
    - If `newFireAt` is now in the past (`<= now`): the reminder can no longer be scheduled. Automatically cancel any pending OS notification, **delete the reminder record**, and surface a brief in-app notice informing the user a reminder was removed because it no longer made sense with the new due date.
  - **Custom fixed-datetime reminders**: these do not move with the due date (they are absolute), but are validated against the new due date:
    - If the fixed datetime is still before `newDueDateTime` and still in the future relative to now: leave it untouched.
    - If the fixed datetime is on/after `newDueDateTime`, OR already in the past relative to now: automatically cancel any pending OS notification, delete the reminder record, and surface the same in-app notice (a reminder that would fire at or after the deadline no longer serves its purpose).
  - Already-fired reminders (notification already delivered in the past) are historical and are left untouched by an edit.
- Reminders cannot be added, edited, or removed on a task whose subject belongs to a closed semester (rule 11).

---

## 8. Subject color palette

Subjects use a color picked from a **fixed palette** — free-form color entry is explicitly rejected. The palette is harmonized with the `DESIGN.md` design tokens (primary indigo, tertiary green, secondary amber) plus enough additional hues for realistic subject-count variety, and deliberately avoids the exact priority-red (`#EF4444`) to prevent a student from confusing "this subject's color" with "this task is High priority":

| Name | Hex |
|---|---|
| Indigo (primary) | `#6366F1` |
| Emerald | `#10B981` |
| Amber | `#F59E0B` |
| Rose | `#F43F5E` |
| Sky | `#0EA5E9` |
| Violet | `#8B5CF6` |
| Teal | `#14B8A6` |
| Fuchsia | `#EC4899` |
| Cyan | `#06B6D4` |
| Slate | `#64748B` |

**(assumption)**: exact 10-color list assembled from the DESIGN.md tokens plus 7 additional harmonized hues, per the "8-10 palette colors" instruction. Subject `color` is stored as an enum/string key referencing one of these swatches, never a raw arbitrary hex value.

---

## 9. Attachments — size and type rules

- **Max size**: 25 MB per file (hard limit). No aggregate per-task cap in v1.
- **Allowed types**: PDF, DOCX, XLSX, PPTX, JPG/JPEG, PNG, HEIC, TXT. Any other file type is rejected at the picker/validation step before it is copied into app storage.
- Files are **copied** into app-private sandboxed storage on attach — never referenced only by an external URI — so they survive the user moving, renaming, or deleting the original file, or losing storage permission to its original location.
- Deleting a task deletes all of its copied attachment files from app storage (rule 6).
- Attachments cannot be added or removed on a task whose subject belongs to a closed semester (rule 11).

Full flow detail: `09-file-management.md`.

---

## 10. One active semester

Exactly one semester has `status = active` at any time, from the creation of the first semester onward — never zero, never more than one.

**Rule (chosen option)**: creating a new semester while one is already active **automatically closes the previously active semester** (sets its `status = closed` and `closedAt = now`) and activates the new one. This was chosen over requiring the user to manually close the old semester first, because it removes friction from a routine, expected action (starting a new term) — closing is still always available as an explicit manual action for a semester the user wants to close without starting a new one yet.

Closing a semester is **always manual** — there is no automatic date-based closing. The user explicitly taps "Cerrar semestre" and confirms via a destructive-action confirmation dialog (rule 13). Academic calendars vary too much across universities to infer a close date automatically.

---

## 11. Closed semester = read-only cascade

Once a semester is closed, it and **everything under it** — its subjects, and their tasks, subtasks, reminders, and attachments — becomes **read-only**:

- Viewable for history and statistics.
- **No create, edit, or delete operations** are permitted anywhere inside a closed semester's tree: subjects cannot be edited/deleted/created, tasks cannot be created/edited/deleted/completed, subtasks cannot be added/edited/reordered/removed, reminders cannot be added/edited/removed, attachments cannot be added/removed.

This is a cross-cutting constraint enforced at the business-logic layer (not just hidden in the UI) so that no code path can mutate data under a closed semester, regardless of entry point.

---

## 12. Subject deletion

A subject may be deleted only if it has **zero tasks in "Pendiente" or "En progreso" status** (as derived by rule 1). Deletion is blocked otherwise, and the UI must display the count of blocking pending/in-progress tasks and require the user to resolve them (complete, delete, or reassign to another subject) before retrying.

If a subject has only completed tasks (or no tasks at all), deletion is allowed outright, and any completed tasks referencing it are **cascade-deleted** along with the subject (their subtasks/reminders/attachments cascade-delete too, per rule 6). This is the simpler of two possible rules and was chosen deliberately: deletion is blocked *only* by pending/in-progress tasks, never by completed ones.

Also blocked entirely if the subject belongs to a closed semester (rule 11), independent of its task state.

---

## 13. Confirmation dialogs (destructive actions)

Every destructive action requires an explicit confirmation dialog before executing:

- Delete task
- Delete subject (when allowed — see rule 12)
- Delete subtask
- Delete/remove a reminder **(assumption: treated as low-friction and not requiring confirmation, since it's a routine edit, not data loss of user work — only task/subject/subtask deletion and semester close/import are treated as destructive enough to require a dialog)** — excluded from the mandatory list per this assumption.
- Close semester ("Cerrar semestre")
- Import data (overwrite warning — see rule 14)

No dedicated confirmation *screen* is used for any of these; a modal/dialog component is sufficient and is the standard pattern across the app.

---

## 14. Data export / import

- **Export**: Settings → "Exportar datos" serializes all local data (semesters, subjects, tasks, subtasks, reminders, attachment metadata, settings) into a single JSON file and opens the system share sheet (`expo-sharing`) so the user can save or send it anywhere.
- **Import**: Settings → "Importar datos" lets the user pick a previously exported JSON file. Import **replaces all local data** — this is a full overwrite, not a merge. The user must see and confirm an explicit warning dialog before the replace executes (rule 13). Partial/merge import is explicitly deferred (see `11-roadmap.md`).
- Attachment **files** themselves are not embedded in the JSON export in v1 — only their metadata (filename, mime type, size) is included **(assumption)**; re-importing a backup restores task/subject/attachment *records* but the underlying attachment files must still exist in app storage to be reopened. This limitation should be communicated to the user in the export/import UI copy at implementation time. (Bundling actual file bytes into the export is a reasonable future enhancement — see `11-roadmap.md`.)

---

## 15. Dashboard widget criteria

- **Pendientes** stat tile: count of tasks with derived status "Pendiente" (rule 1), across the active semester's subjects **(assumption: dashboard scope is the active semester only, consistent with closed semesters being historical/read-only and not part of "what do I have to do")**.
- **Hoy** stat tile: count of tasks due today (calendar day match on `dueDateTime`), not completed.
- **Completadas [últimos 7 días]**: count of tasks with `completed == true` and `completedAt` within a **rolling 7-day window ending now** — i.e. `now - 7 days <= completedAt <= now`. This is recomputed continuously (on every read), not reset weekly on a fixed calendar boundary (not Monday–Sunday).
- **Tareas urgentes** (horizontal list): the **union** of two conditions — `dueDateTime` is within the next 24–48 hours, OR `priority == Alta` — regardless of which condition is satisfied. A high-priority task 2 weeks out still appears here; a medium-priority task due tomorrow also appears here. Excludes completed tasks.
- **Próximas entregas** (vertical list): the **N nearest pending tasks by due date**, with **N = 5**. No fixed day-window cutoff is applied — the list always shows the closest upcoming tasks even if the nearest one is weeks away. Excludes completed tasks.

---

## 16. Calendar day indicators

Each day cell in the month view shows a small dot indicator when it has at least one task due that day. Dot color is keyed to **task priority** (not subject) — chosen deliberately because priority color is more actionable for a student scanning the month for urgency than a subject-color key would be. If a day has tasks of multiple priorities, show multiple dots (or the highest-priority color, capped at a small fixed number of dots) **(assumption on multi-task-per-day rendering; exact visual treatment — stacked dots vs. single highest-priority dot — is left to the design/implementation phase, not a product-level rule)**.

---

## 17. First-run bootstrap

If no semester exists yet (first app launch, or after a data import that somehow leaves zero semesters — not expected in practice), the user is guided to create their first semester before any subject or task creation is possible. This is a mandatory data-bootstrap step, not a tutorial/onboarding carousel. Full flow: `04-user-flows.md`.

---

## 18. Non-functional cross-cutting rules

- **Accessibility**: minimum 48px touch targets (per `DESIGN.md` spacing tokens); support Android font-scaling; avoid color-only signifiers — priority is always shown with both a color stripe *and* an icon/label, never color alone.
- **Theming**: all UI colors come from semantic design tokens, never hardcoded hex values in component code, so a future dark theme is a token-swap, not a rewrite (see `07-architecture.md`).
