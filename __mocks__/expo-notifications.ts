/**
 * Manual Jest mock for `expo-notifications`.
 *
 * Jest auto-loads `__mocks__/expo-notifications.ts` (adjacent to
 * `node_modules`) for every test run without needing an explicit
 * `jest.mock("expo-notifications")` call, same as the `expo-sqlite`/
 * `expo-crypto` mocks in this directory.
 *
 * The real package registers a native push-token listener as a
 * module-level side effect (`DevicePushTokenAutoRegistration.fx.ts`),
 * which prints a `console.warn` about Expo Go's SDK 53 push-notification
 * removal on every test run that transitively imports
 * `src/lib/notifications/index.ts` — including via `jest.mock("@/lib/notifications")`
 * (used by `reminder.test.ts`/`semester.test.ts`/`subject.test.ts`/`task.test.ts`),
 * since Jest's automock still loads the real module once to read its
 * shape. No test asserts on real OS notification delivery — that's
 * covered by the Phase 4 on-device checklist instead — so this stub
 * replaces the whole package with the minimal surface
 * `src/lib/notifications/index.ts` actually calls, with no native
 * listener registration and no warning.
 */
export const AndroidImportance = {
  MIN: 1,
  LOW: 2,
  DEFAULT: 3,
  HIGH: 4,
  MAX: 5,
};

export const SchedulableTriggerInputTypes = {
  DATE: "date",
};

export function setNotificationHandler(): void {}

export async function setNotificationChannelAsync(): Promise<null> {
  return null;
}

export async function getPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted: true };
}

export async function requestPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted: true };
}

export async function scheduleNotificationAsync(request?: {
  identifier?: string;
}): Promise<string> {
  // Real expo-notifications echoes back a caller-supplied `identifier`
  // (that's the whole point of the field — see NotificationRequestInput in
  // the SDK 57 docs) rather than always generating a fresh one. Phase 10.6's
  // due-time notification relies on this so its identifier is deterministic.
  return request?.identifier ?? "mock-notification-id";
}

export async function cancelScheduledNotificationAsync(): Promise<void> {
  return undefined;
}
