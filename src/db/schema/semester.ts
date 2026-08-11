import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { SEMESTER_STATUSES } from "@/domain/semester-lifecycle";

export const semesters = sqliteTable("semesters", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  status: text("status", { enum: SEMESTER_STATUSES }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  closedAt: integer("closed_at", { mode: "timestamp" }),
});

export type Semester = typeof semesters.$inferSelect;
export type NewSemester = typeof semesters.$inferInsert;
