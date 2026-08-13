import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { reminders } from "@/db/schema/reminder";
import { createTask } from "@/db/repositories/task";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import {
  addReminder,
  cancelAllRemindersForTask,
  removeReminder,
  rescheduleRemindersForTask,
} from "@/db/repositories/reminder";
import * as notifications from "@/lib/notifications";

jest.mock("@/lib/notifications");
const mockedNotifications = jest.mocked(notifications);

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

let notificationCounter = 0;

beforeEach(() => {
  jest.clearAllMocks();
  notificationCounter = 0;
  mockedNotifications.requestNotificationPermission.mockResolvedValue({ granted: true });
  mockedNotifications.scheduleReminderNotification.mockImplementation(async () => {
    notificationCounter += 1;
    return `mock-notification-${notificationCounter}`;
  });
  mockedNotifications.cancelReminderNotification.mockResolvedValue(undefined);
});

async function seedTaskInActiveSemester(db: ReturnType<typeof freshTestDb>, dueDateTime: Date) {
  const semesterId = "sem-active";
  await db
    .insert(semesters)
    .values({ id: semesterId, label: "2026-1", status: "active", createdAt: new Date() });
  const subjectId = "subj-1";
  await db.insert(subjects).values({
    id: subjectId,
    name: "Cálculo II",
    color: "indigo",
    semesterId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // No reminderSpecs — Task 2 (this task) doesn't extend CreateTaskInput
  // with reminder-creation support (that's Task 3), so createTask here
  // creates zero reminders regardless. Each test explicitly sets up its own
  // reminder scenario via addReminder rather than depending on createTask's
  // own reminder-creation behavior (added and tested separately in Task 3).
  const { task } = await createTask(
    { title: "Tarea", subjectId, dueDateTime, priority: "Media" },
    db,
  );
  return { semesterId, task };
}

describe("reminder repository", () => {
  describe("addReminder", () => {
    it("creates a relative reminder and schedules a notification", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);

      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      expect(reminder.kind).toBe("relative");
      expect(reminder.offsetValue).toBe(1);
      expect(reminder.offsetUnit).toBe("days");
      // `reminders`/`tasks` columns use Drizzle's `mode: "timestamp"` (whole
      // seconds), not `timestamp_ms` — task.dueDateTime is re-fetched from
      // the DB inside addReminder (via assertTaskEditable) and comes back
      // floored to the second, even though the in-memory `dueDateTime` above
      // still has millisecond precision. Align the expectation the same way.
      expect(reminder.computedFireAt.getTime()).toBe(
        Math.floor(dueDateTime.getTime() / 1000) * 1000 - 86_400_000,
      );
      expect(reminder.notificationId).toBe("mock-notification-1");
      expect(mockedNotifications.scheduleReminderNotification).toHaveBeenCalledTimes(1);
    });

    it("creates a fixed reminder and schedules a notification", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const fixedDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);

      const reminder = await addReminder(task.id, { kind: "fixed", fixedDateTime }, db);

      expect(reminder.kind).toBe("fixed");
      expect(reminder.fixedDateTime).toEqual(fixedDateTime);
      expect(reminder.computedFireAt).toEqual(fixedDateTime);
      expect(reminder.notificationId).toBe("mock-notification-1");
    });

    it("does not schedule a notification when permission is denied, but still creates the reminder record", async () => {
      mockedNotifications.requestNotificationPermission.mockResolvedValue({ granted: false });
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);

      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      expect(reminder.notificationId).toBeNull();
      expect(mockedNotifications.scheduleReminderNotification).not.toHaveBeenCalled();
    });

    it("does not schedule a notification when the computed fire time is already in the past", async () => {
      const db = freshTestDb();
      // Due in 30 minutes; a "1 día antes" offset computes to a fire time
      // almost a full day in the past.
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 30);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);

      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      expect(reminder.notificationId).toBeNull();
      expect(mockedNotifications.scheduleReminderNotification).not.toHaveBeenCalled();
      // Permission should not even be requested for a reminder that can
      // never fire — nothing to schedule, nothing to ask permission for.
      expect(mockedNotifications.requestNotificationPermission).not.toHaveBeenCalled();
    });

    it("blocks adding a reminder under a closed semester", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task, semesterId } = await seedTaskInActiveSemester(db, dueDateTime);
      await db.update(semesters).set({ status: "closed", closedAt: new Date() });
      void semesterId;

      await expect(
        addReminder(task.id, { kind: "relative", offsetValue: 1, offsetUnit: "days" }, db),
      ).rejects.toThrow(SemesterReadOnlyError);
    });
  });

  describe("removeReminder", () => {
    it("removes a reminder and cancels its notification", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      await removeReminder(reminder.id, db);

      const remaining = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(remaining).toHaveLength(0);
      expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
        "mock-notification-1",
      );
    });

    it("removing a reminder with no notificationId does not attempt to cancel anything", async () => {
      mockedNotifications.requestNotificationPermission.mockResolvedValue({ granted: false });
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      await removeReminder(reminder.id, db);

      expect(mockedNotifications.cancelReminderNotification).not.toHaveBeenCalled();
    });

    it("blocks removing a reminder under a closed semester", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );
      await db.update(semesters).set({ status: "closed", closedAt: new Date() });

      await expect(removeReminder(reminder.id, db)).rejects.toThrow(SemesterReadOnlyError);
    });
  });

  describe("cancelAllRemindersForTask", () => {
    it("cancels every pending reminder's notification and clears notificationId, without deleting the rows", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const r1 = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );
      const r2 = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 2, offsetUnit: "hours" },
        db,
      );

      await cancelAllRemindersForTask(task.id, db);

      expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledTimes(2);
      const rows = await db.select().from(reminders).where(eq(reminders.taskId, task.id));
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.notificationId === null)).toBe(true);
      void r1;
      void r2;
    });

    it("blocks cancelling reminders under a closed semester", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      await addReminder(task.id, { kind: "relative", offsetValue: 1, offsetUnit: "days" }, db);
      await db.update(semesters).set({ status: "closed", closedAt: new Date() });

      await expect(cancelAllRemindersForTask(task.id, db)).rejects.toThrow(SemesterReadOnlyError);
    });
  });

  describe("rescheduleRemindersForTask", () => {
    it("reschedules a relative reminder still in the future after the due-date change", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      const newDueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10);
      const result = await rescheduleRemindersForTask(task.id, newDueDateTime, db);

      expect(result.removedCount).toBe(0);
      expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
        "mock-notification-1",
      );
      expect(mockedNotifications.scheduleReminderNotification).toHaveBeenCalledTimes(2); // 1 on create, 1 on reschedule
      const [updated] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      // See the "creates a relative reminder" test above for why the
      // expectation is floored to the second — `computedFireAt` round-trips
      // through the `mode: "timestamp"` column on write and on this re-read.
      expect(updated.computedFireAt.getTime()).toBe(
        Math.floor(newDueDateTime.getTime() / 1000) * 1000 - 86_400_000,
      );
      expect(updated.notificationId).toBe("mock-notification-2");
    });

    it("removes a relative reminder whose recomputed fire time is now in the past", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );

      // New due date is 30 minutes from now — "1 día antes" would fire in the past.
      const newDueDateTime = new Date(Date.now() + 1000 * 60 * 30);
      const result = await rescheduleRemindersForTask(task.id, newDueDateTime, db);

      expect(result.removedCount).toBe(1);
      const remaining = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(remaining).toHaveLength(0);
    });

    it("removes a fixed reminder that now falls at/after the new due date", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const fixedDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const reminder = await addReminder(task.id, { kind: "fixed", fixedDateTime }, db);

      // New due date moves to before the fixed reminder's own datetime.
      const newDueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5);
      const result = await rescheduleRemindersForTask(task.id, newDueDateTime, db);

      expect(result.removedCount).toBe(1);
      const remaining = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(remaining).toHaveLength(0);
    });

    it("leaves an already-fired-but-unreconciled reminder untouched", async () => {
      // "Fired" here means computedFireAt is already in the past — NOT
      // notificationId === null. There is no notification-received listener
      // or startup reconciliation anywhere in this codebase, so a reminder
      // that has actually fired still has its notificationId set. A row
      // with notificationId === null would never even be fetched by
      // rescheduleRemindersForTask's `isNotNull(reminders.notificationId)`
      // filter, so simulating "fired" that way (as this test used to)
      // would trivially pass regardless of whether hasFired was derived
      // correctly.
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      const reminder = await addReminder(
        task.id,
        { kind: "relative", offsetValue: 1, offsetUnit: "days" },
        db,
      );
      expect(reminder.notificationId).not.toBeNull();
      const pastFireAt = new Date(Date.now() - 1000 * 60 * 60);
      await db
        .update(reminders)
        .set({ computedFireAt: pastFireAt })
        .where(eq(reminders.id, reminder.id));

      const newDueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 20);
      const result = await rescheduleRemindersForTask(task.id, newDueDateTime, db);

      expect(result.removedCount).toBe(0);
      expect(mockedNotifications.cancelReminderNotification).not.toHaveBeenCalled();
      // Only the schedule call from the original addReminder above — none
      // from the reschedule, since this reminder must be left untouched.
      expect(mockedNotifications.scheduleReminderNotification).toHaveBeenCalledTimes(1);
      const [unchanged] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
      expect(unchanged).toBeDefined();
      expect(unchanged.notificationId).toBe(reminder.notificationId);
      // Still the OLD (past) computed value — see the "creates a relative
      // reminder" test above for why the expectation is floored to the
      // second.
      expect(unchanged.computedFireAt.getTime()).toBe(
        Math.floor(pastFireAt.getTime() / 1000) * 1000,
      );
    });

    it("blocks rescheduling reminders under a closed semester", async () => {
      const db = freshTestDb();
      const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const { task } = await seedTaskInActiveSemester(db, dueDateTime);
      await addReminder(task.id, { kind: "relative", offsetValue: 1, offsetUnit: "days" }, db);
      await db.update(semesters).set({ status: "closed", closedAt: new Date() });

      await expect(
        rescheduleRemindersForTask(task.id, new Date(Date.now() + 1000 * 60 * 60 * 24 * 20), db),
      ).rejects.toThrow(SemesterReadOnlyError);
    });
  });
});
