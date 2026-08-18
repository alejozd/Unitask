# Phase 10 — Empty states, confirmations, accessibility, theming cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan has NOT been approved for execution.** Written per an explicit "present the plan, do not run it" instruction (2026-08-17).

**Goal:** Close out `11-roadmap.md`'s Phase 10 (the last MVP phase) — empty states, `03-business-rules.md` §13 confirmation dialogs, an accessibility pass, and the theming cleanup backlogged since Phase 6.5. This plan is grounded in a real pre-planning audit of the current codebase (below), not a from-scratch reading of the roadmap's feature list — most of Phase 10's stated scope turns out to already be done by prior phases. This plan targets only the verified real gaps.

**Architecture:** No new domain/repository code. One missing UI confirmation dialog (mirrors the existing task/subject delete pattern exactly), one cross-cutting mechanical token migration (behavior-preserving), one cheap defensive empty state, and a verification/audit task. Nothing here touches `src/domain` or `src/db`.

**Tech Stack:** No new dependencies. Pure React Native `StyleSheet`/`Alert`/`@/theme` — patterns already established in every prior phase.

## Pre-planning audit (this plan's own investigation, 2026-08-17)

- **§13 confirmation dialogs — 4 of 5 already done.** Delete task (`app/tarea/[id]/index.tsx`), delete subject (`app/materia/[id]/index.tsx`), close semester (`app/semestres/index.tsx`, Phase 2), import data (`app/configuracion/index.tsx`, Phase 9) all already show a `Cancelar`/destructive `Alert.alert` before executing — grep-verified against the live code, not assumed from memory. **1 real gap: delete subtask.** `app/tarea/[id]/index.tsx`'s `handleRemoveSubtask` (the "Quitar" button on a *persisted* subtask) calls `deleteSubtask` directly, zero confirmation. (`app/tarea/nueva.tsx`'s `handleRemoveSubtaskDraft` removes an unsaved draft subtask before the task is ever created — not data loss in §13's sense, correctly has none.)
- **Empty states — broad coverage already exists.** Dashboard, Progreso, Calendario (day panel), Tareas, Materias, and both create forms (Nueva Tarea/Materia) all have an existing empty-state message (grep-confirmed via `emptyText`/"No hay"/"Aún no" across 7 files). `app/semestres/index.tsx` has none, but a truly empty semester list is only reachable in an unreachable state today (onboarding forces one to exist before any screen renders) — low-value, addressed as one cheap defensive addition, not a real user-facing gap.
- **Theming — hardcoded hex audit, 25 occurrences found** (grep-confirmed, `grep -rn '#[0-9A-Fa-f]\{6\}' app src/components --include="*.tsx" | grep -v src/theme`; grew slightly past the ~18 the Phase 6.5 backlog note estimated, as Phases 7-9 added a few more of the same pattern). Two distinct categories:
  - **(a) 21 occurrences of `"#FFFFFF"`** for text/icon-on-solid-color (button text, FAB glyphs, selected-day text, subject chips) — the already-disclosed, accepted pattern this phase exists to finally tokenize.
  - **(b) 4 occurrences that are NOT that pattern** — `app/onboarding/primer-semestre.tsx` (`"#64748B"`, `"#E2E8F0"`, `"#6366F1"`) and `app/_layout.tsx` (`"#64748B"`) are exact duplicates of existing tokens (`colors.textMuted`, `colors.border`, `colors.primary`) that were never swapped, likely predating `src/theme`'s introduction. Pure mechanical find-and-replace, no new token needed.
- **Icon-only touch targets — audited, effectively closed already.** `Ionicons` appears in exactly 3 files; only the Dashboard's gear icon was ever a bare-icon `TouchableOpacity`, and it already got a `hitSlop` fix this session (commit `4d4b456`) after being found on-device. No other icon-only touchable exists anywhere else in the app — every other tappable surface uses a text label or the FAB's "+" glyph (already has an explicit `lineHeight` fix). Nothing left to do here structurally; only a human on-device spot-check remains (Task 4).
- **Priority dot+text (§18)** — already enforced everywhere per every prior phase's explicit sign-off. No violations found.

## Global Constraints

- **No new dependencies, no domain/repository changes.** This phase is UI-only.
- **Task 1's confirmation dialog copies the exact established pattern** (`Alert.alert(title, message, [{text:"Cancelar", style:"cancel"}, {text:"Eliminar", style:"destructive", onPress}])`) from `handleRemoveAttachment`'s sibling handlers in the same file — do not invent a new dialog shape.
- **Task 2's new `colors.onColor` token is deliberately a separate token from `colors.surface`**, even though both currently equal `"#FFFFFF"`. `surface` means "a card/background surface color"; `onColor` means "text/icon color that sits on top of a saturated background (primary button, FAB, selected state)". These must stay independently overridable — a future dark theme could plausibly keep `onColor` at white (text on a still-saturated primary button) while changing `surface` to a dark value; conflating them would make that impossible without a breaking rename later.
- **Migrate all 25 occurrences in one task, not piecemeal** — per the Phase 6.5/Phase 10 roadmap note's own explicit instruction ("Add a colors.onColor/onPrimary token and migrate all sites at once here, rather than piecemeal").
- **Zero visual/behavior change.** Every edit in Task 2 is `"#FFFFFF"` → `colors.onColor` (same literal value) or a category-(b) literal → its exact existing-token equivalent (also the same literal value) — pixel-identical output, verified by the token values matching exactly (`colors.onColor = "#FFFFFF"`, `colors.textMuted = "#64748B"`, `colors.border = "#E2E8F0"`, `colors.primary = "#6366F1"`).
- **No new component tests** — matches the established non-pilot-phase convention. Task 1's confirm-dialog wiring is UI-only (mirrors an already-untested sibling handler in the same file); Task 2 is a mechanical literal swap with no branchable logic; Task 3 is a static JSX addition.
- **Accessibility font-scaling (200%) and screen-reader spot checks are human-only, on-device** (Task 4) — matches every prior phase's established verification split; no agent drives an emulator/accessibility inspector.

---

### Task 1: Add confirmation dialog for subtask deletion

**Files:**
- Modify: `app/tarea/[id]/index.tsx` — `handleRemoveSubtask`.

**Given code:**

```tsx
// Before:
async function handleRemoveSubtask(subtaskId: string) {
  setBusy(true);
  try {
    await deleteSubtask(subtaskId);
  } catch (error) {
    handleActionError(error, "No se pudo eliminar la subtarea.");
  } finally {
    setBusy(false);
  }
}

// After — wraps the existing body in the same confirm-dialog shape
// handleDeleteTask already uses in this exact file:
function handleRemoveSubtask(subtaskId: string) {
  Alert.alert("Eliminar subtarea", "Esta acción eliminará la subtarea.", [
    { text: "Cancelar", style: "cancel" },
    {
      text: "Eliminar",
      style: "destructive",
      onPress: async () => {
        setBusy(true);
        try {
          await deleteSubtask(subtaskId);
        } catch (error) {
          handleActionError(error, "No se pudo eliminar la subtarea.");
        } finally {
          setBusy(false);
        }
      },
    },
  ]);
}
```

Note the function is no longer `async` itself (the confirm dialog is synchronous; the async work moves into the `onPress` callback) — matches `handleDeleteTask`'s exact shape in the same file, do not deviate.

- [ ] **Step 1: Apply the given code above.**
- [ ] **Step 2: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check "app/tarea/[id]/index.tsx"
npm test
```

Expected: 209/209 unchanged (no new test — UI-only, mirrors an already-untested sibling pattern in the same file).

- [ ] **Step 3: Commit**

```bash
git add "app/tarea/[id]/index.tsx"
git commit -m "fix(tareas): require confirmation before deleting a subtask (03-business-rules.md §13)"
```

---

### Task 2: Theming cleanup — `colors.onColor` token + migrate all 25 hardcoded hex sites

**Files:**
- Modify: `src/theme/index.ts` — add `onColor`.
- Modify (category a, `"#FFFFFF"` → `colors.onColor`, 21 sites across): `app/(tabs)/calendario/index.tsx`, `app/(tabs)/index.tsx` (×3), `app/(tabs)/materias/index.tsx`, `app/(tabs)/tareas/index.tsx` (×2), `app/configuracion/index.tsx`, `app/materia/[id]/index.tsx`, `app/onboarding/primer-semestre.tsx` (×2), `app/semestres/index.tsx`, `app/tarea/nueva.tsx`, `app/tarea/[id]/index.tsx` (×2), `src/components/CalendarAddTaskFab.tsx`, `src/components/SubjectForm.tsx` (×2), `src/components/TaskForm.tsx` (×3).
- Modify (category b, exact-duplicate literal → existing token, 4 sites): `app/onboarding/primer-semestre.tsx` (`"#64748B"`→`colors.textMuted`, `"#E2E8F0"`→`colors.border`, `"#6366F1"`→`colors.primary`), `app/_layout.tsx` (`"#64748B"`→`colors.textMuted`).

**Given code:**

```typescript
// src/theme/index.ts — add alongside the existing colors:
export const colors = {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#0F172A",
  textMuted: "#64748B",
  border: "#E2E8F0",
  primary: "#6366F1",
  primaryTint: "rgba(99, 102, 241, 0.12)",
  danger: "#EF4444",
  dangerTint: "rgba(239, 68, 68, 0.12)",
  // Text/icon color for content that sits ON a saturated background
  // (primary buttons, FABs, selected states) — deliberately kept distinct
  // from `surface` even though both are currently "#FFFFFF" (Global
  // Constraints: a future dark theme could change `surface` without
  // needing on-primary text to follow).
  onColor: "#FFFFFF",
} as const;
```

Every other change is a literal find-and-replace within each file's existing `StyleSheet.create({...})` block or inline `color="#FFFFFF"` prop — e.g. `app/tarea/[id]/index.tsx`:

```diff
- completeButtonText: { color: "#FFFFFF", fontWeight: "600" },
+ completeButtonText: { color: colors.onColor, fontWeight: "600" },
```

`app/_layout.tsx` (category b — this file currently has NO `@/theme` import at all, since it's the root layout's own error-state UI, predating the theme file):

```diff
+ import { colors } from "@/theme";
  ...
  errorDetail: {
    fontSize: 13,
-   color: "#64748B",
+   color: colors.textMuted,
    textAlign: "center",
  },
```

Every file already importing `colors` from `@/theme` needs no new import — only `app/_layout.tsx` does.

- [ ] **Step 1: Add `onColor` to `src/theme/index.ts`.**
- [ ] **Step 2: Migrate all 21 category-(a) `"#FFFFFF"` sites to `colors.onColor`**, file by file from the list above. Grep to confirm zero remain: `grep -rn '"#FFFFFF"' app src/components --include="*.tsx"` should return nothing.
- [ ] **Step 3: Migrate all 4 category-(b) sites** to their exact existing-token equivalent, adding the `@/theme` import to `app/_layout.tsx`.
- [ ] **Step 4: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check .
npm test
```

Expected: 209/209 unchanged (pure literal substitution, zero logic branches touched, zero visual difference — same hex values).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(theme): add colors.onColor token, migrate all 25 hardcoded hex sites"
```

---

### Task 3: Defensive empty state for the Semestres list

**Files:**
- Modify: `app/semestres/index.tsx`.

**Rationale:** low-priority (the audit above found this state is not reachable via normal use — onboarding forces a semester to exist before any screen renders), but cheap and closes the roadmap's literal "no screen shows a broken/blank state with zero data" acceptance criterion with zero risk.

**Given code:** read the current `app/semestres/index.tsx` list-rendering section first (this plan does not have it memorized verbatim — unlike Tasks 1-2, there is no guaranteed-correct snippet here); add a conditional empty-state `<Text>` matching the established pattern from any of the 7 files already grep-confirmed to have one (e.g. `app/(tabs)/materias/index.tsx`'s `emptyText` style/copy shape) when the semesters list is loaded and empty.

- [ ] **Step 1: Read `app/semestres/index.tsx`'s current list-rendering branch.**
- [ ] **Step 2: Add the empty-state branch**, matching an existing sibling screen's copy/style conventions (Spanish, `colors.textMuted`, matches this file's own existing `styles` naming pattern).
- [ ] **Step 3: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check "app/semestres/index.tsx"
npm test
```

Expected: 209/209 unchanged.

- [ ] **Step 4: Commit**

```bash
git add "app/semestres/index.tsx"
git commit -m "feat(semestres): add defensive empty state for zero semesters"
```

---

### Task 4: Full Phase 10 Definition of Done verification

**Files:** none (verification-only task).

**Verification split (matching every prior phase's precedent):** the implementer runs the automated combined check only and produces an on-device/manual checklist for the human — font scaling and screen-reader behavior are not things an agent can meaningfully verify without a real device.

- [ ] **Step 1: Run the full combined check**

```bash
npx tsc --noEmit
npm run lint
npx prettier --check .
npm test
```

Expected: all green, no regressions in any suite from Phases 0-9.

- [ ] **Step 2: Grep-audit for regressions**

```bash
grep -rn '"#FFFFFF"' app src/components --include="*.tsx"   # expect zero matches
grep -rn '#64748B\|#E2E8F0\|#6366F1' app --include="*.tsx"  # expect zero matches outside src/theme
```

- [ ] **Step 3: Write the on-device/accessibility checklist for the human**

Write `.superpowers/sdd/phase10-device-checklist.md`:

1. Subtask "Quitar" on Task detail now shows a confirmation dialog; Cancelar leaves the subtask; Eliminar removes it (same as task/subject delete already do).
2. Spot-check a handful of the migrated `#FFFFFF`→`colors.onColor` sites visually (a primary button's text, a FAB's "+", the calendar's selected-day number, a subject chip) — confirm zero visual difference from before.
3. Semestres screen (if reachable — creating and closing semesters to empty the list is a destructive test, use a disposable test semester, not real data): confirm the new empty state renders sensibly instead of a blank screen.
4. **Font scaling**: set the device's system font size to the largest/200% setting, relaunch the app, spot-check 3-4 screens (Dashboard, Tareas, Task detail, Configuración) for any text that overlaps, gets cut off, or breaks layout.
5. **Screen-reader spot check**: enable TalkBack (or equivalent), navigate the Dashboard and Task detail — confirm the gear icon, priority dot+text, and the 3 destructive-action buttons (task/subject/subtask delete) all announce something sensible, not silence or a raw icon-only label.
6. Confirm the Dashboard gear icon's `hitSlop` fix (from the previous fix commit) still works — tap it a few times near the icon's edges, not just dead-center.

- [ ] **Step 4: Write the Phase 10 implementation report**

Write `.superpowers/sdd/task-4-report.md` (check first whether a stale report from an earlier phase's differently-numbered final task exists at this colliding path — this project has hit that collision every phase so far — overwrite if so).

- [ ] **Step 5: No commit expected for the checklist/report themselves**

Only commit if Step 1-2 surfaced and required a real fix.

---

### After Task 4: whole-branch review

Matches this project's established "UI phases done inline, whole-branch review only at the end" working mode — dispatch one whole-branch review across `origin/master..HEAD` after Task 4, before pushing, same as Phases 6-9. This is also the **last MVP phase (0-10)** per `11-roadmap.md` — the review should explicitly note this and flag anything that looks like it should block calling the MVP done, not just this phase's own diff.
