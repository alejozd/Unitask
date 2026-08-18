import * as Notifications from "expo-notifications";

import { ensureReminderChannel, scheduleReminderNotification } from "@/lib/notifications";

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
