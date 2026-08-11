import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const semesters = sqliteTable("semesters", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  status: text("status", { enum: ["active", "closed"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  closedAt: integer("closed_at", { mode: "timestamp" }),
});
