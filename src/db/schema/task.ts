import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { subjects } from "./subject";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  // Combined date+time (03-business-rules.md / 06-data-model.md assumption:
  // the "due date" and "due time" form fields persist as one instant, since
  // every rule — status, "vencida", reminder offsets — operates on a single
  // timestamp).
  dueDateTime: integer("due_date_time", { mode: "timestamp" }).notNull(),
  priority: text("priority", { enum: ["Alta", "Media", "Baja"] }).notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  completedLate: integer("completed_late", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
