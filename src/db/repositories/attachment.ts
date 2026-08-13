import { randomUUID } from "expo-crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { assertTaskEditable } from "@/db/repositories/task-access";
import { attachments, type Attachment } from "@/db/schema/attachment";
import { validateAttachment } from "@/domain/attachment-validation";
import {
  copyIntoAttachmentStorage,
  deleteAttachmentDirectoryForTask,
  deleteAttachmentFile,
  getFileSizeBytes,
  type PickedDocument,
} from "@/lib/files";

export class AttachmentValidationError extends Error {
  constructor(public reason: "type" | "size") {
    super(
      reason === "size"
        ? "El archivo supera el tamaño máximo permitido (25 MB)."
        : "Tipo de archivo no permitido.",
    );
    this.name = "AttachmentValidationError";
  }
}

export async function addAttachment(
  taskId: string,
  picked: PickedDocument,
  database: Database = defaultDb,
): Promise<Attachment> {
  await assertTaskEditable(taskId, database);

  const sizeBytes = getFileSizeBytes(picked.uri);
  const validation = validateAttachment({ mimeType: picked.mimeType, sizeBytes });
  if (!validation.valid) {
    throw new AttachmentValidationError(validation.reason);
  }

  const id = randomUUID();
  const { storedPath } = await copyIntoAttachmentStorage(picked.uri, taskId, id, picked.name);

  const newAttachment: typeof attachments.$inferInsert = {
    id,
    taskId,
    originalFileName: picked.name,
    storedPath,
    mimeType: picked.mimeType as string, // validated non-null above (invalid type would have thrown)
    sizeBytes,
    createdAt: new Date(),
  };
  await database.insert(attachments).values(newAttachment);
  return newAttachment as Attachment;
}

async function getAttachmentOrThrow(id: string, database: Database) {
  const rows = await database.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  const attachment = rows[0];
  if (!attachment) throw new Error(`Attachment not found: ${id}`);
  return attachment;
}

export async function removeAttachment(id: string, database: Database = defaultDb): Promise<void> {
  const attachment = await getAttachmentOrThrow(id, database);
  await assertTaskEditable(attachment.taskId, database);

  deleteAttachmentFile(attachment.storedPath);
  await database.delete(attachments).where(eq(attachments.id, id));
}

/**
 * Deletes every copied attachment file for a task in one call (its whole
 * attachment directory), WITHOUT touching the attachment rows themselves —
 * used by task deletion (rows cascade-delete via ON DELETE CASCADE a
 * moment later, Task 4) and by subject-deletion cascade (mirrors Phase 4
 * Task 4's cancelAllRemindersForTask), where the rows are about to
 * cascade-away too and only the on-disk bytes need explicit cleanup.
 */
export async function deleteAttachmentFilesForTask(
  taskId: string,
  database: Database = defaultDb,
): Promise<void> {
  await assertTaskEditable(taskId, database);
  deleteAttachmentDirectoryForTask(taskId);
}
