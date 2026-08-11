# Phase 0 — Project Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Expo + TypeScript + Expo Router project skeleton, base tooling (lint/format/test), and the Drizzle/`expo-sqlite` wiring (empty schema) for UniTask, with zero feature code — matching `docs/11-roadmap.md` Phase 0.

**Architecture:** Follows `docs/07-architecture.md` exactly: Expo managed workflow, TypeScript strict mode, Expo Router for navigation, Drizzle ORM over `expo-sqlite` (no raw SQL), Zustand reserved for later phases (not wired yet — nothing to hold in Phase 0), Jest + React Native Testing Library for tests.

**Tech Stack:** Expo (latest SDK via `create-expo-app`), TypeScript, Expo Router, `expo-sqlite`, `drizzle-orm` + `drizzle-kit`, ESLint (`eslint-config-expo`) + Prettier, `jest-expo` + `@testing-library/react-native`.

## Global Constraints

- **Platform**: Android only for the MVP (no iOS-specific setup, testing, or polish — per `docs/01-product.md`).
- **No feature code in this phase** — tooling and skeleton only. Domain logic and schema tables start in Phase 1 (separate plan).
- **Preserve existing files**: `README.md` and the entire `docs/` tree at the project root already exist (discovery-phase output) and must not be overwritten or deleted by the scaffold tool.
- **Persistence**: Drizzle ORM over `expo-sqlite`, never hand-written raw SQL (`docs/07-architecture.md` Rule 1).
- **State**: Zustand is reserved for UI/session state only, never domain data (`docs/07-architecture.md` Rule 2) — not relevant yet in Phase 0 since no Zustand store is created here, but every later task must respect it.
- **Folder structure**: must match the `src/` layout proposed in `docs/07-architecture.md` exactly (folder names below are not negotiable).
- Use `npx`/`npm` for all CLI tool invocations; do not install any CLI tool globally.

---

### Task 1: Scaffold the Expo + TypeScript + Expo Router project

> **Corrected after Task 1 execution (Expo SDK 57):** the original version of this
> task listed `babel.config.js` as generated output. Verified against
> https://docs.expo.dev/versions/v57.0.0/config/babel/ — **this is wrong for the
> current SDK.** As of SDK 57, `create-expo-app` does NOT generate a
> `babel.config.js` file, and none is needed: "There is no need to create a
> babel.config.js file unless you need to customize the Babel configuration."
> `babel-preset-expo` is applied implicitly by Expo CLI's Metro integration and is
> **not** resolvable as a plain top-level `require()` the way an explicit
> `babel.config.js` would need — creating the file without going through
> `npx expo customize babel.config.js` breaks the build (`Cannot find module
> 'babel-preset-expo'`), confirmed by hand during Task 1's review. Do not create
> `babel.config.js` in this task. See the same correction in Task 3 below (it
> no longer needs `babel-plugin-module-resolver` either — Metro has native
> tsconfig-paths alias support).

**Files:**
- Create: `package.json`, `app.json`, `tsconfig.json`, `.gitignore`, `assets/` (icons/splash, Expo-generated), `app/_layout.tsx`, `app/index.tsx`
- Modify: none directly (existing `README.md` is backed up and restored, not edited)
- Delete: the template's generated `App.tsx`, the generated `index.ts` (dead entry point, superseded by `"main": "expo-router/entry"` — the original template still wires `index.ts` to import the now-deleted `App.tsx`), and the scaffold's own generated `README.md` (replaced by the restored discovery-phase `README.md`)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a bootable Expo Router app with a single blank root route at `app/index.tsx`, and `app/_layout.tsx` as the router's root layout — later tasks (and later phases) add routes under `app/` and import from `src/`.

- [ ] **Step 1: Preserve the existing discovery-phase README**

```bash
mv README.md README.md.bak
```

Expected: `README.md.bak` exists at the project root; `docs/` is untouched (the scaffold tool never touches subdirectories it doesn't generate itself).

- [ ] **Step 2: Run the Expo scaffold command in the current directory**

```bash
npx create-expo-app@latest . --template blank-typescript --yes
```

Expected: exits 0; creates `package.json`, `app.json`, `App.tsx`, `tsconfig.json`, `.gitignore`, `assets/`, `index.ts` (entry point) at the project root. `docs/` and `README.md.bak` remain untouched.

- [ ] **Step 3: Restore the discovery-phase README, discarding the generated one**

```bash
mv -f README.md.bak README.md
```

Expected: `README.md` now contains the original discovery-phase content (the one written during discovery, with links to all 11 `docs/*.md` files), not Expo's generated boilerplate.

- [ ] **Step 4: Install Expo Router and its peer dependencies**

```bash
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar
```

Expected: exits 0; `package.json` dependencies now include `expo-router`, `react-native-safe-area-context`, `react-native-screens`, `expo-linking`, `expo-constants`, `expo-status-bar` at Expo-compatible versions (this is what `expo install`, as opposed to plain `npm install`, guarantees).

- [ ] **Step 5: Switch the app entry point to Expo Router**

Edit `package.json` — change the `"main"` field:

```json
"main": "expo-router/entry"
```

Then delete the template's default entry component:

```bash
rm App.tsx
```

Expected: `package.json`'s `"main"` field reads `"expo-router/entry"`; `App.tsx` no longer exists.

- [ ] **Step 6: Create the router root layout**

Create `app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 7: Create the blank root screen**

Create `app/index.tsx`:

```tsx
import { StyleSheet, Text, View } from "react-native";

export default function Index() {
  return (
    <View style={styles.container}>
      <Text>UniTask</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
```

- [ ] **Step 8: Set the router URL scheme**

Edit `app.json` — inside the top-level `"expo"` object, set:

```json
"scheme": "unitask"
```

- [ ] **Step 9: Verify the app boots (manual device/emulator check)**

```bash
npx expo start
```

Expected: Metro bundler starts with no red-screen build errors. Press `a` (or scan the QR code on a physical device) to open on an Android emulator/device. Confirm the screen shows the text "UniTask" centered on a blank background. This is a manual verification step — there is no automated test for "does the app visually boot," consistent with the OS-level manual-check pattern already established for later phases in `docs/11-roadmap.md` (e.g. Phase 4's notification delivery check).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Expo + TypeScript + Expo Router project"
```

---

### Task 2: Create the `src/` folder structure skeleton

**Files:**
- Create: `src/db/schema/README.md`, `src/db/repositories/README.md`, `src/domain/README.md`, `src/features/dashboard/README.md`, `src/features/tasks/README.md`, `src/features/subjects/README.md`, `src/features/calendar/README.md`, `src/features/progress/README.md`, `src/features/settings/README.md`, `src/components/README.md`, `src/stores/README.md`, `src/lib/notifications/README.md`, `src/lib/files/README.md`, `src/validation/README.md`, `src/theme/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the exact folder layout every later phase (1–10) writes into, matching `docs/07-architecture.md`'s proposed structure 1:1. Each `README.md` is a one-line marker (git doesn't track empty directories) that also documents the folder's single responsibility for anyone opening it cold.

- [ ] **Step 1: Create each folder with a one-line purpose marker**

```bash
mkdir -p src/db/schema src/db/repositories src/domain \
  src/features/dashboard src/features/tasks src/features/subjects src/features/calendar src/features/progress src/features/settings \
  src/components src/stores src/lib/notifications src/lib/files src/validation src/theme

echo "Drizzle schema definitions, one file per entity (see docs/06-data-model.md). Populated starting Phase 1." > src/db/schema/README.md
echo "CRUD + query functions per entity, used by screens/hooks. Populated starting Phase 1." > src/db/repositories/README.md
echo "Pure business-logic functions — no React, no SQLite (see docs/03-business-rules.md). Populated starting Phase 1." > src/domain/README.md
echo "Home tab UI composition. Populated starting Phase 6." > src/features/dashboard/README.md
echo "Task/subtask UI composition. Populated starting Phase 3." > src/features/tasks/README.md
echo "Subject UI composition. Populated starting Phase 2." > src/features/subjects/README.md
echo "Calendar tab UI composition. Populated starting Phase 7." > src/features/calendar/README.md
echo "Progress tab UI composition. Populated starting Phase 8." > src/features/progress/README.md
echo "Settings screen UI composition. Populated starting Phase 9." > src/features/settings/README.md
echo "Shared/reusable UI components (buttons, cards, ReminderPicker, etc.). Populated starting Phase 2." > src/components/README.md
echo "Zustand stores — UI/session state ONLY, never domain data (see docs/07-architecture.md Rule 2)." > src/stores/README.md
echo "Thin wrapper around expo-notifications. Populated starting Phase 4." > src/lib/notifications/README.md
echo "Thin wrapper around expo-file-system/document-picker/sharing. Populated starting Phase 5." > src/lib/files/README.md
echo "Zod schemas, ideally generated via drizzle-zod from src/db/schema. Populated starting Phase 1." > src/validation/README.md
echo "Design tokens (colors, spacing, typography) — semantic variables, never hardcoded hex in components." > src/theme/README.md
```

Expected: `find src -type d | sort` lists exactly the 15 directories above (plus `src` itself); each contains a non-empty `README.md`.

- [ ] **Step 2: Verify the structure**

```bash
find src -type f -name "README.md" | wc -l
```

Expected: `15`.

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "chore: scaffold src/ folder structure per architecture doc"
```

---

### Task 3: Configure TypeScript strict mode and the `@/` path alias

> **Corrected after Task 1 execution (Expo SDK 57):** the original version of this
> task added `babel-plugin-module-resolver` via a `babel.config.js` edit. That is
> unnecessary and must NOT be done — per
> https://docs.expo.dev/versions/v57.0.0/config/metro/#custom-resolving, "Expo CLI
> extends the default Metro resolver to add features like Web, Server, and
> **tsconfig aliases support**" natively. Setting `baseUrl`/`paths` in
> `tsconfig.json` alone is sufficient for both TypeScript's own checker AND
> Metro's bundler resolution — no Babel plugin, and no `babel.config.js` file,
> needed. Do not reintroduce `babel.config.js` (see Task 1's note on why an
> explicit one breaks the build unless created via `npx expo customize
> babel.config.js`, which is not required here since no customization is
> needed).

**Files:**
- Modify: `tsconfig.json`
- Create: `src/__tests__/path-alias.smoke.test.ts` (deleted again at the end of Task 6 once the real smoke test exists — see Step 3 note)

**Interfaces:**
- Consumes: the `src/` tree from Task 2.
- Produces: the `@/*` → `src/*` import alias every subsequent task/phase uses (e.g. `import { db } from "@/db/client"`).

- [ ] **Step 1: Enable strict mode and the path alias in `tsconfig.json`**

Replace `tsconfig.json` with:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 2: Write a throwaway smoke test proving the alias resolves**

Create `src/theme/index.ts`:

```ts
export const PLACEHOLDER_TOKEN = "unitask";
```

Create `src/__tests__/path-alias.smoke.test.ts`:

```ts
import { PLACEHOLDER_TOKEN } from "@/theme";

describe("path alias", () => {
  it("resolves @/ to src/", () => {
    expect(PLACEHOLDER_TOKEN).toBe("unitask");
  });
});
```

Note: this test only runs successfully once Jest itself is configured in Task 6 — for now, verify the alias compiles via `npx tsc --noEmit` (Step 3) and resolves at bundle time via `npx expo export` (Step 4). The test file stays in place; Task 6 will run it for real as part of the Jest smoke test.

- [ ] **Step 3: Verify TypeScript compiles cleanly with the alias**

```bash
npx tsc --noEmit
```

Expected: exits 0, no errors (in particular, no "Cannot find module '@/theme'" error).

- [ ] **Step 4: Verify Metro's bundler also resolves the alias (not just `tsc`)**

TypeScript's checker and Metro's runtime bundler resolve modules independently — `tsc` passing does not guarantee Metro can actually bundle the import. Prove the alias works end-to-end by temporarily importing it from the app's real entry route, then reverting:

```bash
npx expo export --platform android
```

Before running this, temporarily add `import "@/theme";` as the first line of `app/index.tsx`, run the export, confirm it succeeds with zero errors (same pattern as Task 1 Step 9's headless verification), then remove that temporary import line from `app/index.tsx` again (the real usage of the alias starts in later phases — this task only proves the mechanism works). Delete the `dist/` output afterward (gitignored, but keep the working tree tidy).

Expected: `npx expo export --platform android` exits with an "Exported: dist" success message and zero bundling errors, both with and without the temporary import (i.e. the app still exports cleanly after the import line is removed too).

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json src/theme/index.ts src/__tests__/path-alias.smoke.test.ts
git commit -m "chore: enable TypeScript strict mode and @/ path alias"
```

---

### Task 4: Configure ESLint and Prettier

**Files:**
- Create: `eslint.config.js`, `.prettierrc.json`, `.prettierignore`
- Modify: `package.json` (add `lint` and `format` scripts)

**Interfaces:**
- Consumes: nothing new.
- Produces: `npm run lint` and `npm run format`, used as a manual/CI gate in every later phase (not enforced automatically by this plan, but available).

> **Corrected before execution (Expo SDK 57), following the pattern from Tasks 1
> and 3:** verified against https://docs.expo.dev/guides/using-eslint/ before
> writing this task rather than after a failure. The officially documented setup
> uses the `npx expo lint` bootstrap command (which installs `eslint` +
> `eslint-config-expo` itself and generates `eslint.config.js` extending
> `eslint-config-expo/flat`), not a hand-installed/hand-written config. Prettier
> integration uses `eslint-plugin-prettier/recommended` + `eslint/config`'s
> `defineConfig`, not a bare `eslint-config-prettier` spread. Steps below reflect
> the documented approach.

- [ ] **Step 1: Bootstrap ESLint via the Expo CLI**

```bash
npx expo lint
```

Expected: installs `eslint` and `eslint-config-expo` as devDependencies, creates `eslint.config.js` at the project root (extending `eslint-config-expo/flat`), and adds a `"lint": "expo lint"` script to `package.json`. It will also prompt to run immediately after setup — let it run once; a handful of warnings against the generated `app/`/`assets/` files is expected and fine at this stage (no application code exists to actually lint yet beyond the Task 1/2/3 scaffolding).

- [ ] **Step 2: Install Prettier and its ESLint integration**

```bash
npx expo install prettier eslint-config-prettier eslint-plugin-prettier --dev
```

- [ ] **Step 3: Wire Prettier into the generated ESLint flat config**

Edit the `eslint.config.js` that Step 1 generated to match this shape (keep whatever `expoConfig` import Step 1 produced; add the two new requires and the `ignores` entry):

```js
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    ignores: ["dist/*", "src/db/migrations/*"],
  },
]);
```

- [ ] **Step 4: Create the Prettier config**

Create `.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

Create `.prettierignore`:

```
node_modules
dist
src/db/migrations
```

- [ ] **Step 5: Add the `format` npm script**

Edit `package.json`'s `"scripts"` block to add (leave the `"lint"` script exactly as Step 1 generated it):

```json
"format": "prettier --write ."
```

- [ ] **Step 6: Verify lint runs clean**

```bash
npm run lint
```

Expected: exits 0. Prettier-formatting violations now surface as ESLint errors (via `eslint-plugin-prettier`) per the docs — if Step 1's own generated files (or Tasks 1-3's files) fail Prettier formatting, run `npm run format` once to auto-fix them, then re-run `npm run lint` to confirm exit 0.

- [ ] **Step 7: Commit**

```bash
git add eslint.config.js .prettierrc.json .prettierignore package.json package-lock.json
git commit -m "chore: configure ESLint and Prettier"
```

---

### Task 5: Wire Drizzle ORM + `expo-sqlite` (empty schema)

**Files:**
- Create: `src/db/schema/index.ts`, `src/db/client.ts`, `drizzle.config.ts`
- Modify: `package.json` (dependencies only, via install commands)

**Interfaces:**
- Consumes: the `src/db/schema` and `src/db/repositories` folders from Task 2.
- Produces: `db` (the Drizzle client instance) exported from `src/db/client.ts` — imported by every repository function starting in Phase 1 as `import { db } from "@/db/client"`. Also produces the `drizzle-kit generate` migration workflow used at the start of every phase that changes the schema.

- [ ] **Step 1: Install `expo-sqlite` and Drizzle**

```bash
npx expo install expo-sqlite
npm install drizzle-orm
npm install --save-dev drizzle-kit
```

- [ ] **Step 2: Create the (empty) schema entry point**

Create `src/db/schema/index.ts`:

```ts
// Drizzle table definitions are added one file per entity starting in Phase 1
// (see docs/06-data-model.md for the full entity list: Semester, Subject, Task,
// Subtask, Reminder, Attachment, Settings). This file re-exports every table
// so `drizzle-kit` and the client below see the full schema from one import.
export {};
```

- [ ] **Step 3: Create the Drizzle client**

Create `src/db/client.ts`:

```ts
import { openDatabaseSync } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";

import * as schema from "./schema";

const sqlite = openDatabaseSync("unitask.db");

export const db = drizzle(sqlite, { schema });
```

- [ ] **Step 4: Create the `drizzle-kit` config**

Create `drizzle.config.ts` at the project root:

```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  driver: "expo",
} satisfies Config;
```

- [ ] **Step 5: Generate the initial (empty) migration**

```bash
npx drizzle-kit generate
```

Expected: exits 0; creates `src/db/migrations/0000_*.sql` (empty or near-empty, since the schema has no tables yet) and `src/db/migrations/meta/`.

- [ ] **Step 6: Verify TypeScript still compiles with the new files**

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/index.ts src/db/client.ts drizzle.config.ts src/db/migrations/
git commit -m "chore: wire Drizzle ORM over expo-sqlite with empty schema"
```

---

### Task 6: Configure Jest + React Native Testing Library and run the real smoke test

**Files:**
- Modify: `package.json` (add `jest` config block and `test` script)
- Modify: `src/__tests__/path-alias.smoke.test.ts` (from Task 3 — now actually runs)
- Create: `jest.config.js`, `jest-setup.js`

**Interfaces:**
- Consumes: the alias-resolving test file from Task 3.
- Produces: `npm test`, the command every later phase's tasks use to run their own unit/component tests (per `docs/10-testing-strategy.md`'s TDD workflow).

- [ ] **Step 1: Install Jest and React Native Testing Library**

```bash
npx expo install jest-expo jest --dev
npm install --save-dev @testing-library/react-native @types/jest
```

- [ ] **Step 2: Create the Jest config**

Create `jest.config.js`:

```js
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEach: [],
  setupFiles: ["./jest-setup.js"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)",
  ],
};
```

Create `jest-setup.js`:

```js
// Global test setup — extended per phase as native modules need mocking
// (e.g. expo-notifications, expo-sqlite, expo-file-system in later phases).
```

- [ ] **Step 3: Add the `test` script**

Edit `package.json`'s `"scripts"` block:

```json
"test": "jest"
```

- [ ] **Step 4: Run the test suite**

```bash
npm test
```

Expected: 1 test suite (`src/__tests__/path-alias.smoke.test.ts`), 1 test passed ("resolves @/ to src/"), exits 0. This satisfies Phase 0's acceptance criterion ("`jest` runs with zero [feature] test files and exits cleanly" — this one smoke test is the explicitly-allowed exception, per `docs/11-roadmap.md` Phase 0's test expectations).

- [ ] **Step 5: Commit**

```bash
git add package.json jest.config.js jest-setup.js src/__tests__/path-alias.smoke.test.ts
git commit -m "chore: configure Jest and React Native Testing Library"
```

---

## Phase 0 — Definition of Done

All six tasks above complete, in order, means:

- `npx expo start` boots the app to a blank "UniTask" screen on an Android emulator/device (Task 1, manually verified).
- The full `src/` structure from `docs/07-architecture.md` exists (Task 2).
- `npx tsc --noEmit` passes with strict mode and the `@/` alias working (Task 3).
- `npm run lint` passes (Task 4).
- `npx drizzle-kit generate` works against an empty schema, and `src/db/client.ts` exports a usable Drizzle instance (Task 5).
- `npm test` passes with the one allowed smoke test (Task 6).

This unblocks Phase 1 (data layer — full Drizzle schema for all 7 entities and the pure business-logic functions in `src/domain`), which will be written as its own separate implementation plan once Phase 0 is executed and reviewed.
