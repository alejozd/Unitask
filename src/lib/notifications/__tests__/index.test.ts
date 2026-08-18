import * as Notifications from "expo-notifications";

import {
  cancelDueNotification,
  dueNotificationIdentifier,
  ensureReminderChannel,
  scheduleDueNotification,
  scheduleReminderNotification,
} from "@/lib/notifications";

// `src/lib/notifications/index.ts` is otherwise untested per this project's
// convention (thin native wrapper, verified via the repository layer + the
// on-device checklist — see src/lib/files/__tests__/index.test.ts's own note
// for the established precedent). This file is a deliberate exception, added
// during a Phase 10.5 fast-follow investigation into a real-device report
// (Samsung A35, Android 16) of reminders firing at the task's due time
// instead of at the offset time. It directly disproves the hypothesis that a
// reminder's notification and some other "due time" notification share an
// identifier and overwrite each other's schedule: this codebase only ever
// calls `Notifications.scheduleNotificationAsync` once per reminder, and the
// value bound to the trigger's `date` is the computed fire time, never the
// task's raw due date (which only ever appears in the notification body
// text, a completely separate field). The actual observed delay was
// root-caused to Android's own non-exact AlarmManager batching, not this
// code — see the reminder-scheduling.test.ts entries added alongside this.

// Each test below spies fresh via jest.spyOn — without this, a spy's call
// count/history would leak into the next test in this file (no global
// clearMocks/resetMocks config; other test files avoid this via their own
// per-file `jest.clearAllMocks()` in beforeEach, but those mock the whole
// `@/lib/notifications` module rather than spying on the real one).
afterEach(() => {
  jest.restoreAllMocks();
});

describe("scheduleReminderNotification", () => {
  it("schedules the trigger at the computed fire time, not at the task's due date", async () => {
    const spy = jest.spyOn(Notifications, "scheduleNotificationAsync");
    const fireAt = new Date("2026-06-10T10:14:00.000Z");
    const dueDateTime = new Date("2026-06-10T10:15:00.000Z");

    await scheduleReminderNotification(fireAt, {
      taskTitle: "Entregar ensayo",
      subjectName: "Cálculo II",
      dueDateTime,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [{ trigger }] = spy.mock.calls[0];
    expect(trigger).toMatchObject({
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: "reminders-v2",
    });
    // The two dates are genuinely distinct in this test — proves the
    // trigger's `date` isn't accidentally aliased to `dueDateTime`.
    expect((trigger as { date: Date }).date).not.toEqual(dueDateTime);
  });
});

describe("ensureReminderChannel", () => {
  it("creates the reminders-v2 channel at HIGH importance with no sound", async () => {
    const spy = jest.spyOn(Notifications, "setNotificationChannelAsync");

    await ensureReminderChannel();

    expect(spy).toHaveBeenCalledWith("reminders-v2", {
      name: "Recordatorios de tareas",
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
    });
  });
});

// Phase 10.6: the due-time notification ("¡Es para ahora!") is a distinct
// feature from a reminder's own notification, deliberately identified
// differently so cancelling/rescheduling one can never touch the other.
describe("scheduleDueNotification", () => {
  it("uses a deterministic due-{taskId} identifier, distinct from any OS-assigned reminder id", async () => {
    const spy = jest.spyOn(Notifications, "scheduleNotificationAsync");
    const fireAt = new Date("2026-06-10T10:15:00.000Z");

    const identifier = await scheduleDueNotification("task-42", fireAt, {
      taskTitle: "Entregar ensayo",
      subjectName: "Cálculo II",
    });

    expect(identifier).toBe("due-task-42");
    expect(spy).toHaveBeenCalledTimes(1);
    const [request] = spy.mock.calls[0];
    expect(request.identifier).toBe("due-task-42");
    expect(request.content.title).toBe("¡Es para ahora!");
    expect(request.trigger).toMatchObject({
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: "reminders-v2",
    });
  });
});

describe("dueNotificationIdentifier", () => {
  it("is stable for the same taskId and distinct across different taskIds", () => {
    expect(dueNotificationIdentifier("task-1")).toBe("due-task-1");
    expect(dueNotificationIdentifier("task-1")).toBe(dueNotificationIdentifier("task-1"));
    expect(dueNotificationIdentifier("task-1")).not.toBe(dueNotificationIdentifier("task-2"));
  });
});

describe("cancelDueNotification", () => {
  it("cancels by the deterministic due-{taskId} identifier", async () => {
    const spy = jest.spyOn(Notifications, "cancelScheduledNotificationAsync");

    await cancelDueNotification("task-42");

    expect(spy).toHaveBeenCalledWith("due-task-42");
  });
});
