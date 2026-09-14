import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// A local outbox of pending changes to push, keyed by (entityTable, entityId) —
// last write locally wins here too, exactly like the server's own `entities`
// table. `operation: "delete"` is recorded explicitly because the domain row
// itself is already gone by the time this gets pushed — there is nothing left
// to re-read a payload from at push time (see src/lib/sync/queue.ts).
export const syncLog = sqliteTable(
  "sync_log",
  {
    entityTable: text("entity_table").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation", { enum: ["upsert", "delete"] }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityTable, table.entityId] })],
);

export type SyncLogEntry = typeof syncLog.$inferSelect;
export type NewSyncLogEntry = typeof syncLog.$inferInsert;
