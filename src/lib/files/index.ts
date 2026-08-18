import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as IntentLauncher from "expo-intent-launcher";
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
 * Thrown by `takePhoto` when the camera permission was denied — distinct
 * from the plain `null` result used for user cancellation, since on Android
 * a second denial is permanent until the user visits system settings and
 * callers need to tell the two cases apart to give useful feedback.
 */
export class CameraPermissionDeniedError extends Error {
  constructor() {
    super("Camera permission was denied");
    this.name = "CameraPermissionDeniedError";
  }
}

/**
 * Thrown by `openAttachment` when `storedPath` has no backing file on this
 * device — the expected state for every attachment row restored via
 * Phase 9's import (attachment FILES are never embedded in the export,
 * only their metadata/row). Distinct from every other `openAttachment`
 * failure so the caller can show a specific "not available" message
 * instead of a generic error.
 */
export class AttachmentFileNotFoundError extends Error {
  constructor() {
    super("Attachment file not found");
    this.name = "AttachmentFileNotFoundError";
  }
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
 * Opens the system camera to take a photo. Requests camera permission
 * lazily — only when the user presses the "Tomar foto" button, never
 * proactively (same pattern as requestNotificationPermission, Phase 4).
 * Returns null if the user cancelled — callers must not assume a non-null
 * result. Throws `CameraPermissionDeniedError` if permission was denied,
 * so callers can distinguish "denied" from "cancelled" and give useful
 * feedback (a plain `null` return made the two indistinguishable, so a
 * denied permission looked like the button silently doing nothing).
 */
export async function takePhoto(): Promise<PickedDocument | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new CameraPermissionDeniedError();

  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
  if (result.canceled || !result.assets || result.assets.length === 0) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? `foto-${Date.now()}.jpg`,
    mimeType: asset.mimeType ?? "image/jpeg",
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

  // `originalFileName` comes unsanitized from the OS document picker's
  // DISPLAY_NAME (controlled by whichever DocumentsProvider served the
  // file). expo-file-system's path-join does not strip `..` or encode `/`,
  // so a filename like `../../evil.pdf` could place the copied file outside
  // `attachments/{taskId}/` — defeating deleteAttachmentDirectoryForTask's
  // cleanup guarantee. Stripping path separators guarantees the joined
  // destination can never contain a directory component.
  const safeName = originalFileName.replace(/[/\\]/g, "_") || "archivo";
  const sourceFile = new File(sourceUri);
  const destination = new File(taskDir, `${attachmentId}-${safeName}`);
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
 * Hands the file to the OS "open with" flow (09-file-management.md's View
 * flow). Tries a direct ACTION_VIEW intent first (opens straight into the
 * device's default/only handler for this MIME type, if one exists) —
 * falls back to the share sheet (letting the user pick an app) if no app
 * can handle a direct VIEW intent, or if launching it fails for any other
 * reason. UniTask never renders any file type itself either way.
 */
export async function openAttachment(storedPath: string, mimeType: string): Promise<void> {
  const file = new File(storedPath);
  if (!file.exists) {
    throw new AttachmentFileNotFoundError();
  }

  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: file.contentUri,
      type: mimeType,
      flags: 1, // Intent.FLAG_GRANT_READ_URI_PERMISSION
    });
    return;
  } catch {
    // No app can handle the intent (ActivityNotFoundException, rejected by
    // expo-intent-launcher), or launching it failed for any other reason —
    // fall through to the share sheet below.
  }

  const available = await Sharing.isAvailableAsync();
  if (!available) return;
  await Sharing.shareAsync(storedPath, { mimeType });
}
