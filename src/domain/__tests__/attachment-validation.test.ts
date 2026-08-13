import { MAX_ATTACHMENT_SIZE_BYTES, validateAttachment } from "@/domain/attachment-validation";

// Limits under test are 03-business-rules.md §9: "Max size: 25 MB per file
// (hard limit)"; "Allowed types: PDF, DOCX, XLSX, PPTX, JPG/JPEG, PNG,
// HEIC, TXT. Any other file type is rejected."
describe("validateAttachment", () => {
  it("accepts a PDF under the size limit", () => {
    expect(validateAttachment({ mimeType: "application/pdf", sizeBytes: 1024 })).toEqual({
      valid: true,
    });
  });

  it("accepts every allowed type at a small size", () => {
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "image/jpeg",
      "image/png",
      "image/heic",
      "text/plain",
    ];
    for (const mimeType of allowedTypes) {
      expect(validateAttachment({ mimeType, sizeBytes: 1024 })).toEqual({ valid: true });
    }
  });

  it("accepts a file at exactly the 25 MB limit", () => {
    expect(
      validateAttachment({ mimeType: "application/pdf", sizeBytes: MAX_ATTACHMENT_SIZE_BYTES }),
    ).toEqual({ valid: true });
  });

  it("rejects a file one byte over the 25 MB limit, reason size", () => {
    expect(
      validateAttachment({
        mimeType: "application/pdf",
        sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1,
      }),
    ).toEqual({ valid: false, reason: "size" });
  });

  it("rejects a disallowed type, reason type", () => {
    expect(validateAttachment({ mimeType: "application/zip", sizeBytes: 1024 })).toEqual({
      valid: false,
      reason: "type",
    });
  });

  it("rejects a null mimeType, reason type", () => {
    expect(validateAttachment({ mimeType: null, sizeBytes: 1024 })).toEqual({
      valid: false,
      reason: "type",
    });
  });

  it("checks type before size when both are invalid", () => {
    expect(
      validateAttachment({ mimeType: "application/zip", sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1 }),
    ).toEqual({ valid: false, reason: "type" });
  });
});
