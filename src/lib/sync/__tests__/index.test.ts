import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { getPendingChanges } from "../queue";
import {
  runSync,
  isSyncConfigured,
  enqueueEverythingForInitialPush,
  SyncNotConfiguredError,
} from "../index";

jest.mock("../push", () => ({
  pushChanges: jest.fn().mockResolvedValue({ pushed: 0, rejected: 0 }),
}));
jest.mock("../pull", () => ({ pullChanges: jest.fn().mockResolvedValue({ applied: 0 }) }));
jest.mock("../client", () => ({ isLoggedIn: jest.fn(), restoreSession: jest.fn() }));
jest.mock("@/db/repositories/semester", () => ({
  reconcileActiveSemesters: jest.fn().mockResolvedValue({ closedSemesterIds: [] }),
}));
import { pushChanges } from "../push";
import { pullChanges } from "../pull";
import { isLoggedIn, restoreSession } from "../client";
import { reconcileActiveSemesters } from "@/db/repositories/semester";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("runSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("pushes then pulls, in that order, when a session already exists", async () => {
    const db = freshTestDb();
    (isLoggedIn as jest.Mock).mockReturnValue(true);
    (pushChanges as jest.Mock).mockResolvedValueOnce({ pushed: 3, rejected: 1 });
    (pullChanges as jest.Mock).mockResolvedValueOnce({ applied: 5 });

    const result = await runSync(db);
    expect(result).toEqual({ pushed: 3, rejected: 1, pulled: 5 });

    const pushOrder = (pushChanges as jest.Mock).mock.invocationCallOrder[0];
    const pullOrder = (pullChanges as jest.Mock).mock.invocationCallOrder[0];
    expect(pushOrder).toBeLessThan(pullOrder);
  });

  it("reconciles active semesters after pulling, since a pull is what can introduce a duplicate", async () => {
    const db = freshTestDb();
    (isLoggedIn as jest.Mock).mockReturnValue(true);

    await runSync(db);

    expect(reconcileActiveSemesters).toHaveBeenCalledWith(db);
    const pullOrder = (pullChanges as jest.Mock).mock.invocationCallOrder[0];
    const reconcileOrder = (reconcileActiveSemesters as jest.Mock).mock.invocationCallOrder[0];
    expect(pullOrder).toBeLessThan(reconcileOrder);
  });

  it("tries restoreSession when no in-memory session exists, then proceeds if it succeeds", async () => {
    const db = freshTestDb();
    (isLoggedIn as jest.Mock).mockReturnValue(false);
    (restoreSession as jest.Mock).mockResolvedValueOnce(true);

    await runSync(db);
    expect(restoreSession).toHaveBeenCalled();
    expect(pushChanges).toHaveBeenCalled();
  });

  it("throws SyncNotConfiguredError when no session exists and restoreSession fails", async () => {
    const db = freshTestDb();
    (isLoggedIn as jest.Mock).mockReturnValue(false);
    (restoreSession as jest.Mock).mockResolvedValueOnce(false);

    await expect(runSync(db)).rejects.toThrow(SyncNotConfiguredError);
    expect(pushChanges).not.toHaveBeenCalled();
  });
});

describe("isSyncConfigured", () => {
  it("reflects isLoggedIn()", () => {
    (isLoggedIn as jest.Mock).mockReturnValue(true);
    expect(isSyncConfigured()).toBe(true);
  });
});

describe("enqueueEverythingForInitialPush", () => {
  it("enqueues every existing row across every synced table", async () => {
    const db = freshTestDb();
    await db
      .insert(semesters)
      .values({ id: "sem-1", label: "2026-1", status: "active", createdAt: new Date() });
    await db.insert(subjects).values({
      id: "subj-1",
      name: "Física",
      courseCode: null,
      professorName: null,
      color: "indigo",
      semesterId: "sem-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(tasks).values({
      id: "task-1",
      title: "T",
      description: null,
      subjectId: "subj-1",
      dueDateTime: new Date(),
      priority: "Alta",
      completed: false,
      completedAt: null,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await enqueueEverythingForInitialPush(db);

    const pending = await getPendingChanges(db);
    const keys = pending.map((p) => `${p.entityTable}:${p.entityId}`).sort();
    expect(keys).toEqual(["semesters:sem-1", "subjects:subj-1", "tasks:task-1"]);
    expect(pending.every((p) => p.operation === "upsert")).toBe(true);
  });

  it("is a no-op on an empty database", async () => {
    const db = freshTestDb();
    await enqueueEverythingForInitialPush(db);
    expect(await getPendingChanges(db)).toEqual([]);
  });
});
