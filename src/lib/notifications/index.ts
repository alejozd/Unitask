import * as Notifications from "expo-notifications";

const REMINDER_CHANNEL_ID = "reminders-v2";

// Foreground display behavior — without this, a notification scheduled
// while the app is open and in the foreground is silently swallowed
// instead of shown. Runs once, at module-import time (this module is a
// singleton, same pattern as src/db/client.ts).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Creates (or updates) the Android notification channel every reminder is
 * scheduled under. Must run before `requestPermissionsAsync` — on Android
 * 13+, the OS permission prompt does not appear until at least one channel
 * exists (verified against the SDK 57 docs, see this plan's Global
 * Constraints).
 */
export async function ensureReminderChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: "Recordatorios de tareas",
    importance: Notifications.AndroidImportance.HIGH,
    // Heads-up display, no sound for now — sound design is a separate,
    // still-open decision (Phase 10.5 fast-follow scope).
    sound: null,
  });
}

export interface NotificationPermissionResult {
  granted: boolean;
}

/**
 * Checks current permission status without prompting the user.
 */
export async function getNotificationPermission(): Promise<NotificationPermissionResult> {
  const settings = await Notifications.getPermissionsAsync();
  return { granted: settings.granted };
}

/**
 * Requests notification permission. Call this lazily — only right before
 * scheduling the first real reminder (08-notifications.md) — never on app
 * launch. Ensures the notification channel exists first (see
 * `ensureReminderChannel`'s doc comment). Safe to call repeatedly: once the
 * user has answered, Android will not re-prompt (the OS returns the prior
 * decision immediately).
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  await ensureReminderChannel();
  const settings = await Notifications.requestPermissionsAsync();
  return { granted: settings.granted };
}

export interface ReminderNotificationContent {
  taskTitle: string;
  subjectName: string;
  dueDateTime: Date;
}

/**
 * Schedules a local notification at `fireAt`. Returns the OS-assigned
 * notification id — store it on the Reminder row so it can be individually
 * cancelled later via `cancelReminderNotification`. Uses the standard
 * (non-exact) DATE trigger — deliberately does NOT request
 * SCHEDULE_EXACT_ALARM (see this plan's Global Constraints): a task
 * reminder does not need second-level firing precision, and the standard
 * trigger avoids that whole extra Android-12+ permission flow.
 */
export async function scheduleReminderNotification(
  fireAt: Date,
  content: ReminderNotificationContent,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: content.taskTitle,
      body: `${content.subjectName} · vence ${content.dueDateTime.toLocaleString("es", {
        dateStyle: "medium",
        timeStyle: "short",
      })}`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: REMINDER_CHANNEL_ID,
    },
  });
}

/**
 * Cancels a single scheduled notification. Safe to call with an id that
 * has already fired or doesn't exist — `expo-notifications` resolves
 * either way, no error thrown.
 */
export async function cancelReminderNotification(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}

/**
 * A deterministic (not OS-generated) identifier for a task's due-time
 * notification (Phase 10.6, "¡Es para ahora!") — always `due-{taskId}`.
 * Deliberately distinct in shape from a reminder's `notificationId`, which
 * is always an opaque OS-assigned string stored per Reminder row: cancelling
 * or rescheduling the due notification never needs a DB lookup (unlike
 * reminders), and the "due-" prefix guarantees it can never collide with an
 * OS-generated id, so cancelling one type can never accidentally cancel the
 * other.
 */
export function dueNotificationIdentifier(taskId: string): string {
  return `due-${taskId}`;
}

export interface DueNotificationContent {
  taskTitle: string;
  subjectName: string;
}

/**
 * Schedules the task's own due-time notification ("¡Es para ahora!"),
 * separate from any reminder. Uses a fixed identifier (see
 * `dueNotificationIdentifier`) instead of letting the OS assign one, so a
 * reschedule can cancel the previous due notification without having
 * persisted its id anywhere first — `scheduleNotificationAsync` overwrites
 * any existing request under the same identifier. Shares `reminders-v2` so
 * it gets the same heads-up-capable channel as reminder notifications.
 */
export async function scheduleDueNotification(
  taskId: string,
  fireAt: Date,
  content: DueNotificationContent,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    identifier: dueNotificationIdentifier(taskId),
    content: {
      title: "¡Es para ahora!",
      body: `${content.taskTitle} · ${content.subjectName}`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: REMINDER_CHANNEL_ID,
    },
  });
}

/**
 * Cancels a task's due-time notification. Safe to call even if none was
 * ever scheduled for this task (same no-op-safe contract as
 * `cancelReminderNotification`) — callers never need to track whether one
 * exists first.
 */
export async function cancelDueNotification(taskId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(dueNotificationIdentifier(taskId));
}
