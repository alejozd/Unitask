import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Redirect, Stack, usePathname } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { db } from "@/db/client";
import migrations from "@/db/migrations/migrations";
import { semesters } from "@/db/schema/semester";
import { eq } from "drizzle-orm";

export default function RootLayout() {
  const { success, error } = useMigrations(db, migrations);
  const pathname = usePathname();
  // `data` starts as `[]` (not `undefined`) for a plain `.select()` query in
  // drizzle-orm/expo-sqlite's `useLiveQuery` (confirmed by reading the
  // installed 0.45.2 source — only `SQLiteRelationalQuery` in "first" mode
  // seeds `undefined`). Checking `activeSemesters === undefined` would never
  // be true, so the redirect below would fire against the empty initial
  // array before the live query resolves, flashing onboarding on every
  // launch even for returning users with an active semester. `updatedAt` is
  // seeded `undefined` and only set once the query's first result lands, so
  // it's the correct "not yet resolved" signal instead.
  //
  // `[success]` as the deps array is required, not cosmetic: useLiveQuery's
  // effect fires its SELECT immediately on mount, racing `useMigrations`. On
  // a genuinely fresh install the `semesters` table doesn't exist yet, so
  // that first SELECT throws "no such table", which the hook swallows into
  // its own internal error state — `updatedAt` never gets set. Its fallback
  // (`addDatabaseChangeListener`) only fires on SQLite's update_hook (DML),
  // never on the CREATE TABLE migrations run, so nothing re-triggers the
  // query afterward and the app hangs on the loading screen forever
  // (reproduced on-device after `adb shell pm clear`). Passing `[success]`
  // makes the effect re-run — and the SELECT re-fire — the moment migrations
  // flip to `success`, by which point the table is guaranteed to exist.
  const { data: activeSemesters, updatedAt } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
    [success],
  );

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error al preparar la base de datos</Text>
        <Text style={styles.errorDetail}>{error.message}</Text>
      </View>
    );
  }

  if (!success || updatedAt === undefined) {
    return (
      <View style={styles.center}>
        <Text>Preparando la base de datos…</Text>
      </View>
    );
  }

  const hasActiveSemester = activeSemesters.length > 0;
  const onOnboardingScreen = pathname.startsWith("/onboarding");

  if (!hasActiveSemester && !onOnboardingScreen) {
    return <Redirect href="/onboarding/primer-semestre" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  errorDetail: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
  },
});
