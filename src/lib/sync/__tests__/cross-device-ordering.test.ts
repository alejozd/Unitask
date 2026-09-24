import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { reminders } from "@/db/schema/reminder";
import { createTask } from "@/db/repositories/task";
import { pushChanges } from "../push";
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
  scheduleDueNotification: jest.fn().mockResolvedValue("due-notif-1"),
  cancelDueNotification: jest.fn().mockResolvedValue(undefined),
}));

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

/**
 * Reproduces a real on-device bug found in Phase C testing: a task created
 * with a reminder in the same call, synced from a phone (device A) to a
 * fresh emulator (device B). If the reminder's sync_log entry is enqueued
 * before its own task's, the server assigns it a lower serverSeq, and
 * device B — applying pulled operations in ascending serverSeq order —
 * tries to insert the reminder before the task it references exists
 * locally, throwing "FOREIGN KEY constraint failed" (the exact error the
 * human hit) and aborting the whole sync.
 */
describe("cross-device sync ordering", () => {
  it("lets a second device apply a task+reminder created together without a foreign key violation", async () => {
    const deviceA = freshDb();
    const deviceB = freshDb();

    // Both devices already share this semester/subject from an earlier
    // sync round — not what this test is about, just realistic setup.
    await deviceA
      .insert(semesters)
      .values({ id: "sem-1", label: "2026-1", status: "active", createdAt: new Date() });
    await deviceA.insert(subjects).values({
      id: "subj-1",
      name: "Física",
      courseCode: null,
      professorName: null,
      color: "indigo",
      semesterId: "sem-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await deviceB
      .insert(semesters)
      .values({ id: "sem-1", label: "2026-1", status: "active", createdAt: new Date() });
    await deviceB.insert(subjects).values({
      id: "subj-1",
      name: "Física",
      courseCode: null,
      professorName: null,
      color: "indigo",
      semesterId: "sem-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Device A: create a task WITH a reminder in one call, like the human
    // did on their phone.
    const { task } = await createTask(
      {
        title: "Con recordatorio",
        subjectId: "subj-1",
        dueDateTime: new Date(Date.now() + 86_400_000),
        priority: "Media",
        reminderSpecs: [{ kind: "relative", offsetValue: 1, offsetUnit: "days" }],
      },
      deviceA,
    );

    // Simulate a real server: authenticatedFetch relays whatever pushChanges
    // sends, in order, as one pulled page — exactly what unitask-sync-server
    // does (a pushed batch becomes a pull page in the same order, since each
    // accepted operation gets the next serverSeq in push order).
    let relayedOperations: unknown[] = [];
    (authenticatedFetch as jest.Mock).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === "/sync/push") {
          const body = JSON.parse(init!.body as string);
          relayedOperations = body.operations;
          return {
            ok: true,
            json: async () => ({
              accepted: body.operations.map((op: any) => `${op.table}:${op.entityId}`),
              rejected: [],
            }),
          };
        }
        if (path === "/sync/pull?since=0") {
          return { ok: true, json: async () => ({ operations: relayedOperations, cursor: 99 }) };
        }
        return { ok: true, json: async () => ({ operations: [], cursor: 99 }) };
      },
    );

    await pushChanges(deviceA);
    await expect(pullChanges(deviceB)).resolves.toEqual({ applied: relayedOperations.length });

    const taskRows = await deviceB.select().from(tasks).where(eq(tasks.id, task.id));
    expect(taskRows).toHaveLength(1);
    const reminderRows = await deviceB
      .select()
      .from(reminders)
      .where(eq(reminders.taskId, task.id));
    expect(reminderRows).toHaveLength(1);
  });
});
