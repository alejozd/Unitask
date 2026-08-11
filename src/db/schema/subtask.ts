import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { tasks } from "./task";

export const subtasks = sqliteTable("subtasks", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  text: text("text").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  order: integer("order").notNull(),
});
