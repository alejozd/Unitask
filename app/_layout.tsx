import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router, Stack, usePathname } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { db } from "@/db/client";
import migrations from "@/db/migrations/migrations";
import { semesters } from "@/db/schema/semester";
import { eq } from "drizzle-orm";
import { colors } from "@/theme";

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

  const migrationsReady = success && updatedAt !== undefined;
  const hasActiveSemester = migrationsReady && (activeSemesters?.length ?? 0) > 0;
  // Phase 10.5: onboarding is now two screens. Checked individually (not a
  // single `pathname.startsWith("/onboarding")`) so the effect below can
  // route from the first screen to the second as its own state-driven
  // transition, the same race-free way it already routes into onboarding
  // and out to /(tabs) — see that effect's comment for why this matters.
  const onPrimerSemestreScreen = pathname === "/onboarding/primer-semestre";
  const onProfileStep = pathname === "/onboarding/perfil";
  const onOnboardingScreen = onPrimerSemestreScreen || onProfileStep;

  // Navigate imperatively, in an effect, instead of rendering a declarative
  // <Redirect> tied to `pathname`/`activeSemesters` changing together. The
  // declarative form caused a real "Maximum update depth exceeded" crash
  // on-device the moment `/(tabs)` became a real route (previously it just
  // 404'd, masking the loop): navigating away from onboarding, re-rendering
  // this layout with a not-yet-updated `activeSemesters` (the live query's
  // change-driven refresh hadn't landed yet), rendering <Redirect> back to
  // onboarding, and repeating — all within React Navigation's synchronous
  // re-render cascade for a single navigation transition, hitting React's
  // nested-update ceiling. Running the redirect in a `useEffect` instead
  // lets each navigation settle (commit) before the next one is even
  // considered, breaking that cascade.
  // This effect owns BOTH directions of the redirect, not just "push into
  // onboarding when there's no semester". `app/onboarding/primer-semestre.tsx`
  // deliberately does NOT call router.replace("/(tabs)") itself after
  // creating a semester — it just awaits the write and lets this effect
  // react once the live query actually reflects it. Doing the forward
  // navigation from the onboarding screen instead raced this same
  // `activeSemesters` live query (its change-driven refresh from the INSERT
  // hadn't landed yet when the screen navigated), so the freshly-mounted
  // `/(tabs)` route would render with stale `hasActiveSemester = false`,
  // this effect would send it straight back to onboarding, and the user
  // would see the form reset to empty with no visible error — reproduced
  // on-device. Making this effect the single source of truth for both
  // directions means the forward navigation only ever fires once
  // `hasActiveSemester` has actually flipped true, never before.
  // Phase 10.5: adds a second onboarding step (a nickname prompt) after the
  // semester is created, WITHOUT letting `primer-semestre.tsx` navigate
  // itself there — that was tried first and reintroduced exactly the race
  // described above (verified in review): an imperative navigation call
  // right after `await createSemester(...)` can still lose to this effect
  // reacting to the very same write, since `hasActiveSemester` flipping and
  // `pathname` actually changing are two independently-scheduled updates.
  // Instead this effect stays the single source of truth for every
  // onboarding transition: when `hasActiveSemester` flips true WHILE this
  // render's own `onPrimerSemestreScreen` is true, routing to
  // `/onboarding/perfil` is provably race-free, because both sides of the
  // condition are read from the same render pass that triggered the effect
  // — there is no second, independently-timed signal to race against.
  // `perfil.tsx` is the one screen allowed to call `router.replace("/(tabs)")`
  // itself once the user finishes (or skips) it: by that point
  // `hasActiveSemester` is already known true from having reached this
  // screen in the first place, so there's nothing left to race.
  useEffect(() => {
    if (!migrationsReady) return;
    if (!hasActiveSemester && !onOnboardingScreen) {
      router.replace("/onboarding/primer-semestre");
    } else if (hasActiveSemester && onPrimerSemestreScreen) {
      router.replace("/onboarding/perfil");
    }
  }, [migrationsReady, hasActiveSemester, onOnboardingScreen, onPrimerSemestreScreen]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error al preparar la base de datos</Text>
        <Text style={styles.errorDetail}>{error.message}</Text>
      </View>
    );
  }

  if (!migrationsReady) {
    return (
      <View style={styles.center}>
        <Text>Preparando la base de datos…</Text>
      </View>
    );
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
    color: colors.textMuted,
    textAlign: "center",
  },
});
