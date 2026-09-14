import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { attachments } from "@/db/schema/attachment";
import { enqueueChange, getPendingChanges } from "../queue";
import { pushChanges } from "../push";

jest.mock("../client", () => ({
  authenticatedFetch: jest.fn(),
}));
import { authenticatedFetch } from "../client";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

async function seedTask(db: ReturnType<typeof freshTestDb>, taskId: string) {
  await db
    .insert(semesters)
    .values({ id: `${taskId}-sem`, label: "2026-1", status: "active", createdAt: new Date() });
  await db.insert(subjects).values({
    id: `${taskId}-subj`,
    name: "Física",
    courseCode: null,
    professorName: null,
    color: "indigo",
    semesterId: `${taskId}-sem`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(tasks).values({
    id: taskId,
    title: "T",
    description: null,
    subjectId: `${taskId}-subj`,
    dueDateTime: new Date(),
    priority: "Media",
    completed: false,
    completedAt: null,
    completedLate: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

beforeEach(() => {
  (authenticatedFetch as jest.Mock).mockReset();
});

describe("pushChanges", () => {
  it("does nothing and returns zero counts when the outbox is empty", async () => {
    const db = freshTestDb();
    const result = await pushChanges(db);
    expect(result).toEqual({ pushed: 0, rejected: 0 });
    expect(authenticatedFetch).not.toHaveBeenCalled();
  });

  it("sends a pending upsert with the current row as payload, then clears it on accept", async () => {
    const db = freshTestDb();
    await db
      .insert(semesters)
      .values({ id: "sem-1", label: "2026-1", status: "active", createdAt: new Date() });
    await enqueueChange("semesters", "sem-1", "upsert", db);

    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ["semesters:sem-1"], rejected: [] }),
    });

    const result = await pushChanges(db);
    expect(result).toEqual({ pushed: 1, rejected: 0 });
    expect(await getPendingChanges(db)).toEqual([]);

    const [, init] = (authenticatedFetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.operations[0]).toMatchObject({
      table: "semesters",
      entityId: "sem-1",
      operation: "upsert",
    });
  });

  it("clears a rejected entry too (the server's newer version wins, a later pull corrects it)", async () => {
    const db = freshTestDb();
    await db
      .insert(semesters)
      .values({ id: "sem-2", label: "stale", status: "active", createdAt: new Date() });
    await enqueueChange("semesters", "sem-2", "upsert", db);

    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: [], rejected: ["semesters:sem-2"] }),
    });

    const result = await pushChanges(db);
    expect(result).toEqual({ pushed: 0, rejected: 1 });
    expect(await getPendingChanges(db)).toEqual([]);
  });

  it("sends a delete with a null payload, skipping buildPayload entirely", async () => {
    const db = freshTestDb();
    await enqueueChange("semesters", "sem-3", "delete", db);

    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ["semesters:sem-3"], rejected: [] }),
    });

    await pushChanges(db);
    const [, init] = (authenticatedFetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.operations[0]).toMatchObject({
      table: "semesters",
      entityId: "sem-3",
      operation: "delete",
      payload: null,
    });
  });

  it("drops a pending upsert whose row no longer exists (enqueued then deleted before push)", async () => {
    const db = freshTestDb();
    await enqueueChange("semesters", "sem-missing", "upsert", db);

    const result = await pushChanges(db);
    expect(result).toEqual({ pushed: 0, rejected: 0 });
    expect(authenticatedFetch).not.toHaveBeenCalled();
    expect(await getPendingChanges(db)).toEqual([]);
  });

  it("leaves the outbox untouched when the request itself fails", async () => {
    const db = freshTestDb();
    await db
      .insert(semesters)
      .values({ id: "sem-4", label: "x", status: "active", createdAt: new Date() });
    await enqueueChange("semesters", "sem-4", "upsert", db);

    (authenticatedFetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));

    await expect(pushChanges(db)).rejects.toThrow("network down");
    expect(await getPendingChanges(db)).toHaveLength(1);
  });
});

describe("uploadPendingAttachmentFiles (via pushChanges)", () => {
  it("uploads the local file for an attachment whose metadata was just accepted, then marks it synced", async () => {
    const db = freshTestDb();
    await seedTask(db, "task-1");
    await db.insert(attachments).values({
      id: "att-1",
      taskId: "task-1",
      originalFileName: "notes.pdf",
      storedPath: "/local/notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncedAt: null,
    });
    await enqueueChange("attachments", "att-1", "upsert", db);

    (authenticatedFetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accepted: ["attachments:att-1"], rejected: [] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    await pushChanges(db);

    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
    const [uploadPath, uploadInit] = (authenticatedFetch as jest.Mock).mock.calls[1];
    expect(uploadPath).toBe("/sync/attachments/att-1");
    expect(uploadInit.method).toBe("POST");
    expect(uploadInit.body).toBeInstanceOf(FormData);

    const rows = await db.select().from(attachments).where(eq(attachments.id, "att-1"));
    expect(rows[0].syncedAt).toBeInstanceOf(Date);
  });

  it("does not re-upload a file that already has syncedAt set", async () => {
    const db = freshTestDb();
    await seedTask(db, "task-1");
    await db.insert(attachments).values({
      id: "att-2",
      taskId: "task-1",
      originalFileName: "notes.pdf",
      storedPath: "/local/notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncedAt: new Date(),
    });
    await enqueueChange("attachments", "att-2", "upsert", db);

    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: ["attachments:att-2"], rejected: [] }),
    });

    await pushChanges(db);
    expect(authenticatedFetch).toHaveBeenCalledTimes(1); // only the metadata push, no upload call
  });

  it("leaves syncedAt null when the upload request fails, so the next push retries it", async () => {
    const db = freshTestDb();
    await seedTask(db, "task-1");
    await db.insert(attachments).values({
      id: "att-3",
      taskId: "task-1",
      originalFileName: "notes.pdf",
      storedPath: "/local/notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncedAt: null,
    });
    await enqueueChange("attachments", "att-3", "upsert", db);

    (authenticatedFetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accepted: ["attachments:att-3"], rejected: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 413,
        json: async () => ({ error: "too large" }),
      });

    await pushChanges(db); // uploadPendingAttachmentFiles must not throw and fail the whole push over one file

    const rows = await db.select().from(attachments).where(eq(attachments.id, "att-3"));
    expect(rows[0].syncedAt).toBeNull();
  });
});
