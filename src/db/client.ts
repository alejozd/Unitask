import { openDatabaseSync } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";

// `./schema` exports nothing yet (Phase 1 adds the real tables) — importing
// it as a namespace here would be an empty object, which trips ESLint's
// import/namespace rule. Wire `{ schema }` back in once Phase 1 populates it.
const sqlite = openDatabaseSync("unitask.db", { enableChangeListener: true });

export const db = drizzle(sqlite);
