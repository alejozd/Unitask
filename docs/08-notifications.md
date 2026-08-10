# 08 — Notifications

UniTask uses **local-only** notifications via `expo-notifications` — there is no push/remote notification server in v1, consistent with the no-backend scope decision (`01-product.md`).

## Reminder → notification mapping

Each Reminder record (see `06-data-model.md`) maps to at most one scheduled OS notification at a time:

- `kind = relative`: the notification's absolute fire time is computed as `task.dueDate - offset` (offset expressed as `offsetValue` + `offsetUnit`). Stored in `Reminder.computedFireAt`.
- `kind = fixed`: the notification's fire time is `Reminder.fixedDateTime` directly.
- When a reminder is successfully scheduled, `expo-notifications`'s `scheduleNotificationAsync` returns an id, stored in `Reminder.notificationId`. This id is required later to cancel the specific notification (rather than cancelling all notifications for the app).
- Notification content: title references the task title, body references the subject and due date/time (exact copy is a UI/content detail, not a discovery-phase decision).

## Android permission handling

- Android 13+ (API 33+) requires the runtime `POST_NOTIFICATIONS` permission.
- The permission is requested **lazily** — the first time the user's action would actually create a reminder (e.g. confirming the Nueva Tarea form with at least one reminder configured, or adding a reminder from the task detail screen) — **not** proactively on app launch. This avoids showing a permission prompt before the user has done anything that needs it, which is better practice for permission-prompt acceptance rates and matches Android's recommended just-in-time pattern.
- If the user denies the permission, the task/reminder is still saved, but the reminder is recorded without a live `notificationId` (or flagged as "not scheduled"), and the UI should indicate the reminder won't actually fire until permission is granted **(assumption: exact UI treatment for the denied-permission state is an implementation detail; the underlying rule — don't silently pretend the reminder is active — is the discovery-phase decision)**.

## Exact-alarm considerations (Android 12+)

Android 12+ introduced tighter rules around exact alarms (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`). Whether UniTask's reminders need exact-alarm privileges depends on which `expo-notifications` trigger type is used at implementation time:

- If reminders are scheduled using a **calendar/date trigger** with second-level precision expectations, exact-alarm permission handling may be required on Android 12+.
- If a slightly-inexact fire time (typical OS-batched delivery window) is acceptable for reminder-style notifications, the standard (non-exact) trigger avoids needing this permission entirely.

**This must be verified against the current Expo SDK's notification trigger documentation at implementation time** — this document intentionally does not fabricate a specific trigger API or permission declaration, since Expo's notification APIs and Android's exact-alarm rules have both evolved across SDK/OS versions. Flag as an implementation-phase verification task (see `11-roadmap.md`, Phase 4).

## No iOS 64-pending-notification-limit handling

iOS historically caps an app to 64 pending local notifications, which would require "reschedule nearest window" complexity to stay under the cap on apps with many reminders. This complexity is **explicitly not built** in v1, because the Android-only MVP scope decision (`01-product.md`) supersedes it — Android has no equivalent hard per-app cap. Being reasonable about the total number of scheduled notifications (e.g. not scheduling absurd numbers of reminders per task) is still good practice, but no cap-avoidance logic is required for MVP. If/when iOS support is added post-MVP, this limit and its handling must be revisited (see `11-roadmap.md`).

## Scheduling triggers — when notifications are created/changed/cancelled

| Event | Effect |
|---|---|
| Task created with reminder(s) | Each reminder scheduled (permission requested lazily if not yet granted) |
| Reminder added from task detail | Scheduled immediately |
| Reminder edited (offset or fixed datetime changed) | Old OS notification cancelled, new one scheduled at the recomputed/new time |
| Reminder deleted | Its OS notification cancelled |
| Task due date edited | Every still-pending reminder is recomputed/validated per `03-business-rules.md` §7 — rescheduled, left untouched, or auto-removed (with in-app notice) as specified there |
| Task completed (either entry point) | All of the task's pending notifications cancelled (`03-business-rules.md` §5) |
| Task deleted | All of the task's pending notifications cancelled (`03-business-rules.md` §6) |
| Data import (full replace) | All previously scheduled notifications cancelled; reminders present in the imported data are freshly scheduled (old notification ids are not valid across a full data replace — `04-user-flows.md` flow 7) |

## App reinstall / device reboot behavior

Expo Notifications on Android schedules notifications through the OS's `AlarmManager`/`WorkManager`-backed layer. Two situations need explicit handling, and current behavior should be **verified against the Expo SDK documentation in use at implementation time** rather than assumed from this document:

- **Device reboot**: Android generally clears app-scheduled exact alarms on reboot unless the app re-registers them (typically via a boot-completed broadcast receiver). Whether Expo's managed workflow handles this automatically, requires a config plugin, or requires the app to re-schedule pending reminders itself on next launch is an open implementation question — flagged here as a verification task, not fabricated as a specific mechanism.
- **App reinstall**: reinstalling the app clears its SQLite database (since attachments and DB live in app-private storage that is wiped on uninstall) as well as any OS-level scheduled notifications tied to the previous install. This is expected/acceptable in v1 given there is no cloud backup — the user's only recovery path is a manual JSON export taken beforehand (`03-business-rules.md` §14). This should be communicated in relevant UI copy (e.g. Settings) at implementation time.

**Action item for implementation phase**: confirm current Expo SDK behavior for boot-time notification persistence and decide whether a boot-time re-registration approach (re-scheduling all still-future reminders from SQLite on app launch, as a safety net regardless of OS behavior) should be implemented. This is a reasonable defensive addition and is noted as a Phase 4 implementation task in `11-roadmap.md`, not a fixed discovery-phase decision.
