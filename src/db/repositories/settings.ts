import { randomUUID } from "expo-crypto";
import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { db as defaultDb } from "@/db/client";
import * as schema from "@/db/schema";
import { settings } from "@/db/schema/settings";

export type Database = BaseSQLiteDatabase<"async" | "sync", unknown, typeof schema>;

export interface Profile {
  nickname: string | null;
  fullName: string | null;
}

/**
 * `settings` is a singleton table — at most one row ever exists (Phase 6.6,
 * docs/11-roadmap.md). `getProfile` returns an all-null default when no row
 * has been saved yet, rather than throwing or returning undefined, so
 * callers never need a separate "no profile saved yet" branch.
 */
export async function getProfile(database: Database = defaultDb): Promise<Profile> {
  const rows = await database.select().from(settings).limit(1);
  const row = rows[0];
  if (!row) {
    return { nickname: null, fullName: null };
  }
  return { nickname: row.nickname, fullName: row.fullName };
}

export async function saveProfile(profile: Profile, database: Database = defaultDb): Promise<void> {
  const rows = await database.select({ id: settings.id }).from(settings).limit(1);
  const existing = rows[0];
  const now = new Date();
  if (existing) {
    await database
      .update(settings)
      .set({ nickname: profile.nickname, fullName: profile.fullName, updatedAt: now })
      .where(eq(settings.id, existing.id));
  } else {
    await database.insert(settings).values({
      id: randomUUID(),
      nickname: profile.nickname,
      fullName: profile.fullName,
      createdAt: now,
      updatedAt: now,
    });
  }
}
