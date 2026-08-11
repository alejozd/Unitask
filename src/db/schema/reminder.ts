import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { tasks } from "./task";

export const reminders = sqliteTable("reminders", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  kind: text("kind", { enum: ["relative", "fixed"] }).notNull(),
  // Required when kind = "relative", null when kind = "fixed".
  offsetValue: integer("offset_value"),
  offsetUnit: text("offset_unit", { enum: ["minutes", "hours", "days"] }),
  // Required when kind = "fixed", null when kind = "relative".
  fixedDateTime: integer("fixed_date_time", { mode: "timestamp" }),
  // Always populated: for "relative", computed as dueDateTime - offset;
  // for "fixed", equal to fixedDateTime. Kept up to date by the repository
  // layer (Phase 4) using src/domain/reminder-scheduling.ts's pure math.
  computedFireAt: integer("computed_fire_at", { mode: "timestamp" }).notNull(),
  // The id expo-notifications returns when the OS notification is
  // scheduled; null once fired or cancelled.
  notificationId: text("notification_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
