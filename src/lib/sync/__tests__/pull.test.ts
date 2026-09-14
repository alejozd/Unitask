import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import { getSyncCursor } from "@/db/repositories/settings";
import { pullChanges } from "../pull";

jest.mock("../client", () => ({
  authenticatedFetch: jest.fn(),
  getAccessToken: jest.fn().mockReturnValue("at-1"),
}));
import { authenticatedFetch } from "../client";

jest.mock("@/lib/notifications", () => ({
  scheduleReminderNotification: jest.fn().mockResolvedValue("os-notif-1"),
  cancelReminderNotification: jest.fn().mockResolvedValue(undefined),
  requestNotificationPermission: jest.fn().mockResolvedValue({ granted: true }),
}));
import { scheduleReminderNotification, cancelReminderNotification } from "@/lib/notifications";

jest.mock("@/lib/files", () => ({
  saveDownloadedAttachment: jest.fn().mockResolvedValue({ storedPath: "/local/att.pdf" }),
  attachmentFileExists: jest.fn().mockReturnValue(false),
}));

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

beforeEach(() => {
  (authenticatedFetch as jest.Mock).mockReset();
  (scheduleReminderNotification as jest.Mock).mockClear();
  (cancelReminderNotification as jest.Mock).mockClear();
});

describe("pullChanges", () => {
  it("does nothing when the server has no new operations", async () => {
    const db = freshTestDb();
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({ operations: [], cursor: 0 }),
    );

    const result = await pullChanges(db);
    expect(result).toEqual({ applied: 0 });
  });

  it("applies an upsert and advances the persisted cursor", async () => {
    const db = freshTestDb();
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        operations: [
          {
            table: "semesters",
            entityId: "sem-1",
            operation: "upsert",
            payload: {
              id: "sem-1",
              label: "2026-1",
              status: "active",
              createdAt: "2026-01-01T00:00:00.000Z",
              closedAt: null,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            clientUpdatedAt: 1000,
          },
        ],
        cursor: 5,
      }),
    );
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({ operations: [], cursor: 5 }),
    );

    const result = await pullChanges(db);
    expect(result).toEqual({ applied: 1 });

    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-1"));
    expect(rows).toHaveLength(1);
    expect(await getSyncCursor(db)).toBe(5);
  });

  it("loops until an empty page comes back, applying every page", async () => {
    const db = freshTestDb();
    (authenticatedFetch as jest.Mock)
      .mockResolvedValueOnce(
        jsonResponse({
          operations: [
            {
              table: "semesters",
              entityId: "sem-a",
              operation: "upsert",
              payload: {
                id: "sem-a",
                label: "A",
                status: "active",
                createdAt: "2026-01-01T00:00:00.000Z",
                closedAt: null,
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
              clientUpdatedAt: 1,
            },
          ],
          cursor: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          operations: [
            {
              table: "semesters",
              entityId: "sem-b",
              operation: "upsert",
              payload: {
                id: "sem-b",
                label: "B",
                status: "active",
                createdAt: "2026-01-01T00:00:00.000Z",
                closedAt: null,
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
              clientUpdatedAt: 2,
            },
          ],
          cursor: 2,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ operations: [], cursor: 2 }));

    const result = await pullChanges(db);
    expect(result).toEqual({ applied: 2 });
    expect(authenticatedFetch).toHaveBeenCalledTimes(3);
    expect((authenticatedFetch as jest.Mock).mock.calls[1][0]).toBe("/sync/pull?since=1");
  });

  it("applies a delete", async () => {
    const db = freshTestDb();
    await db
      .insert(semesters)
      .values({ id: "sem-2", label: "gone", status: "active", createdAt: new Date() });
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        operations: [
          {
            table: "semesters",
            entityId: "sem-2",
            operation: "delete",
            payload: null,
            clientUpdatedAt: 10,
          },
        ],
        cursor: 1,
      }),
    );
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({ operations: [], cursor: 1 }),
    );

    await pullChanges(db);
    const rows = await db.select().from(semesters).where(eq(semesters.id, "sem-2"));
    expect(rows).toHaveLength(0);
  });

  it("reschedules the OS notification for a pulled reminder with a future fire time", async () => {
    const db = freshTestDb();
    await db
      .insert(semesters)
      .values({ id: "sem-3", label: "s", status: "active", createdAt: new Date() });
    await db.insert(subjects).values({
      id: "subj-1",
      name: "Física",
      courseCode: null,
      professorName: null,
      color: "indigo",
      semesterId: "sem-3",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(tasks).values({
      id: "task-1",
      title: "Tarea",
      description: null,
      subjectId: "subj-1",
      dueDateTime: new Date(Date.now() + 86400000),
      priority: "Alta",
      completed: false,
      completedAt: null,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const futureFireAt = new Date(Date.now() + 3600000).toISOString();
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        operations: [
          {
            table: "reminders",
            entityId: "rem-1",
            operation: "upsert",
            payload: {
              id: "rem-1",
              taskId: "task-1",
              kind: "fixed",
              offsetValue: null,
              offsetUnit: null,
              fixedDateTime: futureFireAt,
              computedFireAt: futureFireAt,
              notificationId: null,
              createdAt: futureFireAt,
              updatedAt: futureFireAt,
            },
            clientUpdatedAt: 1,
          },
        ],
        cursor: 1,
      }),
    );
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({ operations: [], cursor: 1 }),
    );

    await pullChanges(db);

    // Drizzle's `mode: "timestamp"` truncates to whole seconds on write —
    // the value read back after applyUpsert has lost its millisecond
    // component (same behavior already documented in reminder.test.ts).
    const truncatedFireAt = new Date(Math.floor(new Date(futureFireAt).getTime() / 1000) * 1000);
    expect(scheduleReminderNotification).toHaveBeenCalledWith(
      truncatedFireAt,
      expect.objectContaining({ taskTitle: "Tarea", subjectName: "Física" }),
    );
    const rows = await db.select().from(reminders).where(eq(reminders.id, "rem-1"));
    expect(rows[0].notificationId).toBe("os-notif-1");
  });

  it("cancels the old OS notification before rescheduling an already-pulled reminder", async () => {
    const db = freshTestDb();
    await db
      .insert(semesters)
      .values({ id: "sem-4", label: "s", status: "active", createdAt: new Date() });
    await db.insert(subjects).values({
      id: "subj-2",
      name: "Química",
      courseCode: null,
      professorName: null,
      color: "indigo",
      semesterId: "sem-4",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(tasks).values({
      id: "task-2",
      title: "T",
      description: null,
      subjectId: "subj-2",
      dueDateTime: new Date(Date.now() + 86400000),
      priority: "Media",
      completed: false,
      completedAt: null,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(reminders).values({
      id: "rem-2",
      taskId: "task-2",
      kind: "fixed",
      offsetValue: null,
      offsetUnit: null,
      fixedDateTime: new Date(),
      computedFireAt: new Date(Date.now() + 3600000),
      notificationId: "old-notif",
      createdAt: new Date(),
    });

    const newFireAt = new Date(Date.now() + 7200000).toISOString();
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        operations: [
          {
            table: "reminders",
            entityId: "rem-2",
            operation: "upsert",
            payload: {
              id: "rem-2",
              taskId: "task-2",
              kind: "fixed",
              offsetValue: null,
              offsetUnit: null,
              fixedDateTime: newFireAt,
              computedFireAt: newFireAt,
              notificationId: null,
              createdAt: newFireAt,
              updatedAt: newFireAt,
            },
            clientUpdatedAt: 2,
          },
        ],
        cursor: 1,
      }),
    );
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({ operations: [], cursor: 1 }),
    );

    await pullChanges(db);
    expect(cancelReminderNotification).toHaveBeenCalledWith("old-notif");
    expect(scheduleReminderNotification).toHaveBeenCalled();
  });

  it("downloads a pulled attachment's file when the local file doesn't exist yet", async () => {
    const { saveDownloadedAttachment } = jest.requireMock("@/lib/files");
    const db = freshTestDb();
    // The attachment's own task must already exist locally — per the design
    // spec, pulled operations arrive in ascending serverSeq order, which
    // respects FK order in the common case since the app itself always
    // creates a child row after its parent already exists.
    await db
      .insert(semesters)
      .values({ id: "sem-5", label: "s", status: "active", createdAt: new Date() });
    await db.insert(subjects).values({
      id: "subj-3",
      name: "Arte",
      courseCode: null,
      professorName: null,
      color: "indigo",
      semesterId: "sem-5",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(tasks).values({
      id: "task-3",
      title: "T",
      description: null,
      subjectId: "subj-3",
      dueDateTime: new Date(),
      priority: "Baja",
      completed: false,
      completedAt: null,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({
        operations: [
          {
            table: "attachments",
            entityId: "att-1",
            operation: "upsert",
            payload: {
              id: "att-1",
              taskId: "task-3",
              originalFileName: "notes.pdf",
              storedPath: "/remote/notes.pdf",
              mimeType: "application/pdf",
              sizeBytes: 10,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              syncedAt: null,
            },
            clientUpdatedAt: 1,
          },
        ],
        cursor: 1,
      }),
    );
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({ operations: [], cursor: 1 }),
    );

    await pullChanges(db);

    expect(saveDownloadedAttachment).toHaveBeenCalledWith(
      "task-3",
      "att-1",
      "notes.pdf",
      expect.stringContaining("/sync/attachments/att-1"),
      "at-1",
    );
    const rows = await db.select().from(attachments).where(eq(attachments.id, "att-1"));
    expect(rows[0].storedPath).toBe("/local/att.pdf");
  });
});
