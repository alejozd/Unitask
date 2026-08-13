import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import {
  closeSemester,
  createSemester,
  getActiveSemester,
  listSemestersQuery,
} from "@/db/repositories/semester";
import { addReminder } from "@/db/repositories/reminder";
import { createTask } from "@/db/repositories/task";
import { reminders } from "@/db/schema/reminder";
import { subjects } from "@/db/schema/subject";
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

describe("semester repository", () => {
  it("creates the first semester as active with no other semester to close", async () => {
    const db = freshTestDb();

    const semester = await createSemester("2026-1", db);

    expect(semester.label).toBe("2026-1");
    expect(semester.status).toBe("active");
    expect(semester.closedAt).toBeNull();

    const active = await getActiveSemester(db);
    expect(active?.id).toBe(semester.id);
  });

  it("auto-closes the previously active semester when a new one is created (03-business-rules.md §10)", async () => {
    const db = freshTestDb();

    const first = await createSemester("2026-1", db);
    const second = await createSemester("2026-2", db);

    const all = await listSemestersQuery(db);
    const firstAfter = all.find((s) => s.id === first.id);
    const secondAfter = all.find((s) => s.id === second.id);

    expect(firstAfter?.status).toBe("closed");
    expect(firstAfter?.closedAt).not.toBeNull();
    expect(secondAfter?.status).toBe("active");

    const active = await getActiveSemester(db);
    expect(active?.id).toBe(second.id);
  });

  it("closeSemester sets status to closed and stamps closedAt", async () => {
    const db = freshTestDb();
    const semester = await createSemester("2026-1", db);

    await closeSemester(semester.id, db);

    const all = await listSemestersQuery(db);
    const closed = all.find((s) => s.id === semester.id);
    expect(closed?.status).toBe("closed");
    expect(closed?.closedAt).not.toBeNull();
  });

  it("getActiveSemester returns undefined when no semester exists yet", async () => {
    const db = freshTestDb();
    const active = await getActiveSemester(db);
    expect(active).toBeUndefined();
  });

  it("listSemestersQuery returns semesters newest-first", async () => {
    const db = freshTestDb();
    const first = await createSemester("2026-1", db);
    const second = await createSemester("2026-2", db);

    const all = await listSemestersQuery(db);
    expect(all.map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it("closeSemester cancels pending reminders' notifications for tasks under that semester", async () => {
    const db = freshTestDb();
    const semester = await createSemester("2026-1", db);
    const subjectId = "subj-1";
    await db.insert(subjects).values({
      id: subjectId,
      name: "Cálculo II",
      color: "indigo",
      semesterId: semester.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    const { task } = await createTask(
      { title: "Tarea", subjectId, dueDateTime, priority: "Media" },
      db,
    );
    const reminder = await addReminder(
      task.id,
      { kind: "relative", offsetValue: 1, offsetUnit: "days" },
      db,
    );
    expect(reminder.notificationId).not.toBeNull();

    await closeSemester(semester.id, db);

    expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
      reminder.notificationId,
    );
    const [row] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(row.notificationId).toBeNull();
  });

  it("createSemester's auto-close path cancels pending reminders for the semester it closes", async () => {
    const db = freshTestDb();
    const first = await createSemester("2026-1", db);
    const subjectId = "subj-1";
    await db.insert(subjects).values({
      id: subjectId,
      name: "Cálculo II",
      color: "indigo",
      semesterId: first.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    const { task } = await createTask(
      { title: "Tarea", subjectId, dueDateTime, priority: "Media" },
      db,
    );
    const reminder = await addReminder(
      task.id,
      { kind: "relative", offsetValue: 1, offsetUnit: "days" },
      db,
    );
    expect(reminder.notificationId).not.toBeNull();

    await createSemester("2026-2", db);

    expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
      reminder.notificationId,
    );
    const [row] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(row.notificationId).toBeNull();
  });
});
