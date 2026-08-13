/** 03-business-rules.md §9: 25 MB per file, hard limit, no aggregate cap in v1. */
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

/** 03-business-rules.md §9: PDF, DOCX, XLSX, PPTX, JPG/JPEG, PNG, HEIC, TXT. */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/heic",
  "text/plain",
] as const;

export interface AttachmentCandidate {
  mimeType: string | null;
  sizeBytes: number;
}

export type AttachmentValidationResult =
  { valid: true } | { valid: false; reason: "type" | "size" };

/**
 * Type is checked before size (03-business-rules.md §9 lists type first) —
 * order matters only for which single `reason` a doubly-invalid file
 * reports, not for the pass/fail outcome.
 */
export function validateAttachment(candidate: AttachmentCandidate): AttachmentValidationResult {
  const isAllowedType =
    candidate.mimeType !== null &&
    (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(candidate.mimeType);
  if (!isAllowedType) {
    return { valid: false, reason: "type" };
  }
  if (candidate.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    return { valid: false, reason: "size" };
  }
  return { valid: true };
}
