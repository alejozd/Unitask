# 09 — File Management

UniTask copies attachments into app-private sandboxed storage rather than merely referencing an external URI, so attachments survive the user moving/deleting the original file or losing storage permission to its original location (`03-business-rules.md` §9).

## Attach flow

1. User taps "Añadir archivo" (or equivalent) on the Nueva/Editar Tarea form or the Detalle de Tarea screen.
2. **Pick**: `expo-document-picker` opens the system file picker (covers documents; for image-specific flows, the same API or `expo-image-picker` can be used — pick one consistently at implementation time). The picker is configured to restrict selectable MIME types where the picker API allows it, as a first line of defense.
3. **Validate**:
   - **Type**: the picked file's MIME type/extension must be one of PDF, DOCX, XLSX, PPTX, JPG/JPEG, PNG, HEIC, or TXT. Anything else is rejected immediately with an inline error — no copy occurs.
   - **Size**: the picked file must be ≤ 25 MB. Larger files are rejected immediately with an inline error — no copy occurs. There is no total per-task cap in v1.
4. **Copy to sandbox**: on passing validation, the file is copied via `expo-file-system` into an app-private directory dedicated to attachments (see storage location convention below). The original file/URI is never depended on again after this point.
5. **Store attachment record**: an `Attachment` row is created (`06-data-model.md`) referencing the copied file's local path, original filename, mime type, and size.
6. The attachment appears in the task's attachment list immediately (via `useLiveQuery`, per `07-architecture.md` Rule 1).

## Storage location convention

Attachments are copied into a dedicated subdirectory of the app's private file-system space, e.g.:

```
{FileSystem.documentDirectory}/attachments/{taskId}/{attachmentId}-{originalFileName}
```

**(assumption)**: exact directory naming convention above is a reasonable implementation default — namespacing by `taskId` keeps cleanup (deleting a task's folder) simple and avoids filename collisions across tasks. The precise scheme is an implementation detail as long as it is private (`documentDirectory`, not shared/external storage) and deterministic enough to support cleanup.

## Cleanup on task delete

Deleting a task (`03-business-rules.md` §6) deletes every copied attachment file belonging to it from app-private storage — no orphaned files are left behind. If the storage-location convention above is used, this can be a single directory delete (`{attachments}/{taskId}/`) rather than per-file deletion, but the outcome (zero leftover bytes) is the requirement, not the mechanism.

Deleting a single attachment (without deleting the whole task) removes only that attachment's file and record.

## View flow (open with)

UniTask does **not** build a custom in-app viewer for any file type in v1 (`01-product.md`). Instead:

1. User taps an attachment in the task detail screen's attachment list.
2. The app first tries a direct `ACTION_VIEW` intent via `expo-intent-launcher`, passing the file's `contentUri` and MIME type — this opens straight into the device's default (or only) handler for that MIME type when one exists, skipping the share sheet entirely. If no app can handle the intent (`ActivityNotFoundException`, rejected by `expo-intent-launcher`) or launching it fails for any other reason, the app falls back to `expo-sharing`'s `shareAsync`, which on Android surfaces the system share/open sheet so the user can pick an app. **(fast-follow FF2, shipped: the original v1 pick was `expo-sharing` exclusively — see `src/lib/files/index.ts`'s `openAttachment` for the current implementation.)**
3. Whatever apps the user already has installed that can handle the file's MIME type are offered by the OS (directly via `ACTION_VIEW`, or via the share sheet fallback). If none are installed, the OS's own "no app found" handling applies — UniTask does not attempt to catch or work around this.

## Export / import flow (JSON backup)

Full behavioral rules are defined in `03-business-rules.md` §14 and the step-by-step user journeys are in `04-user-flows.md` (flows 6 and 7). File-mechanics summary:

- **Export**: all local data is serialized to a single JSON file, written to app-private storage via `expo-file-system`, then handed to the OS via `expo-sharing`'s `shareAsync` so the user can save/send it anywhere (the same share-sheet fallback used by attachment viewing above).
- **Import**: `expo-document-picker` lets the user select a previously exported `.json` file; its contents are read via `expo-file-system`, validated for basic shape, and — after the mandatory overwrite-warning confirmation — used to fully replace local data (semesters, subjects, tasks, subtasks, reminders, attachment metadata, settings).
- As noted in `03-business-rules.md` §14, the export bundles attachment **metadata** but not the underlying file bytes in v1; restoring a backup restores records, and the referenced attachment files must still exist in app storage to be reopened (bundling actual file bytes is a future enhancement, see `11-roadmap.md`).
