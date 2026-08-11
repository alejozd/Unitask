import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { tasks } from "./task";

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  originalFileName: text("original_file_name").notNull(),
  storedPath: text("stored_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
