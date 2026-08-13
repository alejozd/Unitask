import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";

// Files.document (not Files.cache) — the OS can clear the cache directory
// without warning; the document directory is private and stable
// (09-file-management.md's persistence requirement).
const ATTACHMENTS_ROOT = new Directory(Paths.document, "attachments");

export interface PickedDocument {
  uri: string;
  name: string;
  mimeType: string | null;
}

/**
 * Opens the system document picker. Returns null if the user cancelled.
 * `mimeType` can legitimately come back null from the OS picker — callers
 * must not assume it's always present (see this plan's Global Constraints).
 */
export async function pickDocument(): Promise<PickedDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? null,
  };
}

/**
 * Reads the authoritative size of a file at `uri`, in bytes. Never trust
 * `DocumentPickerAsset.size` instead of this — it's optional and can be
 * missing depending on the OS/picker (Global Constraints).
 */
export function getFileSizeBytes(uri: string): number {
  return new File(uri).size ?? 0;
}

/**
 * Copies a picked file into this task's private attachment directory
 * ({Paths.document}/attachments/{taskId}/{attachmentId}-{originalFileName},
 * per 09-file-management.md), creating intermediate directories as needed.
 * Caller (the repository layer) is responsible for validating BEFORE
 * calling this — no validation happens here.
 *
 * Atomicity: if `copy()` throws partway (disk full, permission revoked,
 * source vanished mid-copy), any partially-written destination file is
 * deleted before rethrowing — a thrown error here must never leave an
 * orphaned partial file that nothing else would ever reference or clean
 * up, since the caller only inserts a DB row after this resolves.
 */
export async function copyIntoAttachmentStorage(
  sourceUri: string,
  taskId: string,
  attachmentId: string,
  originalFileName: string,
): Promise<{ storedPath: string }> {
  const taskDir = new Directory(ATTACHMENTS_ROOT, taskId);
  taskDir.create({ intermediates: true, idempotent: true });

  const sourceFile = new File(sourceUri);
  const destination = new File(taskDir, `${attachmentId}-${originalFileName}`);
  try {
    await sourceFile.copy(destination);
  } catch (error) {
    if (destination.exists) {
      destination.delete();
    }
    throw error;
  }

  return { storedPath: destination.uri };
}

/** Deletes one attachment's copied file. Safe to call if it no longer exists. */
export function deleteAttachmentFile(storedPath: string): void {
  const file = new File(storedPath);
  if (file.exists) {
    file.delete();
  }
}

/**
 * Deletes an entire task's attachment directory (and everything inside
 * it) in one call — used on task deletion, per 09-file-management.md's
 * "single directory delete" convention. Safe to call if the directory
 * doesn't exist (e.g. a task that never had attachments).
 */
export function deleteAttachmentDirectoryForTask(taskId: string): void {
  const taskDir = new Directory(ATTACHMENTS_ROOT, taskId);
  if (taskDir.exists) {
    taskDir.delete();
  }
}

/**
 * Hands the file to the OS "open with" flow via the system share sheet
 * (09-file-management.md's View flow) — UniTask never renders any file
 * type itself. No-ops (does not throw) if sharing isn't available on this
 * device, matching expo-sharing's own recommended availability check.
 */
export async function openAttachment(storedPath: string, mimeType: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) return;
  await Sharing.shareAsync(storedPath, { mimeType });
}
