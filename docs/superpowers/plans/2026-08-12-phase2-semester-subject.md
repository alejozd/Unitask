# Phase 2 — Semester + Subject CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first user-facing vertical slice of UniTask — the mandatory first-run semester bootstrap, the 5-tab navigation shell, and full Subject CRUD — with on-device migrations finally wired so the app can actually read/write real data on a device, matching `docs/11-roadmap.md` Phase 2.

**Architecture:** Follows `docs/07-architecture.md` throughout: screens read domain data exclusively via Drizzle's `useLiveQuery` (never copied into Zustand — no Zustand store exists yet in this phase, none is needed), all writes go through `src/db/repositories/*.ts` functions that call the pure `src/domain/*.ts` functions from Phase 1 for every automatic decision (auto-close-previous semester, read-only-when-closed, blocked-by-pending-tasks), and repository functions accept an injectable database client so they can be integration-tested against `better-sqlite3` without needing the Expo/RN runtime.

**Tech Stack:** Expo Router (file-based routes), Drizzle ORM + `useLiveQuery`, React Hook Form + Zod (new this phase), `expo-crypto` (UUID generation, new this phase), `babel-plugin-inline-import` + `drizzle-orm/expo-sqlite/migrator` (on-device migrations, new this phase).

## Global Constraints

- **Domain purity is untouched**: `src/domain/*.ts` files from Phase 1 are consumed, never modified, by this phase (no new business rules are being invented — Phase 1 already encodes everything this phase needs).
- **Rule 1 (`docs/07-architecture.md`)**: every screen that displays domain data (semesters, subjects) reads it via `useLiveQuery(db.select()...)` directly in the component. No domain data is ever copied into a Zustand store, component state cache, or module-level variable.
- **Rule 2**: no Zustand store is introduced in this phase — nothing here is UI/session state that needs one.
- **Closed-semester read-only cascade (`03-business-rules.md` §11)** must be enforced at the repository layer (throwing an error), not just hidden in the UI — a disabled button is a UX nicety, not the actual guarantee.
- **Subject color is always one of the 10 fixed palette keys** (`03-business-rules.md` §8) — never a free-form value, enforced by both the Drizzle schema's `enum` column and the Zod validation schema.
- **UUID primary keys**: every new row's `id` is generated via `expo-crypto`'s `randomUUID()`, matching the convention Phase 1's schema already assumes.
- **No feature code beyond Semester + Subject** — no Task/Reminder/Attachment UI, no repository functions for those entities (their schema exists from Phase 1, but nothing in this phase touches it beyond read-only status derivation needed for the subject-deletion check).
- Use `npx`/`npm` for all CLI tool invocations; do not install any CLI tool globally.

---

### Task 1: On-device migration bundling and foreign-key enforcement

**Files:**
- Create: `metro.config.js`, `babel.config.js` (via `npx expo customize`, then edited — never hand-written from scratch, see note below)
- Modify: `src/db/client.ts` (enable FK enforcement), `app/_layout.tsx` (run migrations before rendering anything else), `package.json`/`package-lock.json` (new dependency)

**Interfaces:**
- Consumes: `db` from `src/db/client.ts` (Phase 1), the generated `src/db/migrations/migrations.js` (Phase 1, Task 4).
- Produces: a root layout that blocks all rendering until migrations succeed, and a `db` client with foreign-key constraints actually enforced — every later task in this phase (and every future phase) can now assume writes are real and cascades work on-device, not just in the Node-side integration test from Phase 1.

> **Why this exists and why it's careful about `babel.config.js`:** this project's Expo SDK (57) does not generate `babel.config.js` by default, and a naively hand-written one breaks the build (`babel-preset-expo` isn't resolvable the way a manual file expects — see Phase 0's plan for the full story). The **only** safe way to create one is `npx expo customize babel.config.js`, which produces a working file that this task then edits (never replaces from scratch).

- [ ] **Step 1: Generate a working `babel.config.js` via the official customize command**

```bash
npx expo customize babel.config.js
```

Expected: creates `babel.config.js` at the project root with content equivalent to:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
```

Verify this exact shape (or very close to it) before continuing — if the generated file looks meaningfully different, stop and report it rather than assuming it matches.

- [ ] **Step 2: Install the Babel plugin needed to import `.sql` files as strings**

```bash
npm install --save-dev babel-plugin-inline-import
```

- [ ] **Step 3: Add the plugin to `babel.config.js`**

Edit `babel.config.js` to add the `plugins` array (keep the existing `presets` line exactly as generated):

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [["inline-import", { extensions: [".sql"] }]],
  };
};
```

- [ ] **Step 4: Create `metro.config.js` to recognize `.sql` as a source extension**

Create `metro.config.js` at the project root:

```js
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push("sql");

module.exports = config;
```

- [ ] **Step 5: Enable SQLite foreign-key enforcement in the Drizzle client**

Replace `src/db/client.ts` with:

```ts
import { openDatabaseSync } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";

import * as schema from "./schema";

const sqlite = openDatabaseSync("unitask.db", { enableChangeListener: true });

// SQLite disables foreign-key enforcement by default per connection.
// Without this, ON DELETE CASCADE (added in Phase 1 for Task/Subtask/
// Reminder/Attachment) silently does nothing on-device.
sqlite.execSync("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
```

- [ ] **Step 6: Wire migrations into the root layout, blocking render until they succeed**

Replace `app/_layout.tsx` with:

```tsx
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { db } from "@/db/client";
import migrations from "@/db/migrations/migrations";

export default function RootLayout() {
  const { success, error } = useMigrations(db, migrations);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error al preparar la base de datos</Text>
        <Text style={styles.errorDetail}>{error.message}</Text>
      </View>
    );
  }

  if (!success) {
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
    color: "#64748B",
    textAlign: "center",
  },
});
```

- [ ] **Step 7: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0.

- [ ] **Step 8: Verify on a real Android emulator/device**

This step needs a running Android emulator (per this project's own `docs/superpowers/plans/2026-08-10-phase0-scaffolding.md` final section: `ANDROID_HOME`/`ANDROID_SDK_ROOT`/`JAVA_HOME` must be exported in the shell session; the AVD used previously was named `Pixel_8`).

```bash
npx expo run:android
```

Expected: the app builds, installs, and boots without the migration error screen — it should reach the still-blank root screen (no onboarding/tabs UI exists until Tasks 3-4 of this plan). If the error screen from Step 6 appears instead, read the message and fix before continuing — do not proceed past a real migration failure.

- [ ] **Step 9: Commit**

```bash
git add babel.config.js metro.config.js src/db/client.ts app/_layout.tsx package.json package-lock.json
git commit -m "feat: wire on-device migrations and enable FK enforcement"
```

---

### Task 2: `expo-crypto` and the Semester repository

**Files:**
- Create: `src/db/repositories/semester.ts`, `src/db/repositories/__tests__/semester.test.ts`
- Modify: `package.json`/`package-lock.json` (new dependency)

**Interfaces:**
- Consumes: `semesters` table + `Semester`/`NewSemester` types from `src/db/schema/semester.ts` (Phase 1), `planSemesterCreation`/`isSemesterReadOnly` from `src/domain/semester-lifecycle.ts` (Phase 1), `db` from `src/db/client.ts` (this phase's Task 1).
- Produces: `createSemester(label, database?)`, `closeSemester(id, database?)`, `getActiveSemester(database?)`, `listSemestersQuery(database?)`, and the `Database` generic type alias (defined here, reused by every repository in this phase and beyond) — consumed by Task 3 (onboarding screen), Task 7 (semester switcher screen), and Task 5/6 (Subject repository/screens need to check a semester's read-only status).

- [ ] **Step 1: Install `expo-crypto`**

```bash
npx expo install expo-crypto
```

- [ ] **Step 2: Write the failing repository tests**

Create `src/db/repositories/__tests__/semester.test.ts`:

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import {
  closeSemester,
  createSemester,
  getActiveSemester,
  listSemestersQuery,
} from "@/db/repositories/semester";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

describe("semester repository", () => {
  it("creates the first semester as active with no other semester to close", async () => {
    const db = freshTestDb();

    const semester = await createSemester("2026-1", db);

    expect(semester.label).toBe("2026-1");
    expect(semester.status).toBe("active");
    expect(semester.closedAt).toBeNull();

    const active = await getActiveSemester(db);
    expect(active?.id).toBe(semester.id);
  });

  it("auto-closes the previously active semester when a new one is created (03-business-rules.md §10)", async () => {
    const db = freshTestDb();

    const first = await createSemester("2026-1", db);
    const second = await createSemester("2026-2", db);

    const all = await listSemestersQuery(db);
    const firstAfter = all.find((s) => s.id === first.id);
    const secondAfter = all.find((s) => s.id === second.id);

    expect(firstAfter?.status).toBe("closed");
    expect(firstAfter?.closedAt).not.toBeNull();
    expect(secondAfter?.status).toBe("active");

    const active = await getActiveSemester(db);
    expect(active?.id).toBe(second.id);
  });

  it("closeSemester sets status to closed and stamps closedAt", async () => {
    const db = freshTestDb();
    const semester = await createSemester("2026-1", db);

    await closeSemester(semester.id, db);

    const all = await listSemestersQuery(db);
    const closed = all.find((s) => s.id === semester.id);
    expect(closed?.status).toBe("closed");
    expect(closed?.closedAt).not.toBeNull();
  });

  it("getActiveSemester returns undefined when no semester exists yet", async () => {
    const db = freshTestDb();
    const active = await getActiveSemester(db);
    expect(active).toBeUndefined();
  });

  it("listSemestersQuery returns semesters newest-first", async () => {
    const db = freshTestDb();
    const first = await createSemester("2026-1", db);
    const second = await createSemester("2026-2", db);

    const all = await listSemestersQuery(db);
    expect(all.map((s) => s.id)).toEqual([second.id, first.id]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx jest src/db/repositories/__tests__/semester.test.ts
```

Expected: FAIL — `Cannot find module '@/db/repositories/semester'`.

- [ ] **Step 4: Implement the Semester repository**

Create `src/db/repositories/semester.ts`:

```ts
import { randomUUID } from "expo-crypto";
import { desc, eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { db as defaultDb } from "@/db/client";
import * as schema from "@/db/schema";
import { semesters, type Semester } from "@/db/schema/semester";
import { planSemesterCreation } from "@/domain/semester-lifecycle";

/**
 * Driver-agnostic database type so repository functions can be exercised
 * against `drizzle-orm/better-sqlite3` in Jest (no Expo/RN runtime needed)
 * as well as the real `drizzle-orm/expo-sqlite` client on-device.
 */
export type Database = BaseSQLiteDatabase<"async" | "sync", unknown, typeof schema>;

/**
 * Creates a new semester as active. If another semester is currently
 * active, it is auto-closed as part of the same operation
 * (03-business-rules.md §10) — the caller never has to close the old one
 * manually first.
 */
export async function createSemester(label: string, database: Database = defaultDb): Promise<Semester> {
  const existing = await database
    .select({ id: semesters.id, status: semesters.status })
    .from(semesters);
  const plan = planSemesterCreation(existing);

  const now = new Date();
  const newSemester: typeof semesters.$inferInsert = {
    id: randomUUID(),
    label,
    status: "active",
    createdAt: now,
  };

  await database.transaction(async (tx) => {
    for (const id of plan.semesterIdsToClose) {
      await tx.update(semesters).set({ status: "closed", closedAt: now }).where(eq(semesters.id, id));
    }
    await tx.insert(semesters).values(newSemester);
  });

  return { ...newSemester, closedAt: null };
}

export async function closeSemester(id: string, database: Database = defaultDb): Promise<void> {
  await database
    .update(semesters)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(semesters.id, id));
}

export async function getActiveSemester(database: Database = defaultDb): Promise<Semester | undefined> {
  const rows = await database.select().from(semesters).where(eq(semesters.status, "active")).limit(1);
  return rows[0];
}

export async function listSemestersQuery(database: Database = defaultDb): Promise<Semester[]> {
  return database.select().from(semesters).orderBy(desc(semesters.createdAt));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx jest src/db/repositories/__tests__/semester.test.ts
```

Expected: 5 tests passed. If `tsc` complains about the `Database` generic type not matching `better-sqlite3`'s drizzle instance, this is the one area of this plan with real cross-driver type-compatibility risk — investigate the actual error (Drizzle's `BaseSQLiteDatabase` generic parameters may need adjustment) rather than reverting to a concrete `expo-sqlite`-only type; the whole point of this type is that both drivers satisfy it.

- [ ] **Step 6: Run the full verification suite**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories/semester.ts src/db/repositories/__tests__/semester.test.ts package.json package-lock.json
git commit -m "feat: add Semester repository with auto-close-previous (TDD)"
```

---

### Task 3: First-run onboarding screen and root routing

**Files:**
- Create: `app/onboarding/primer-semestre.tsx`
- Modify: `app/_layout.tsx` (add the active-semester routing gate on top of Task 1's migration gate)

**Interfaces:**
- Consumes: `createSemester`, `getActiveSemester` from `src/db/repositories/semester.ts` (Task 2).
- Produces: the app's actual entry experience — every later task in this phase (and beyond) can assume that reaching any tab screen means an active semester already exists.

- [ ] **Step 1: Create the first-run onboarding screen**

Create `app/onboarding/primer-semestre.tsx`:

```tsx
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { createSemester } from "@/db/repositories/semester";

export default function PrimerSemestreScreen() {
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmedLabel = label.trim();
  const canSubmit = trimmedLabel.length > 0 && !submitting;

  async function handleCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await createSemester(trimmedLabel);
      router.replace("/(tabs)");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenido a UniTask</Text>
      <Text style={styles.body}>
        UniTask organiza tus materias y tareas por semestre académico. Para
        empezar, crea tu semestre actual.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Ej. 2026-1"
        value={label}
        onChangeText={setLabel}
        autoFocus
      />
      <TouchableOpacity
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleCreate}
        disabled={!canSubmit}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Crear semestre</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  body: {
    fontSize: 15,
    color: "#64748B",
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#6366F1",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
```

- [ ] **Step 2: Add the active-semester routing gate to the root layout**

Replace `app/_layout.tsx` with (building on Task 1's migration gate — the only change is the new `useLiveQuery`-based redirect block after migrations succeed):

```tsx
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
  const { data: activeSemesters } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error al preparar la base de datos</Text>
        <Text style={styles.errorDetail}>{error.message}</Text>
      </View>
    );
  }

  if (!success || activeSemesters === undefined) {
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
```

- [ ] **Step 3: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0. Note `app/(tabs)` doesn't exist yet (Task 4 creates it) — `router.replace("/(tabs)")` and the redirect logic will type-check fine regardless (Expo Router's typed routes are generated from the file tree, so this becomes a valid route once Task 4 adds the group; if `tsc` complains about the route string before Task 4, that's expected and resolves once Task 4 lands — do not work around it by pointing at a different path).

- [ ] **Step 4: Verify on a real Android emulator/device**

```bash
npx expo run:android
```

Expected: on a fresh install (or after clearing app data — `adb shell pm clear com.alejozd.unitask`), the app shows the "Bienvenido a UniTask" screen. Enter a label, tap "Crear semestre" — the app should attempt to navigate to `/(tabs)`, which will 404/error until Task 4 exists (expected at this point in the plan; re-verify this step's "reaches onboarding and creates a semester" behavior only, not the post-creation navigation).

- [ ] **Step 5: Commit**

```bash
git add app/onboarding/primer-semestre.tsx app/_layout.tsx
git commit -m "feat: add first-run semester onboarding and root routing gate"
```

---

### Task 4: Tab navigator shell

**Files:**
- Create: `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/tareas/index.tsx`, `app/(tabs)/calendario/index.tsx`, `app/(tabs)/progreso/index.tsx`, `app/(tabs)/materias/index.tsx` (placeholder — Task 6 replaces its content)
- Delete: `app/index.tsx` (Phase 0's placeholder root screen — superseded by the tab navigator's own `index`)

**Interfaces:**
- Consumes: nothing new.
- Produces: the 5-tab shell every later phase's screens mount into. `app/(tabs)/materias/index.tsx` (Task 6 of this plan) is the first tab with real content; the other four are placeholders until their own phases (3, 6, 7, 8).

- [ ] **Step 1: Delete the Phase 0 placeholder root screen**

```bash
rm app/index.tsx
```

- [ ] **Step 2: Create the tab navigator layout**

Create `app/(tabs)/_layout.tsx`:

```tsx
import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="tareas/index" options={{ title: "Tareas" }} />
      <Tabs.Screen name="calendario/index" options={{ title: "Calendario" }} />
      <Tabs.Screen name="materias/index" options={{ title: "Materias" }} />
      <Tabs.Screen name="progreso/index" options={{ title: "Progreso" }} />
    </Tabs>
  );
}
```

- [ ] **Step 3: Create the Home placeholder**

Create `app/(tabs)/index.tsx`:

```tsx
import { StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>UniTask</Text>
      <Text style={styles.subtitle}>Próximamente: resumen de tus tareas</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 14,
    color: "#64748B",
  },
});
```

- [ ] **Step 4: Create the Tareas, Calendario, and Progreso placeholders**

Create `app/(tabs)/tareas/index.tsx`:

```tsx
import { StyleSheet, Text, View } from "react-native";

export default function TareasScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Próximamente</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 16, color: "#64748B" },
});
```

Create `app/(tabs)/calendario/index.tsx` (identical shape):

```tsx
import { StyleSheet, Text, View } from "react-native";

export default function CalendarioScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Próximamente</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 16, color: "#64748B" },
});
```

Create `app/(tabs)/progreso/index.tsx` (identical shape):

```tsx
import { StyleSheet, Text, View } from "react-native";

export default function ProgresoScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Próximamente</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 16, color: "#64748B" },
});
```

Create `app/(tabs)/materias/index.tsx` (identical shape — Task 6 of this plan
replaces this placeholder with the real subject list, so that `Materias` is
never a broken/missing tab even mid-phase):

```tsx
import { StyleSheet, Text, View } from "react-native";

export default function MateriasScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Próximamente</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 16, color: "#64748B" },
});
```

- [ ] **Step 5: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0 — every tab declared in `_layout.tsx` now has a matching file, including `materias/index.tsx`, so there is no dangling route reference at any point in this task.

- [ ] **Step 6: Verify on a real Android emulator/device**

```bash
npx expo run:android
```

Expected: after completing the onboarding screen from Task 3 (or on a subsequent launch with a semester already created), the app now shows the 5-tab bar with Home/Tareas/Calendario/Materias/Progreso, all five showing their placeholder content (Materias gets real content in Task 6).

- [ ] **Step 7: Commit**

```bash
git add app/(tabs) app/index.tsx
git commit -m "feat: add 5-tab navigator shell with placeholder screens"
```

---

### Task 5: Theme color tokens and the Subject repository

**Files:**
- Modify: `src/theme/index.ts` (replace the Phase 0 placeholder with real tokens), `src/__tests__/path-alias.smoke.test.ts` (update to import a real token)
- Create: `src/db/repositories/subject.ts`, `src/db/repositories/__tests__/subject.test.ts`

**Interfaces:**
- Consumes: `subjects`/`SUBJECT_COLORS`/`Subject` from `src/db/schema/subject.ts`, `semesters` from `src/db/schema/semester.ts`, `tasks`/`subtasks` from `src/db/schema/task.ts`/`subtask.ts` (all Phase 1), `deriveTaskStatus`/`calculateTaskProgress`/`checkSubjectDeletion`/`isSemesterReadOnly` (Phase 1 domain), `Database` type from `src/db/repositories/semester.ts` (Task 2).
- Produces: `colors`/`subjectPalette` from `src/theme/index.ts` — consumed by Task 6/7's UI for rendering color swatches. `createSubject`, `updateSubject`, `deleteSubject`, `getSubject`, `listSubjectsForSemesterQuery`, `SemesterReadOnlyError`, `SubjectDeletionBlockedError` from the Subject repository — consumed by Task 6/7's screens.

> **Lessons carried over from Task 2's execution** (semester repository — read that task's report for full detail before starting this one):
> 1. **`__mocks__/expo-sqlite.ts` and `__mocks__/expo-crypto.ts` already exist** (Jest manual mocks, project-root `__mocks__/`, auto-loaded by Jest for any test that transitively imports `expo-sqlite`/`expo-crypto` via `src/db/client.ts`). Do **not** recreate them — this task's tests inherit them automatically. If a test in this task needs an `expo-sqlite`/`expo-crypto` export those mocks don't currently stub (they only cover `openDatabaseSync`/`execSync` and `randomUUID` respectively), extend the existing mock files rather than adding a second competing mock.
> 2. **`expo-asset` is now an explicit dependency** (fixes a real transitive-resolution gap in `expo-sqlite`'s own dependency chain) — already installed, nothing to do here.
> 3. **If this task ever needs `database.transaction(...)`** for atomicity (it doesn't, as designed below — `createSubject`/`updateSubject`/`deleteSubject` are each a single write), the callback **must be synchronous** using `.run()`, never `async`/`await` — both `better-sqlite3` and `drizzle-orm/expo-sqlite` reject/mishandle a Promise-returning transaction callback. Keep this in mind if the design changes during implementation.
> 4. **`orderBy` on a `mode: "timestamp"` column can tie** (whole-second precision, not milliseconds) if two rows are ever created in the same second. This task's `listSubjectsForSemesterQuery` orders by `subjects.name`, not a timestamp, so it isn't affected — but don't copy a `createdAt`-based ordering pattern from elsewhere without adding a tiebreaker (see Task 2's `rowid DESC` pattern) if a future task needs one.

- [ ] **Step 1: Replace the placeholder theme tokens with real ones**

Replace `src/theme/index.ts`:

```ts
export const colors = {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#0F172A",
  textMuted: "#64748B",
  border: "#E2E8F0",
  primary: "#6366F1",
  danger: "#EF4444",
} as const;

/**
 * Hex values for the fixed subject color palette (03-business-rules.md
 * §8) — keyed by the same enum strings stored in the `subjects.color`
 * column (src/db/schema/subject.ts SUBJECT_COLORS).
 */
export const subjectPalette: Record<string, string> = {
  indigo: "#6366F1",
  emerald: "#10B981",
  amber: "#F59E0B",
  rose: "#F43F5E",
  sky: "#0EA5E9",
  violet: "#8B5CF6",
  teal: "#14B8A6",
  fuchsia: "#EC4899",
  cyan: "#06B6D4",
  slate: "#64748B",
} as const;
```

- [ ] **Step 2: Update the Phase 0 smoke test to import a real token**

Replace `src/__tests__/path-alias.smoke.test.ts`:

```ts
import { colors } from "@/theme";

describe("path alias", () => {
  it("resolves @/ to src/", () => {
    expect(colors.primary).toBe("#6366F1");
  });
});
```

- [ ] **Step 3: Run the smoke test to verify it still passes**

```bash
npx jest src/__tests__/path-alias.smoke.test.ts
```

Expected: 1 test passed.

- [ ] **Step 4: Write the failing Subject repository tests**

Create `src/db/repositories/__tests__/subject.test.ts`:

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { semesters } from "@/db/schema/semester";
import { tasks } from "@/db/schema/task";
import {
  SemesterReadOnlyError,
  SubjectDeletionBlockedError,
  createSubject,
  deleteSubject,
  getSubject,
  listSubjectsForSemesterQuery,
  updateSubject,
} from "@/db/repositories/subject";

function freshTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "src/db/migrations" });
  return db;
}

async function seedActiveSemester(db: ReturnType<typeof freshTestDb>) {
  const id = "sem-active";
  await db.insert(semesters).values({ id, label: "2026-1", status: "active", createdAt: new Date() });
  return id;
}

async function seedClosedSemester(db: ReturnType<typeof freshTestDb>) {
  const id = "sem-closed";
  await db
    .insert(semesters)
    .values({ id, label: "2025-2", status: "closed", createdAt: new Date(), closedAt: new Date() });
  return id;
}

describe("subject repository", () => {
  it("creates a subject under the given semester", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);

    const subject = await createSubject(
      { name: "Cálculo II", color: "indigo", semesterId },
      db,
    );

    expect(subject.name).toBe("Cálculo II");
    expect(subject.color).toBe("indigo");

    const fetched = await getSubject(subject.id, db);
    expect(fetched?.name).toBe("Cálculo II");
  });

  it("blocks creating a subject under a closed semester (03-business-rules.md §11)", async () => {
    const db = freshTestDb();
    const semesterId = await seedClosedSemester(db);

    await expect(
      createSubject({ name: "Física", color: "emerald", semesterId }, db),
    ).rejects.toThrow(SemesterReadOnlyError);
  });

  it("blocks updating a subject under a closed semester", async () => {
    const db = freshTestDb();
    const activeId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Física", color: "emerald", semesterId: activeId }, db);

    // Close the semester after the subject already exists under it.
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(updateSubject(subject.id, { name: "Física II" }, db)).rejects.toThrow(
      SemesterReadOnlyError,
    );
  });

  it("allows deleting a subject with zero tasks", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Química", color: "amber", semesterId }, db);

    await deleteSubject(subject.id, db);

    const fetched = await getSubject(subject.id, db);
    expect(fetched).toBeUndefined();
  });

  it("blocks deleting a subject with a Pendiente task (03-business-rules.md §12)", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Historia", color: "rose", semesterId }, db);

    await db.insert(tasks).values({
      id: "task-1",
      title: "Ensayo",
      subjectId: subject.id,
      dueDateTime: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 1 week from now
      priority: "Media",
      completed: false,
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(deleteSubject(subject.id, db)).rejects.toThrow(SubjectDeletionBlockedError);

    const stillThere = await getSubject(subject.id, db);
    expect(stillThere).not.toBeUndefined();
  });

  it("allows deleting a subject whose only task is completed, and cascades the task", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Arte", color: "sky", semesterId }, db);

    await db.insert(tasks).values({
      id: "task-2",
      title: "Boceto",
      subjectId: subject.id,
      dueDateTime: new Date(Date.now() - 1000 * 60 * 60 * 24), // yesterday
      priority: "Baja",
      completed: true,
      completedAt: new Date(),
      completedLate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await deleteSubject(subject.id, db);

    const fetchedSubject = await getSubject(subject.id, db);
    expect(fetchedSubject).toBeUndefined();

    const fetchedTasks = await db.select().from(tasks).where(eqTaskId("task-2"));
    expect(fetchedTasks).toHaveLength(0);
  });

  it("blocks deleting a subject under a closed semester regardless of task state", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const subject = await createSubject({ name: "Ética", color: "violet", semesterId }, db);
    await db.update(semesters).set({ status: "closed", closedAt: new Date() });

    await expect(deleteSubject(subject.id, db)).rejects.toThrow(SemesterReadOnlyError);
  });

  it("listSubjectsForSemesterQuery returns only that semester's subjects, alphabetically", async () => {
    const db = freshTestDb();
    const semesterId = await seedActiveSemester(db);
    const otherSemesterId = await seedClosedSemester(db);
    await createSubject({ name: "Zoología", color: "teal", semesterId }, db);
    await createSubject({ name: "Álgebra", color: "cyan", semesterId }, db);
    await createSubject({ name: "Otra materia", color: "slate", semesterId: otherSemesterId }, db);

    const results = await listSubjectsForSemesterQuery(semesterId, db);

    expect(results.map((s) => s.name)).toEqual(["Álgebra", "Zoología"]);
  });
});

function eqTaskId(id: string) {
  // local helper kept tiny and inline rather than importing `eq` twice under
  // two different aliases in this test file
  const { eq } = require("drizzle-orm");
  const { tasks } = require("@/db/schema/task");
  return eq(tasks.id, id);
}
```

- [ ] **Step 5: Run the tests to verify they fail**

```bash
npx jest src/db/repositories/__tests__/subject.test.ts
```

Expected: FAIL — `Cannot find module '@/db/repositories/subject'`.

- [ ] **Step 6: Implement the Subject repository**

Create `src/db/repositories/subject.ts`:

```ts
import { randomUUID } from "expo-crypto";
import { and, eq, inArray } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import type { Database } from "@/db/repositories/semester";
import { semesters } from "@/db/schema/semester";
import { subjects, SUBJECT_COLORS, type Subject } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks } from "@/db/schema/task";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus, type TaskStatus } from "@/domain/task-status";
import { isSemesterReadOnly } from "@/domain/semester-lifecycle";
import { checkSubjectDeletion } from "@/domain/subject-deletion";

export type SubjectColor = (typeof SUBJECT_COLORS)[number];

export class SemesterReadOnlyError extends Error {
  constructor() {
    super("No se puede modificar una materia de un semestre cerrado.");
    this.name = "SemesterReadOnlyError";
  }
}

export class SubjectDeletionBlockedError extends Error {
  constructor(public blockingTaskCount: number) {
    super(
      `No se puede eliminar: hay ${blockingTaskCount} tarea(s) pendiente(s) o en progreso.`,
    );
    this.name = "SubjectDeletionBlockedError";
  }
}

async function assertSemesterEditable(semesterId: string, database: Database): Promise<void> {
  const rows = await database
    .select({ status: semesters.status })
    .from(semesters)
    .where(eq(semesters.id, semesterId))
    .limit(1);
  const semester = rows[0];
  if (!semester || isSemesterReadOnly(semester.status)) {
    throw new SemesterReadOnlyError();
  }
}

async function getTaskStatusesForSubject(
  subjectId: string,
  database: Database,
): Promise<{ id: string; status: TaskStatus }[]> {
  const subjectTasks = await database
    .select({ id: tasks.id, completed: tasks.completed, dueDateTime: tasks.dueDateTime })
    .from(tasks)
    .where(eq(tasks.subjectId, subjectId));

  if (subjectTasks.length === 0) return [];

  const taskIds = subjectTasks.map((task) => task.id);
  const allSubtasks = await database
    .select({ taskId: subtasks.taskId, completed: subtasks.completed })
    .from(subtasks)
    .where(inArray(subtasks.taskId, taskIds));

  return subjectTasks.map((task) => {
    const taskSubtasks = allSubtasks.filter((subtask) => subtask.taskId === task.id);
    const progress = calculateTaskProgress(taskSubtasks, task.completed);
    const status = deriveTaskStatus({
      completed: task.completed,
      dueDateTime: task.dueDateTime,
      progress,
    });
    return { id: task.id, status };
  });
}

export interface CreateSubjectInput {
  name: string;
  courseCode?: string;
  professorName?: string;
  color: SubjectColor;
  semesterId: string;
}

export async function createSubject(
  input: CreateSubjectInput,
  database: Database = defaultDb,
): Promise<Subject> {
  await assertSemesterEditable(input.semesterId, database);

  const now = new Date();
  const newSubject: typeof subjects.$inferInsert = {
    id: randomUUID(),
    name: input.name,
    courseCode: input.courseCode ?? null,
    professorName: input.professorName ?? null,
    color: input.color,
    semesterId: input.semesterId,
    createdAt: now,
    updatedAt: now,
  };

  await database.insert(subjects).values(newSubject);
  return newSubject as Subject;
}

export interface UpdateSubjectInput {
  name?: string;
  courseCode?: string | null;
  professorName?: string | null;
  color?: SubjectColor;
}

export async function updateSubject(
  id: string,
  input: UpdateSubjectInput,
  database: Database = defaultDb,
): Promise<void> {
  const rows = await database
    .select({ semesterId: subjects.semesterId })
    .from(subjects)
    .where(eq(subjects.id, id))
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error(`Subject not found: ${id}`);

  await assertSemesterEditable(existing.semesterId, database);

  await database
    .update(subjects)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(subjects.id, id));
}

export async function deleteSubject(id: string, database: Database = defaultDb): Promise<void> {
  const rows = await database
    .select({ semesterId: subjects.semesterId })
    .from(subjects)
    .where(eq(subjects.id, id))
    .limit(1);
  const subject = rows[0];
  if (!subject) throw new Error(`Subject not found: ${id}`);

  await assertSemesterEditable(subject.semesterId, database);

  const taskStatuses = await getTaskStatusesForSubject(id, database);
  const check = checkSubjectDeletion(taskStatuses);
  if (!check.allowed) {
    throw new SubjectDeletionBlockedError(check.blockingTaskCount);
  }

  // Any remaining (non-blocking) tasks and their subtasks/reminders/
  // attachments cascade-delete automatically via ON DELETE CASCADE
  // (Phase 1) now that PRAGMA foreign_keys=ON is active (this phase's
  // Task 1) — no manual cleanup needed here.
  await database.delete(subjects).where(eq(subjects.id, id));
}

export async function getSubject(id: string, database: Database = defaultDb): Promise<Subject | undefined> {
  const rows = await database.select().from(subjects).where(eq(subjects.id, id)).limit(1);
  return rows[0];
}

export async function listSubjectsForSemesterQuery(
  semesterId: string,
  database: Database = defaultDb,
): Promise<Subject[]> {
  return database
    .select()
    .from(subjects)
    .where(eq(subjects.semesterId, semesterId))
    .orderBy(subjects.name);
}
```

- [ ] **Step 7: Fix the test file's inline `require`-based helper if `tsc` objects to it**

The `eqTaskId` helper at the bottom of the test file uses `require(...)` to avoid a duplicate `eq`/`tasks` import inside the same file — if `tsc --noEmit` or lint flags this (some configs disallow `require` in TS files), replace it with plain top-level imports instead:

```ts
import { eq } from "drizzle-orm";
```

(already imported once at the top of the file for other purposes is fine — just reference the single top-level `eq` and `tasks` imports directly in that last test instead of using a separate helper function).

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx jest src/db/repositories/__tests__/subject.test.ts
```

Expected: 8 tests passed.

- [ ] **Step 9: Run the full verification suite**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/theme/index.ts src/__tests__/path-alias.smoke.test.ts src/db/repositories/subject.ts src/db/repositories/__tests__/subject.test.ts
git commit -m "feat: add real theme tokens and Subject repository (TDD)"
```

---

### Task 6: Subject form, Nueva/Editar Materia routes, and the Materias tab screen

**Files:**
- Create: `src/validation/subject.ts`, `src/components/SubjectForm.tsx`, `app/materia/nueva.tsx`, `app/materia/[id]/editar.tsx`
- Modify: `app/(tabs)/materias/index.tsx` (replace the Task 4/5 placeholder with real content)

**Interfaces:**
- Consumes: `createSubject`, `updateSubject`, `getSubject`, `listSubjectsForSemesterQuery` from `src/db/repositories/subject.ts` (Task 5); `getActiveSemester` from `src/db/repositories/semester.ts` (Task 2); `subjectPalette`/`colors` from `src/theme/index.ts` (Task 5); `SUBJECT_COLORS` from `src/db/schema/subject.ts`.
- Produces: the `SubjectForm` component, reused identically by both Nueva and Editar routes — consumed by Task 7's Detalle de Materia screen (its "Editar" button navigates to the route this task creates).

- [ ] **Step 1: Install React Hook Form and Zod**

```bash
npm install react-hook-form zod @hookform/resolvers
```

- [ ] **Step 2: Create the Zod validation schema**

Create `src/validation/subject.ts`:

```ts
import { z } from "zod";

import { SUBJECT_COLORS } from "@/db/schema/subject";

export const subjectFormSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio"),
  courseCode: z.string().trim().optional(),
  professorName: z.string().trim().optional(),
  color: z.enum(SUBJECT_COLORS),
});

export type SubjectFormValues = z.infer<typeof subjectFormSchema>;
```

- [ ] **Step 3: Create the shared Subject form component**

Create `src/components/SubjectForm.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { SUBJECT_COLORS } from "@/db/schema/subject";
import { colors, subjectPalette } from "@/theme";
import { subjectFormSchema, type SubjectFormValues } from "@/validation/subject";

interface SubjectFormProps {
  initialValues?: Partial<SubjectFormValues>;
  submitLabel: string;
  onSubmit: (values: SubjectFormValues) => Promise<void>;
}

export function SubjectForm({ initialValues, submitLabel, onSubmit }: SubjectFormProps) {
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SubjectFormValues>({
    resolver: zodResolver(subjectFormSchema),
    defaultValues: {
      name: initialValues?.name ?? "",
      courseCode: initialValues?.courseCode ?? "",
      professorName: initialValues?.professorName ?? "",
      color: initialValues?.color ?? SUBJECT_COLORS[0],
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Nombre</Text>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="Ej. Cálculo II"
          />
        )}
      />
      {errors.name && <Text style={styles.error}>{errors.name.message}</Text>}

      <Text style={styles.label}>Código (opcional)</Text>
      <Controller
        control={control}
        name="courseCode"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="Ej. MAT-201"
          />
        )}
      />

      <Text style={styles.label}>Profesor (opcional)</Text>
      <Controller
        control={control}
        name="professorName"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="Ej. Dra. García"
          />
        )}
      />

      <Text style={styles.label}>Color</Text>
      <Controller
        control={control}
        name="color"
        render={({ field }) => (
          <View style={styles.colorRow}>
            {SUBJECT_COLORS.map((colorKey) => (
              <TouchableOpacity
                key={colorKey}
                accessibilityLabel={colorKey}
                onPress={() => field.onChange(colorKey)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: subjectPalette[colorKey] },
                  field.value === colorKey && styles.colorSwatchSelected,
                ]}
              />
            ))}
          </View>
        )}
      />

      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        onPress={handleSubmit(onSubmit)}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.submitButtonText}>{submitLabel}</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingVertical: 8,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  colorSwatchSelected: {
    borderWidth: 3,
    borderColor: colors.text,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
```

- [ ] **Step 4: Create the Nueva Materia route**

Create `app/materia/nueva.tsx`:

```tsx
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { SubjectForm } from "@/components/SubjectForm";
import { getActiveSemester } from "@/db/repositories/semester";
import { createSubject } from "@/db/repositories/subject";
import type { SubjectFormValues } from "@/validation/subject";

export default function NuevaMateriaScreen() {
  async function handleSubmit(values: SubjectFormValues) {
    const activeSemester = await getActiveSemester();
    if (!activeSemester) {
      // Should be unreachable: the app never lets the user reach this
      // screen without an active semester (root layout redirect, Task 3).
      throw new Error("No hay un semestre activo");
    }
    await createSubject(
      {
        name: values.name,
        courseCode: values.courseCode || undefined,
        professorName: values.professorName || undefined,
        color: values.color,
        semesterId: activeSemester.id,
      },
    );
    router.back();
  }

  return (
    <View style={styles.container}>
      <SubjectForm submitLabel="Crear materia" onSubmit={handleSubmit} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
```

- [ ] **Step 5: Create the Editar Materia route**

Create `app/materia/[id]/editar.tsx`:

```tsx
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { SubjectForm } from "@/components/SubjectForm";
import { db } from "@/db/client";
import { subjects } from "@/db/schema/subject";
import { updateSubject } from "@/db/repositories/subject";
import type { SubjectFormValues } from "@/validation/subject";

export default function EditarMateriaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: rows } = useLiveQuery(db.select().from(subjects).where(eq(subjects.id, id)));
  const subject = rows?.[0];

  async function handleSubmit(values: SubjectFormValues) {
    await updateSubject(id, {
      name: values.name,
      courseCode: values.courseCode || null,
      professorName: values.professorName || null,
      color: values.color,
    });
    router.back();
  }

  if (!subject) {
    return (
      <View style={styles.center}>
        <Text>Cargando…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SubjectForm
        submitLabel="Guardar cambios"
        initialValues={{
          name: subject.name,
          courseCode: subject.courseCode ?? "",
          professorName: subject.professorName ?? "",
          color: subject.color,
        }}
        onSubmit={handleSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
```

- [ ] **Step 6: Implement the Materias tab list screen**

Replace `app/(tabs)/materias/index.tsx`:

```tsx
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { Link, router } from "expo-router";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { db } from "@/db/client";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { colors, subjectPalette } from "@/theme";

export default function MateriasScreen() {
  const { data: activeSemesterRows } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;

  const { data: subjectRows } = useLiveQuery(
    db.select().from(subjects).orderBy(subjects.name),
  );
  const subjectList = (subjectRows ?? []).filter((subject) => subject.semesterId === activeSemesterId);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mis Materias</Text>
        {/*
          Temporary entry point to /semestres — Phase 9's Settings screen
          (gear icon) is the permanent home for this per docs/05-navigation.md;
          until then, Materias is the most relevant screen to surface it from,
          since semester context directly affects what's shown here.
        */}
        <Link href="/semestres" asChild>
          <TouchableOpacity>
            <Text style={styles.semestresLink}>Semestres</Text>
          </TouchableOpacity>
        </Link>
      </View>

      {subjectList.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Aún no tienes materias. Crea la primera.</Text>
        </View>
      ) : (
        <FlatList
          data={subjectList}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/materia/${item.id}`)}
            >
              <View style={[styles.colorDot, { backgroundColor: subjectPalette[item.color] }]} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                {item.courseCode ? <Text style={styles.cardSubtitle}>{item.courseCode}</Text> : null}
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <Link href="/materia/nueva" asChild>
        <TouchableOpacity style={styles.fab}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  semestresLink: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  list: { paddingHorizontal: 20, paddingBottom: 96, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  cardSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  fabText: { color: "#FFFFFF", fontSize: 28, lineHeight: 30 },
});
```

- [ ] **Step 7: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0. The Materias screen's `<Link href="/semestres" ...>` points at a route Task 7 hasn't created yet in this plan's sequence — same forward-reference situation as Task 3's `/(tabs)` link, and resolved the same way: it type-checks fine once Task 7 lands (Expo Router's typed routes regenerate from the file tree), so don't treat a route-not-found complaint here as a real error to work around — just confirm Task 7 will supply it.

- [ ] **Step 8: Verify on a real Android emulator/device**

```bash
npx expo run:android
```

Expected: the Materias tab shows an empty state, tapping the FAB opens the Nueva Materia form, filling it in and submitting creates a subject and returns to the (now non-empty) list showing a color-dotted card. Tapping "Semestres" in the header will not yet navigate anywhere useful until Task 7 exists — that's expected at this point in the plan.

- [ ] **Step 9: Commit**

```bash
git add src/validation/subject.ts src/components/SubjectForm.tsx app/materia/nueva.tsx "app/materia/[id]/editar.tsx" app/(tabs)/materias/index.tsx package.json package-lock.json
git commit -m "feat: add Subject create/edit forms and Materias list screen"
```

---

### Task 7: Detalle de Materia and semester switcher/history screens

**Files:**
- Create: `app/materia/[id]/index.tsx`, `app/semestres/index.tsx`

**Interfaces:**
- Consumes: `getSubject`, `deleteSubject`, `SubjectDeletionBlockedError` from `src/db/repositories/subject.ts` (Task 5); `listSemestersQuery`, `closeSemester`, `createSemester` from `src/db/repositories/semester.ts` (Task 2); `colors`/`subjectPalette` from `src/theme/index.ts` (Task 5).
- Produces: the last two screens needed to satisfy this phase's roadmap acceptance criteria (closing a semester, viewing history, deleting a subject with the blocking-rule UI).

- [ ] **Step 1: Create the Detalle de Materia screen**

Create `app/materia/[id]/index.tsx`:

```tsx
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { db } from "@/db/client";
import { subjects } from "@/db/schema/subject";
import { SubjectDeletionBlockedError, deleteSubject } from "@/db/repositories/subject";
import { colors, subjectPalette } from "@/theme";

export default function DetalleDeMateriaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: rows } = useLiveQuery(db.select().from(subjects).where(eq(subjects.id, id)));
  const subject = rows?.[0];
  const [deleting, setDeleting] = useState(false);

  async function handleDeletePress() {
    Alert.alert(
      "Eliminar materia",
      "Esta acción eliminará la materia y sus tareas completadas.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteSubject(id);
              router.back();
            } catch (error) {
              if (error instanceof SubjectDeletionBlockedError) {
                Alert.alert(
                  "No se puede eliminar",
                  `Hay ${error.blockingTaskCount} tarea(s) pendiente(s) o en progreso. Complétalas, elimínalas o reasígnalas a otra materia antes de eliminar esta.`,
                );
              } else {
                Alert.alert("Error", "No se pudo eliminar la materia.");
              }
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }

  if (!subject) {
    return (
      <View style={styles.center}>
        <Text>Cargando…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={[styles.colorDot, { backgroundColor: subjectPalette[subject.color] }]} />
        <Text style={styles.title}>{subject.name}</Text>
      </View>
      {subject.courseCode ? <Text style={styles.detail}>Código: {subject.courseCode}</Text> : null}
      {subject.professorName ? <Text style={styles.detail}>Profesor: {subject.professorName}</Text> : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => router.push(`/materia/${subject.id}/editar`)}
        >
          <Text style={styles.editButtonText}>Editar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeletePress}
          disabled={deleting}
        >
          <Text style={styles.deleteButtonText}>Eliminar materia</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  detail: { fontSize: 14, color: colors.textMuted },
  actions: { flexDirection: "row", gap: 12, marginTop: 24 },
  editButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  editButtonText: { color: colors.primary, fontWeight: "600" },
  deleteButton: {
    flex: 1,
    backgroundColor: colors.danger,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  deleteButtonText: { color: "#FFFFFF", fontWeight: "600" },
});
```

- [ ] **Step 2: Create the semester switcher/history screen**

Create `app/semestres/index.tsx`:

```tsx
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { db } from "@/db/client";
import { closeSemester, createSemester } from "@/db/repositories/semester";
import { semesters } from "@/db/schema/semester";
import { colors } from "@/theme";
import { desc } from "drizzle-orm";

export default function SemestresScreen() {
  const { data: semesterList } = useLiveQuery(
    db.select().from(semesters).orderBy(desc(semesters.createdAt)),
  );
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreateNew() {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await createSemester(trimmed);
      setNewLabel("");
    } finally {
      setBusy(false);
    }
  }

  function handleClosePress(id: string) {
    Alert.alert(
      "Cerrar semestre",
      "El semestre y todo lo que contiene (materias, tareas) pasará a ser de solo lectura.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar semestre",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await closeSemester(id);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Semestres</Text>

      <FlatList
        data={semesterList ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{item.label}</Text>
              <Text style={styles.cardStatus}>
                {item.status === "active" ? "Activo" : "Cerrado"}
              </Text>
            </View>
            {item.status === "active" ? (
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => handleClosePress(item.id)}
                disabled={busy}
              >
                <Text style={styles.closeButtonText}>Cerrar</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />

      <View style={styles.newSemesterRow}>
        <TextInput
          style={styles.input}
          placeholder="Nuevo semestre (ej. 2026-2)"
          value={newLabel}
          onChangeText={setNewLabel}
        />
        <TouchableOpacity style={styles.createButton} onPress={handleCreateNew} disabled={busy}>
          <Text style={styles.createButtonText}>Crear</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  list: { gap: 12, paddingVertical: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
  },
  cardBody: { gap: 2 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  cardStatus: { fontSize: 13, color: colors.textMuted },
  closeButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeButtonText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  newSemesterRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  createButtonText: { color: "#FFFFFF", fontWeight: "600" },
});
```

- [ ] **Step 3: Verify TypeScript and lint are clean**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both exit 0.

- [ ] **Step 4: Run the full test suite one final time for the whole phase**

```bash
npm test
npx tsc --noEmit
npm run lint
npx prettier --check .
```

Expected: all exit 0. `npm test` should now show 10 suites (Phase 0's alias smoke test + Phase 1's 7 suites + this phase's `semester.test.ts` and `subject.test.ts`), all passing.

- [ ] **Step 5: Verify on a real Android emulator/device — the full phase acceptance criteria**

```bash
npx expo run:android
```

Manually walk through, on the emulator:
1. Fresh app (clear data first: `adb shell pm clear com.alejozd.unitask`) → shows onboarding → create "2026-1" → lands on tab shell, Materias empty.
2. Create a subject → appears in the list with its color dot.
3. Open the subject → Editar → change its name → saves.
4. Tap "Semestres" in the Materias header (the temporary link added in Task 6 Step 6) → create a second semester "2026-2" → confirm the first ("2026-1") now shows "Cerrado".
5. Go back to Materias → the subject created under "2026-1" should no longer appear (it's not under the new active semester) — confirms the closed-semester's data is excluded from the active view.
6. Try creating a subject under the now-closed "2026-1" is not directly reachable from the UI in this phase (no UI surfaces a closed semester's own "add subject" affordance) — this is fine, the *repository-level* block is what Task 5's tests already prove; UI affordance hiding for closed semesters is refined in a later phase once Task/Dashboard screens exist to need it.

- [ ] **Step 6: Commit**

```bash
git add "app/materia/[id]/index.tsx" app/semestres/index.tsx
git commit -m "feat: add Subject detail screen and semester switcher/history"
```

---

## Phase 2 — Definition of Done

All seven tasks above complete, in order, means:

- The app boots on-device with real migrations applied and foreign keys enforced (Task 1).
- A first-time user is forced through semester creation before reaching any tab (Task 2, 3).
- The 5-tab shell exists, with Materias fully functional (Task 4, 6).
- Subjects can be created, edited, and deleted, with the fixed-palette color picker and both the closed-semester read-only block and the pending-task deletion block enforced at the repository layer, not just hidden in the UI (Task 5, 6, 7).
- Creating a second semester auto-closes the first; a closed semester's subjects disappear from the active Materias view (Task 7).
- `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npx prettier --check .` all exit 0 against the final tree — this full combined check must be re-run at the end of the phase, not just relied upon from each task's own checks (the lesson from both Phase 0's and Phase 1's final reviews: cross-task issues only surface at a phase-level re-run).

This unblocks Phase 3 (Task + Subtask CRUD), which will be written as its own separate implementation plan once Phase 2 is executed and reviewed.
