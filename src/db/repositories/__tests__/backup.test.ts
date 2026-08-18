import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { exportBackupJson, importBackup } from "@/db/repositories/backup";
import { createSemester } from "@/db/repositories/semester";
import { createSubject } from "@/db/repositories/subject";
import { createTask } from "@/db/repositories/task";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import { settings } from "@/db/schema/settings";
import { parseBackupFile, type BackupTables } from "@/domain/backup";
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

function emptyTables(): BackupTables {
  return {
    semesters: [],
    subjects: [],
    tasks: [],
    subtasks: [],
    reminders: [],
    attachments: [],
    settings: [],
  };
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

describe("exportBackupJson", () => {
  it("returns a parseable backup with all 7 arrays empty on an empty DB", async () => {
    const db = freshTestDb();

    const json = await exportBackupJson(db);
    const result = parseBackupFile(json);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data.semesters).toEqual([]);
    expect(result.data.tasks).toEqual([]);
  });

  it("round-trips a seeded DB's row counts and field values through parseBackupFile", async () => {
    const db = freshTestDb();
    const semester = await createSemester("2026-1", db);
    const subject = await createSubject(
      { name: "Física", color: "sky", semesterId: semester.id },
      db,
    );
    const task = await createTask(
      {
        title: "Tarea 1",
        subjectId: subject.id,
        dueDateTime: new Date(Date.now() + 86_400_000),
        priority: "Media",
        reminderSpecs: [{ kind: "relative", offsetValue: 1, offsetUnit: "hours" }],
      },
      db,
    );
    await db.insert(attachments).values({
      id: "att-1",
      taskId: task.task.id,
      originalFileName: "notas.pdf",
      storedPath: "file:///attachments/x/notas.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      createdAt: new Date(),
    });
    await db.insert(settings).values({
      id: "settings-1",
      nickname: "Ale",
      fullName: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const json = await exportBackupJson(db);
    const result = parseBackupFile(json);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data.semesters).toHaveLength(1);
    expect(result.data.subjects).toHaveLength(1);
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.reminders).toHaveLength(1);
    expect(result.data.attachments).toHaveLength(1);
    expect(result.data.settings).toHaveLength(1);
    expect(result.data.tasks[0].title).toBe("Tarea 1");
  });
});

describe("importBackup", () => {
  it("wipes pre-existing data and replaces it with only the imported rows", async () => {
    const db = freshTestDb();
    const oldSemester = await createSemester("Semestre viejo", db);
    await createSubject({ name: "Materia vieja", color: "sky", semesterId: oldSemester.id }, db);

    const tables = emptyTables();
    tables.semesters.push({
      id: "new-sem",
      label: "Semestre nuevo",
      status: "active",
      createdAt: new Date(),
      closedAt: null,
    });

    await importBackup(tables, db);

    const semesterRows = await db.select().from(semesters);
    expect(semesterRows).toHaveLength(1);
    expect(semesterRows[0].id).toBe("new-sem");
    const subjectRows = await db.select().from(subjects);
    expect(subjectRows).toHaveLength(0);
  });

  it("cancels every pre-existing reminder's notification before the wipe", async () => {
    const db = freshTestDb();
    const semester = await createSemester("2026-1", db);
    const subject = await createSubject(
      { name: "Química", color: "amber", semesterId: semester.id },
      db,
    );
    await createTask(
      {
        title: "Con recordatorio",
        subjectId: subject.id,
        dueDateTime: new Date(Date.now() + 86_400_000),
        priority: "Alta",
        reminderSpecs: [{ kind: "relative", offsetValue: 1, offsetUnit: "hours" }],
      },
      db,
    );
    mockedNotifications.cancelReminderNotification.mockClear();

    await importBackup(emptyTables(), db);

    expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
      "mock-notification-1",
    );
  });

  it("always discards the imported notificationId and schedules a fresh one for a future reminder", async () => {
    const db = freshTestDb();
    const tables = emptyTables();
    tables.semesters.push({
      id: "sem-1",
      label: "2026-1",
      status: "active",
      createdAt: new Date(),
      closedAt: null,
    });
    tables.subjects.push({
      id: "sub-1",
      name: "Historia",
      courseCode: null,
      professorName: null,
      color: "rose",
      semesterId: "sem-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tables.tasks.push({
      id: "task-1",
      title: "Tarea futura",
      description: null,
      subjectId: "sub-1",
      dueDateTime: new Date(Date.now() + 2 * 86_400_000),
      priority: "Media",
      completed: false,
      completedAt: null,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tables.reminders.push({
      id: "rem-1",
      taskId: "task-1",
      kind: "relative",
      offsetValue: 1,
      offsetUnit: "days",
      fixedDateTime: null,
      computedFireAt: new Date(Date.now() + 86_400_000),
      notificationId: "stale-notification-id-from-old-device",
      createdAt: new Date(),
    });

    const result = await importBackup(tables, db);

    expect(result.remindersScheduled).toBe(1);
    const reminderRows = await db.select().from(reminders);
    expect(reminderRows[0].notificationId).not.toBe("stale-notification-id-from-old-device");
    expect(reminderRows[0].notificationId).toBe("mock-notification-1");
  });

  it("leaves a reminder whose computedFireAt is already in the past unscheduled, and does not count it", async () => {
    const db = freshTestDb();
    const tables = emptyTables();
    tables.semesters.push({
      id: "sem-1",
      label: "2026-1",
      status: "active",
      createdAt: new Date(),
      closedAt: null,
    });
    tables.subjects.push({
      id: "sub-1",
      name: "Historia",
      courseCode: null,
      professorName: null,
      color: "rose",
      semesterId: "sem-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tables.tasks.push({
      id: "task-1",
      title: "Tarea vencida",
      description: null,
      subjectId: "sub-1",
      dueDateTime: new Date(Date.now() - 86_400_000),
      priority: "Media",
      completed: false,
      completedAt: null,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tables.reminders.push({
      id: "rem-1",
      taskId: "task-1",
      kind: "relative",
      offsetValue: 1,
      offsetUnit: "days",
      fixedDateTime: null,
      computedFireAt: new Date(Date.now() - 2 * 86_400_000),
      notificationId: null,
      createdAt: new Date(),
    });

    const result = await importBackup(tables, db);

    expect(result.remindersScheduled).toBe(0);
    expect(result.remindersUnscheduled).toBe(0);
    expect(mockedNotifications.scheduleReminderNotification).not.toHaveBeenCalled();
    const reminderRows = await db.select().from(reminders);
    expect(reminderRows[0].notificationId).toBeNull();
  });

  it("counts a denied-permission future reminder as unscheduled without attempting to schedule it", async () => {
    mockedNotifications.requestNotificationPermission.mockResolvedValue({ granted: false });
    const db = freshTestDb();
    const tables = emptyTables();
    tables.semesters.push({
      id: "sem-1",
      label: "2026-1",
      status: "active",
      createdAt: new Date(),
      closedAt: null,
    });
    tables.subjects.push({
      id: "sub-1",
      name: "Historia",
      courseCode: null,
      professorName: null,
      color: "rose",
      semesterId: "sem-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tables.tasks.push({
      id: "task-1",
      title: "Tarea futura",
      description: null,
      subjectId: "sub-1",
      dueDateTime: new Date(Date.now() + 2 * 86_400_000),
      priority: "Media",
      completed: false,
      completedAt: null,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tables.reminders.push({
      id: "rem-1",
      taskId: "task-1",
      kind: "relative",
      offsetValue: 1,
      offsetUnit: "days",
      fixedDateTime: null,
      computedFireAt: new Date(Date.now() + 86_400_000),
      notificationId: null,
      createdAt: new Date(),
    });

    const result = await importBackup(tables, db);

    expect(result.remindersUnscheduled).toBe(1);
    expect(result.remindersScheduled).toBe(0);
    expect(mockedNotifications.scheduleReminderNotification).not.toHaveBeenCalled();
  });

  it("imports data for a closed semester without throwing SemesterReadOnlyError", async () => {
    const db = freshTestDb();
    const tables = emptyTables();
    tables.semesters.push({
      id: "sem-closed",
      label: "Semestre cerrado",
      status: "closed",
      createdAt: new Date(),
      closedAt: new Date(),
    });
    tables.subjects.push({
      id: "sub-1",
      name: "Historia",
      courseCode: null,
      professorName: null,
      color: "rose",
      semesterId: "sem-closed",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tables.tasks.push({
      id: "task-1",
      title: "Tarea de semestre cerrado",
      description: null,
      subjectId: "sub-1",
      dueDateTime: new Date(),
      priority: "Baja",
      completed: true,
      completedAt: new Date(),
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(importBackup(tables, db)).resolves.not.toThrow();
    const taskRows = await db.select().from(tasks);
    expect(taskRows).toHaveLength(1);
  });

  it("imports all-empty tables successfully, leaving the DB fully empty", async () => {
    const db = freshTestDb();
    const semester = await createSemester("2026-1", db);
    await createSubject({ name: "Materia", color: "sky", semesterId: semester.id }, db);

    const result = await importBackup(emptyTables(), db);

    expect(result).toEqual({ remindersScheduled: 0, remindersUnscheduled: 0 });
    expect(await db.select().from(semesters)).toHaveLength(0);
    expect(await db.select().from(subjects)).toHaveLength(0);
  });
});
