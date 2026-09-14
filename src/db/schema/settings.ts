import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  nickname: text("nickname"),
  fullName: text("full_name"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  // Phase C — local-only sync device state, never pushed/pulled itself.
  // Null syncEmail means this device has no linked sync account yet.
  syncEmail: text("sync_email"),
  syncCursor: integer("sync_cursor"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
});

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
