import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { semesters } from "./semester";

/**
 * Fixed subject color palette (03-business-rules.md §8) — deliberately
 * excludes the priority-red (#EF4444) to avoid a student confusing a
 * subject's color with a task's High-priority stripe. Stored as an enum
 * key, never a raw hex value.
 */
export const SUBJECT_COLORS = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "teal",
  "fuchsia",
  "cyan",
  "slate",
] as const;

export const subjects = sqliteTable("subjects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  courseCode: text("course_code"),
  professorName: text("professor_name"),
  color: text("color", { enum: SUBJECT_COLORS }).notNull(),
  semesterId: text("semester_id")
    .notNull()
    .references(() => semesters.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
