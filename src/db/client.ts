import { openDatabaseSync } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";

import * as schema from "./schema";

const sqlite = openDatabaseSync("unitask.db", { enableChangeListener: true });

// SQLite disables foreign-key enforcement by default per connection.
// Without this, ON DELETE CASCADE (added in Phase 1 for Task/Subtask/
// Reminder/Attachment) silently does nothing on-device.
sqlite.execSync("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
