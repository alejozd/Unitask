import { Directory, File, Paths } from "expo-file-system";

import {
  AttachmentFileNotFoundError,
  copyIntoAttachmentStorage,
  openAttachment,
} from "@/lib/files";

// `src/lib/files/index.ts` itself is otherwise untested per this project's
// convention (thin native wrapper, verified via the repository layer +
// on-device — see the Phase 5 plan's Global Constraints). This file is the
// one deliberate exception: `copyIntoAttachmentStorage`'s destination-naming
// exercises the real `expo-file-system` path-join logic (jest-expo's native
// module mock behaves like a real virtual file system, so `File`/`Directory`
// work here without further mocking), which is exactly what a path-traversal
// regression needs to catch.

function writeSourceFile(name: string, contents: string): string {
  const source = new File(Paths.document, name);
  source.write(contents);
  return source.uri;
}

describe("copyIntoAttachmentStorage", () => {
  it("sanitizes a path-traversal originalFileName so the copy stays inside the task directory", async () => {
    const taskId = "task-traversal";
    const sourceUri = writeSourceFile("source-traversal.txt", "hello");

    const { storedPath } = await copyIntoAttachmentStorage(
      sourceUri,
      taskId,
      "attach-1",
      "../../../evil.pdf",
    );

    const taskDir = new Directory(Paths.document, `attachments/${taskId}`);
    expect(storedPath.startsWith(taskDir.uri)).toBe(true);
    // The sanitized name must stay a single flat path segment directly
    // inside taskDir — no directory component survived from the traversal.
    const relative = storedPath.slice(taskDir.uri.length).replace(/^\//, "");
    expect(relative).not.toContain("/");
  });

  it("copies a well-behaved filename to the expected path", async () => {
    const taskId = "task-normal";
    const sourceUri = writeSourceFile("source-normal.txt", "hello");

    const { storedPath } = await copyIntoAttachmentStorage(
      sourceUri,
      taskId,
      "attach-2",
      "notas.pdf",
    );

    const taskDir = new Directory(Paths.document, `attachments/${taskId}`);
    expect(storedPath).toBe(`${taskDir.uri}/attach-2-notas.pdf`);
  });
});

describe("openAttachment", () => {
  it("throws AttachmentFileNotFoundError for a storedPath with no backing file (e.g. an attachment row restored via import)", async () => {
    const missingPath = new File(Paths.document, "attachments/task-x/never-written.pdf").uri;

    await expect(openAttachment(missingPath, "application/pdf")).rejects.toThrow(
      AttachmentFileNotFoundError,
    );
  });
});
