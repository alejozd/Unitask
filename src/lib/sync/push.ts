import { eq, isNull } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { attachments } from "@/db/schema/attachment";
import { getPendingChanges, clearPendingChanges } from "./queue";
import { buildPayload, SYNCED_TABLES, type SyncedTable } from "./serializers";
import { authenticatedFetch } from "./client";

export const PUSH_BATCH_SIZE = 200;

export interface PushSummary {
  pushed: number;
  rejected: number;
}

interface PushOperation {
  table: string;
  entityId: string;
  operation: "upsert" | "delete";
  payload: unknown;
  clientUpdatedAt: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function pushChanges(database: Database = defaultDb): Promise<PushSummary> {
  const pending = await getPendingChanges(database);

  let pushed = 0;
  let rejected = 0;

  // `chunk([], N)` is `[]`, so this loop is simply a no-op when the outbox
  // is empty — deliberately NOT an early return, because
  // uploadPendingAttachmentFiles below must still run even when there is
  // nothing left in sync_log (e.g. a metadata push already succeeded and
  // cleared its outbox entry on a previous call, but that file's upload
  // itself failed and needs retrying now).
  for (const batch of chunk(pending, PUSH_BATCH_SIZE)) {
    const operations: PushOperation[] = [];
    const keysToClearRegardless: string[] = [];

    for (const entry of batch) {
      const key = `${entry.entityTable}:${entry.entityId}`;
      if (entry.operation === "delete") {
        operations.push({
          table: entry.entityTable,
          entityId: entry.entityId,
          operation: "delete",
          payload: null,
          clientUpdatedAt: entry.updatedAt.getTime(),
        });
        continue;
      }

      const built = (SYNCED_TABLES as readonly string[]).includes(entry.entityTable)
        ? await buildPayload(entry.entityTable as SyncedTable, entry.entityId, database)
        : null;
      if (!built) {
        // Enqueued, then the row was deleted again before this push ran —
        // nothing to send, and nothing left worth retrying either.
        keysToClearRegardless.push(key);
        continue;
      }
      operations.push({
        table: entry.entityTable,
        entityId: entry.entityId,
        operation: "upsert",
        payload: built.payload,
        clientUpdatedAt: built.clientUpdatedAt,
      });
    }

    if (keysToClearRegardless.length > 0) {
      await clearPendingChanges(keysToClearRegardless, database);
    }
    if (operations.length === 0) continue;

    const response = await authenticatedFetch("/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations }),
    });
    const body = await response.json();

    // Both accepted AND rejected entries are cleared from the outbox: a
    // rejection means the server already holds a newer write for that
    // entity (last-write-wins), so retrying this stale local write forever
    // would be pointless — the next pullChanges() call brings the server's
    // newer version down and corrects this device.
    await clearPendingChanges([...body.accepted, ...body.rejected], database);
    pushed += body.accepted.length;
    rejected += body.rejected.length;
  }

  await uploadPendingAttachmentFiles(database);

  return { pushed, rejected };
}

/**
 * Uploads the local bytes for every attachment whose metadata has synced
 * but whose file hasn't (`syncedAt IS NULL`) — independent of whether this
 * particular attachment was part of the batch just pushed above, so a file
 * upload that failed on a previous run gets retried here too, with no
 * separate queue table needed. Best-effort per file: one file's failure
 * (e.g. 413 too large, or the device is offline for just that request)
 * must never throw and abort the whole push, since the metadata is already
 * durably synced either way.
 */
export async function uploadPendingAttachmentFiles(database: Database = defaultDb): Promise<void> {
  const pendingFiles = await database.select().from(attachments).where(isNull(attachments.syncedAt));

  for (const attachment of pendingFiles) {
    try {
      const formData = new FormData();
      // React Native's fetch/FormData accepts this {uri,name,type} shape in
      // place of a Blob — the network layer streams the file by URI, no
      // manual read-into-memory step needed.
      formData.append("file", {
        uri: attachment.storedPath,
        name: attachment.originalFileName,
        type: attachment.mimeType,
      } as unknown as Blob);

      const response = await authenticatedFetch(`/sync/attachments/${attachment.id}`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) continue; // leave syncedAt null, retried on the next pushChanges() call

      await database.update(attachments).set({ syncedAt: new Date() }).where(eq(attachments.id, attachment.id));
    } catch {
      // Network failure uploading this one file — leave syncedAt null and
      // move on to the next; never let one bad upload abort the batch.
    }
  }
}
