import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { getProfile, saveProfile } from "@/db/repositories/settings";
import { settings } from "@/db/schema/settings";

// Phase 6.6 — Minimal profile (ad-hoc, docs/11-roadmap.md's "Phase 6.6 —
// Minimal profile" section; there is no 03-business-rules.md section for
// this yet). `settings` is a singleton table: at most one row ever exists.
function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("settings repository (profile)", () => {
  it("getProfile returns an all-null default when no row has ever been saved", async () => {
    const db = freshTestDb();
    const profile = await getProfile(db);
    expect(profile).toEqual({ nickname: null, fullName: null });
  });

  it("saveProfile creates the singleton row on first save, and getProfile reflects it", async () => {
    const db = freshTestDb();
    await saveProfile({ nickname: "Ale", fullName: "Alejandro Díaz" }, db);
    const profile = await getProfile(db);
    expect(profile).toEqual({ nickname: "Ale", fullName: "Alejandro Díaz" });
  });

  it("saveProfile called twice updates the same row, never creates a second one", async () => {
    const db = freshTestDb();
    await saveProfile({ nickname: "Ale", fullName: "Alejandro Díaz" }, db);
    await saveProfile({ nickname: "Alejo", fullName: "Alejandro Díaz" }, db);

    const profile = await getProfile(db);
    expect(profile).toEqual({ nickname: "Alejo", fullName: "Alejandro Díaz" });

    const rows = await db.select().from(settings);
    expect(rows).toHaveLength(1);
  });

  it("saveProfile accepts null for either field independently (both are optional)", async () => {
    const db = freshTestDb();
    await saveProfile({ nickname: "Ale", fullName: null }, db);
    const profile = await getProfile(db);
    expect(profile).toEqual({ nickname: "Ale", fullName: null });
  });
});
