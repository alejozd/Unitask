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

Android 12+ introduced tighter rules around exact alarms (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`). UniTask deliberately uses the standard (non-exact) `SchedulableTriggerInputTypes.DATE` trigger (`src/lib/notifications/index.ts`'s `scheduleReminderNotification`) specifically to avoid needing this permission — see that function's own doc comment.

**Verified on a real device (Phase 10.5 fast-follow, Samsung A35 / Android 16):** this tradeoff has a real, user-visible cost, not just a theoretical one. A reminder with a short offset (1–2 minutes before the due time) was observed firing at the task's *due time* instead of the requested offset time. This was investigated end to end (`src/domain/reminder-scheduling.ts`'s `computeFireAt`, `src/lib/notifications/index.ts`'s `scheduleReminderNotification`, and every call site of both) and confirmed NOT to be a code defect:

- `computeFireAt` correctly returns a time strictly before `dueDateTime` for a relative reminder — covered by dedicated regression tests in `src/domain/__tests__/reminder-scheduling.test.ts` reproducing the exact 1-minute and 2-minute offsets from the report.
- There is exactly one place in the whole codebase that calls `Notifications.scheduleNotificationAsync` per reminder (`scheduleReminderNotification`, called from `addReminder` and `rescheduleRemindersForTask`) — no second "due time" notification exists anywhere for a reminder's own identifier to collide with. `src/lib/notifications/__tests__/index.test.ts` regression-locks that the trigger's `date` is bound to the computed fire time, never to the task's raw `dueDateTime` (which only ever appears in the notification body text).

The actual cause is Android's own non-exact `AlarmManager` batching: without `SCHEDULE_EXACT_ALARM`, the OS is free to deliver the notification within a batching window rather than at the precise requested moment, and OEM battery-optimization layers (Samsung OneUI's "Sleeping apps" / adaptive battery in particular) can widen that window further for background apps. With only a 1–2 minute offset, that slack is large enough to make the notification arrive indistinguishably close to the due time.

**Resolved in Phase 10.6** — `app.json`'s `android.permissions` now declares both `SCHEDULE_EXACT_ALARM` and `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (requires one native rebuild to take effect, since this regenerates `AndroidManifest.xml` via `expo prebuild`). No change was needed in `scheduleReminderNotification` itself: `expo-notifications`' `SchedulableTriggerInputTypes.DATE` trigger has no JS-level "exact" flag anywhere in its documented shape (verified against the SDK 57 reference — `DateTriggerInput` only has `channelId`/`date`/`type`) — whether a given DATE trigger fires exactly is decided transparently at the native layer purely from whether `SCHEDULE_EXACT_ALARM` is declared **and currently granted**. Declaring it (done) is necessary; the app cannot force it to be granted (Android 12+ requires an explicit user action for non-exempt apps) — Configuración's new "Puntualidad" section (`app/configuracion/index.tsx`) opens the OS's own grant screens directly via `expo-intent-launcher`:

- `android.settings.REQUEST_SCHEDULE_EXACT_ALARM` (optionally targeted at this app's package via a `package:<id>` data URI — untargeted, it opens the general list).
- `android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (data URI targeting this app's package is **required** by this specific action, per the Android `Settings` API reference — there is no untargeted form).

Both constant strings and their data-URI requirements were verified directly against `developer.android.com`'s `Settings` class reference before implementation, not assumed. `ReminderPicker` also shows a soft, non-blocking warning for relative offsets under 5 minutes pointing at this section — deliberately shown unconditionally rather than only when it would actually help, since `expo-notifications` exposes no JS-level way to query whether exact-alarm scheduling is currently granted (no `canScheduleExactAlarms()`-equivalent in its public API), so the app cannot precisely condition the warning on real permission state without writing a small custom native module, which this phase did not do.

## Known OEM caveats — Samsung heads-up display

`ensureReminderChannel` (`src/lib/notifications/index.ts`) creates the `reminders-v2` channel at `AndroidImportance.HIGH`, which is the correct and sufficient signal on stock Android for heads-up (banner) display. On Samsung's OneUI, this can still not be enough on its own:

- OneUI's per-app notification screen has its own "Emergentes" / pop-up notification style toggle, which in some OneUI versions and battery-optimization states can suppress the heads-up banner even for a `HIGH`-importance channel.
- Samsung's "Poner las aplicaciones en reposo" (adaptive battery / sleeping apps) can restrict a backgrounded app's alarms and notifications entirely unless the app is explicitly exempted.

If heads-up still doesn't appear after confirming the channel itself shows as "Alta" importance in Android's notification settings, check (and, if needed, document for users): **Ajustes → Notificaciones → UniTask → Recordatorios de tareas → Emergentes**, and **Ajustes → Batería → Uso en segundo plano → No optimizar/permitir para UniTask**. This is a device-settings gap, not something `ensureReminderChannel` can force from JS. Phase 10.6's battery-optimization-exemption shortcut in Configuración's "Puntualidad" section (see above) is the in-app path to the second of these two settings; the first (per-channel "Emergentes" toggle) has no equivalent direct-launch intent on stock Android and stays a manual-navigation instruction.

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
