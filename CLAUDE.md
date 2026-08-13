@AGENTS.md

## Current Phase Status (updated 2026-08-13)

**Phase 5 — Attachments** (plan: `docs/superpowers/plans/2026-08-13-phase5-attachments.md`), executing via subagent-driven-development, one task at a time with a strict checkpoint (push + status + explicit user OK) after every task.

- Tasks 1-6: **complete and pushed** to `origin/master` (HEAD `5f48853`). Task-by-task:
  1. `src/lib/files/index.ts` — wrapper around `expo-document-picker`/`expo-file-system`/`expo-sharing`. `app.json` ended with zero diff: none of the 3 packages' config plugins were needed (`expo-sharing`'s plugin is a no-op for share-OUT-only usage; `expo-file-system`'s plugin was deliberately NOT added because it unconditionally requests broad `READ/WRITE_EXTERNAL_STORAGE`+`INTERNET` Android permissions this app doesn't need, since attachments only ever touch the private `Paths.document` directory).
  2. `src/domain/attachment-validation.ts` — pure type/size validation (TDD), citing `03-business-rules.md` §9 in both code and test comments.
  3. `src/db/repositories/attachment.ts` — `addAttachment`/`removeAttachment`/`deleteAttachmentFilesForTask` (TDD). Closed-semester enforcement (§11) is a repository-layer guarantee (`assertTaskEditable`), independently tested per function. Atomicity: a failed copy leaves zero DB rows (tested); no orphaned partial file (try/catch cleanup in Task 1's `copyIntoAttachmentStorage`, disclosed as code-review-verified only — not unit/on-device testable given native-module boundaries).
  4. Wired `deleteAttachmentFilesForTask` into `deleteTask` and `deleteSubject`'s cascade loop — all 3 sandbox-cleanup routes (`removeAttachment`, `deleteTask`, `deleteSubject` cascade) now covered, one dedicated test per route.
  5. `src/components/AttachmentList.tsx` — presentational component, transcribed verbatim from the plan (cheap-tier/haiku implementer). Zero hardcoded colors, zero `@/db/repositories` imports (stays presentation-only).
  6. Wired `AttachmentList` into `app/tarea/[id]/index.tsx` (Task detail screen), cheap-tier/haiku implementer. `AttachmentValidationError` caught specifically with distinct size-vs-type Spanish alert text; attachments `useLiveQuery` independent/unconditional; repository layer not bypassed; new "Adjuntos" section correctly placed inside the `ScrollView` Phase 4 added (brief predated that fix, implementer re-read the live file and adapted).
- Task 7: **pending**, awaiting explicit user OK before it starts.
  - Full Phase 5 DoD verification (combined check + one short on-device pass), then the final whole-branch review + fix round (if needed) + push, matching every prior phase's close-out pattern.
- Full combined check as of Task 6: 134/134 tests (15 suites), `tsc`/`lint`/`prettier` all clean.
- Full detail per task (implementer + reviewer findings) lives in `.superpowers/sdd/progress.md`'s "UniTask Phase 5" section — that ledger is the authoritative source if this summary and the ledger ever disagree (this block is a snapshot, the ledger is append-only and always current).
