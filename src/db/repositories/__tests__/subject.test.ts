import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { tasks } from "@/db/schema/task";
import { reminders } from "@/db/schema/reminder";
import { attachments } from "@/db/schema/attachment";
import * as notifications from "@/lib/notifications";
import * as files from "@/lib/files";
import {
  SemesterReadOnlyError,
  SubjectDeletionBlockedError,
  createSubject,
  deleteSubject,
  getSubject,
  listSubjectsForSemesterQuery,
  updateSubject,
} from "@/db/repositories/subject";

jest.mock("@/lib/notifications");
jest.mock("@/lib/files");
const mockedNotifications = jest.mocked(notifications);
const mockedFiles = jest.mocked(files);

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

async function seedActiveSemester(db: ReturnType<typeof freshTestDb>) {
  const id = "sem-active";
  await db
    .insert(semesters)
    .values({ id, label: "2026-1", status: "active", createdAt: new Date() });
  return id;
}

async function seedClosedSemester(db: ReturnType<typeof freshTestDb>) {
  const id = "sem-closed";
  await db
    .insert(semesters)
    .values({ id, label: "2025-2", status: "closed", createdAt: new Date(), closedAt: new Date() });
  return id;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("subject repository", () => {
  it("creates a subject under the given semester", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);

    const subject = await createSubject({ name: "Cálculo II", color: "indigo", semesterId }, db);

    expect(subject.name).toBe("Cálculo II");
    expect(subject.color).toBe("indigo");

    const fetched = await getSubject(subject.id, db);
    expect(fetched?.name).toBe("Cálculo II");
  });

  it("blocks creating a subject under a closed semester (03-business-rules.md §11)", async () => {
    const db = freshTestDb();
    const semesterId = await seedClosedSemester(db);

    await expect(
      createSubject({ name: "Física", color: "emerald", semesterId }, db),
    ).rejects.toThrow(SemesterReadOnlyError);
  });

  it("blocks updating a subject under a closed semester", async () => {
    const db = freshTestDb();
    const activeId = await seedActiveSemester(db);
    const subject = await createSubject(
      { name: "Física", color: "emerald", semesterId: activeId },
      db,
    );

    // Close the semester after the subject already exists under it.
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(updateSubject(subject.id, { name: "Física II" }, db)).rejects.toThrow(
      SemesterReadOnlyError,
    );
  });

  it("allows deleting a subject with zero tasks", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Química", color: "amber", semesterId }, db);

    await deleteSubject(subject.id, db);

    const fetched = await getSubject(subject.id, db);
    expect(fetched).toBeUndefined();
  });

  it("blocks deleting a subject with a Pendiente task (03-business-rules.md §12)", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Historia", color: "rose", semesterId }, db);

    await db.insert(tasks).values({
      id: "task-1",
      title: "Ensayo",
      subjectId: subject.id,
      dueDateTime: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 1 week from now
      priority: "Media",
      completed: false,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(deleteSubject(subject.id, db)).rejects.toThrow(SubjectDeletionBlockedError);

    const stillThere = await getSubject(subject.id, db);
    expect(stillThere).not.toBeUndefined();
  });

  it("allows deleting a subject whose only task is completed, and cascades the task", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Arte", color: "sky", semesterId }, db);

    await db.insert(tasks).values({
      id: "task-2",
      title: "Boceto",
      subjectId: subject.id,
      dueDateTime: new Date(Date.now() - 1000 * 60 * 60 * 24), // yesterday
      priority: "Baja",
      completed: true,
      completedAt: new Date(),
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await deleteSubject(subject.id, db);

    const fetchedSubject = await getSubject(subject.id, db);
    expect(fetchedSubject).toBeUndefined();

    const fetchedTasks = await db.select().from(tasks).where(eq(tasks.id, "task-2"));
    expect(fetchedTasks).toHaveLength(0);
  });

  it("blocks deleting a subject under a closed semester regardless of task state", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Ética", color: "violet", semesterId }, db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(deleteSubject(subject.id, db)).rejects.toThrow(SemesterReadOnlyError);
  });

  it("cancels pending reminder notifications for tasks a subject-deletion cascade removes", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Física", color: "sky", semesterId }, db);

    // Overdue but NOT completed — Vencida, per 03-business-rules.md §1 —
    // so checkSubjectDeletion allows the cascade (only Pendiente/En
    // progreso blocks it), but the task's reminder is still pending.
    await db.insert(tasks).values({
      id: "task-vencida",
      title: "Tarea vencida",
      subjectId: subject.id,
      dueDateTime: new Date(Date.now() - 1000 * 60 * 60 * 24), // yesterday
      priority: "Media",
      completed: false,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(reminders).values({
      id: "reminder-1",
      taskId: "task-vencida",
      kind: "relative",
      offsetValue: 1,
      offsetUnit: "days",
      computedFireAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
      notificationId: "mock-notification-pending",
      createdAt: new Date(),
    });

    await deleteSubject(subject.id, db);

    expect(mockedNotifications.cancelReminderNotification).toHaveBeenCalledWith(
      "mock-notification-pending",
    );
  });

  it("deletes attachment files for tasks a subject-deletion cascade removes", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Física", color: "sky", semesterId }, db);

    await db.insert(tasks).values({
      id: "task-vencida",
      title: "Tarea vencida",
      subjectId: subject.id,
      dueDateTime: new Date(Date.now() - 1000 * 60 * 60 * 24), // yesterday
      priority: "Media",
      completed: false,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(attachments).values({
      id: "attachment-1",
      taskId: "task-vencida",
      originalFileName: "notas.pdf",
      storedPath: "/fake/attachments/task-vencida/attachment-1-notas.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      createdAt: new Date(),
    });

    await deleteSubject(subject.id, db);

    expect(mockedFiles.deleteAttachmentDirectoryForTask).toHaveBeenCalledWith("task-vencida");
  });

  it("listSubjectsForSemesterQuery returns only that semester's subjects, alphabetically", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    // The "other semester" subject must be created while its semester is
    // still active — createSubject correctly rejects creation under an
    // already-closed semester (03-business-rules.md §11, exercised by the
    // dedicated tests above), so it's closed only after the subject exists,
    // mirroring the "blocks updating" test's setup pattern.
    const otherSemesterId = "sem-other";
    await db
      .insert(semesters)
      .values({ id: otherSemesterId, label: "2025-2", status: "active", createdAt: new Date() });
    await createSubject({ name: "Zoología", color: "teal", semesterId }, db);
    await createSubject({ name: "Álgebra", color: "cyan", semesterId }, db);
    await createSubject({ name: "Otra materia", color: "slate", semesterId: otherSemesterId }, db);
    await db
      .update(semesters)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(semesters.id, otherSemesterId));

    const results = await listSubjectsForSemesterQuery(semesterId, db);

    expect(results.map((s) => s.name)).toEqual(["Álgebra", "Zoología"]);
  });
});
