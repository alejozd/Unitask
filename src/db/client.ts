import { openDatabaseSync } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";

import * as schema from "./schema";

// TODO(Phase 2): expo-sqlite does not enable foreign key enforcement by
// default. Once this client is actually used for writes, run
// `sqlite.execSync("PRAGMA foreign_keys = ON;")` after opening (or confirm
// expo-sqlite's current SDK version enables it by default — verify against
// current docs, don't assume, per this project's Phase 0 lesson about
// stale Expo SDK knowledge).
const sqlite = openDatabaseSync("unitask.db", { enableChangeListener: true });

export const db = drizzle(sqlite, { schema });
