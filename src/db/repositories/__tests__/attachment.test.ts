import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { attachments } from "@/db/schema/attachment";
import { createTask } from "@/db/repositories/task";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import {
  addAttachment,
  AttachmentValidationError,
  deleteAttachmentFilesForTask,
  removeAttachment,
} from "@/db/repositories/attachment";
import * as files from "@/lib/files";

jest.mock("@/lib/files");
const mockedFiles = jest.mocked(files);

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFiles.getFileSizeBytes.mockReturnValue(1024);
  mockedFiles.copyIntoAttachmentStorage.mockResolvedValue({
    storedPath: "/fake/attachments/task-1/attachment-1-file.pdf",
  });
});

async function seedTaskInActiveSemester(db: ReturnType<typeof freshTestDb>) {
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
  const dueDateTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  const { task } = await createTask(
    { title: "Tarea", subjectId, dueDateTime, priority: "Media" },
    db,
  );
  return { semesterId, task };
}

const VALID_PICKED = {
  uri: "content://picked/file.pdf",
  name: "notas.pdf",
  mimeType: "application/pdf",
};

describe("addAttachment", () => {
  it("validates, copies, and inserts a row for a valid file", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);

    const attachment = await addAttachment(task.id, VALID_PICKED, db);

    expect(attachment.originalFileName).toBe("notas.pdf");
    expect(attachment.mimeType).toBe("application/pdf");
    expect(attachment.sizeBytes).toBe(1024);
    expect(mockedFiles.copyIntoAttachmentStorage).toHaveBeenCalledWith(
      VALID_PICKED.uri,
      task.id,
      attachment.id,
      "notas.pdf",
    );
    const rows = await db.select().from(attachments).where(eq(attachments.id, attachment.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects an oversized file without copying it", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    mockedFiles.getFileSizeBytes.mockReturnValue(26 * 1024 * 1024);

    await expect(addAttachment(task.id, { ...VALID_PICKED, name: "big.pdf" }, db)).rejects.toThrow(
      AttachmentValidationError,
    );
    expect(mockedFiles.copyIntoAttachmentStorage).not.toHaveBeenCalled();
  });

  it("rejects a disallowed type without copying it", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);

    await expect(
      addAttachment(
        task.id,
        { uri: "content://picked/archive.zip", name: "archive.zip", mimeType: "application/zip" },
        db,
      ),
    ).rejects.toThrow(AttachmentValidationError);
    expect(mockedFiles.copyIntoAttachmentStorage).not.toHaveBeenCalled();
  });

  it("throws SemesterReadOnlyError on a closed semester, without copying", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(addAttachment(task.id, VALID_PICKED, db)).rejects.toThrow(SemesterReadOnlyError);
    expect(mockedFiles.copyIntoAttachmentStorage).not.toHaveBeenCalled();
  });

  it("inserts no DB row when the copy fails (atomicity)", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    mockedFiles.copyIntoAttachmentStorage.mockRejectedValue(new Error("disk full"));

    await expect(addAttachment(task.id, VALID_PICKED, db)).rejects.toThrow("disk full");

    const rows = await db.select().from(attachments).where(eq(attachments.taskId, task.id));
    expect(rows).toHaveLength(0);
  });
});

describe("removeAttachment", () => {
  it("deletes the file and the row", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const attachment = await addAttachment(task.id, VALID_PICKED, db);

    await removeAttachment(attachment.id, db);

    expect(mockedFiles.deleteAttachmentFile).toHaveBeenCalledWith(attachment.storedPath);
    const rows = await db.select().from(attachments).where(eq(attachments.id, attachment.id));
    expect(rows).toHaveLength(0);
  });

  it("throws on a closed semester, without deleting the file", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    const attachment = await addAttachment(task.id, VALID_PICKED, db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });
    mockedFiles.deleteAttachmentFile.mockClear();

    await expect(removeAttachment(attachment.id, db)).rejects.toThrow(SemesterReadOnlyError);
    expect(mockedFiles.deleteAttachmentFile).not.toHaveBeenCalled();
  });

  it("throws a not-found error for a nonexistent id", async () => {
    const db = freshTestDb();
    await expect(removeAttachment("nonexistent-id", db)).rejects.toThrow("Attachment not found");
  });
});

describe("deleteAttachmentFilesForTask", () => {
  it("deletes the task's attachment directory", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);

    await deleteAttachmentFilesForTask(task.id, db);

    expect(mockedFiles.deleteAttachmentDirectoryForTask).toHaveBeenCalledWith(task.id);
  });

  it("throws on a closed semester, without deleting", async () => {
    const db = freshTestDb();
    const { task } = await seedTaskInActiveSemester(db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(deleteAttachmentFilesForTask(task.id, db)).rejects.toThrow(SemesterReadOnlyError);
    expect(mockedFiles.deleteAttachmentDirectoryForTask).not.toHaveBeenCalled();
  });
});
