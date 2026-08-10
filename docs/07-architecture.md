# 07 — Architecture

## Stack

| Concern | Choice |
|---|---|
| Framework | React Native + Expo (managed workflow, EAS-buildable) |
| Language | TypeScript |
| Navigation | Expo Router (file-based) |
| Persistence | `expo-sqlite`, accessed through **Drizzle ORM** (typed schema, not raw hand-written SQL) |
| Migrations | `drizzle-kit` |
| Reactive reads | Drizzle's `useLiveQuery` hook (`drizzle-orm/expo-sqlite`) |
| UI/session state | Zustand (UI state only — see architectural rule below) |
| Forms | React Hook Form |
| Validation | Zod, ideally derived from Drizzle table schemas via `drizzle-zod` |
| Notifications | `expo-notifications` (local-only, no push/remote) |
| Files | `expo-document-picker`, `expo-file-system`, `expo-sharing` |
| Testing | Jest, React Native Testing Library, Maestro (E2E, later phase) — see `10-testing-strategy.md` |

---

## Two prominent architectural rules

These are called out explicitly because they are easy to violate accidentally as the codebase grows.

### Rule 1 — Drizzle + `useLiveQuery` is the single source of truth for domain data

All domain data (semesters, subjects, tasks, subtasks, reminders, attachments, settings) lives in SQLite and is read by React components through Drizzle's `useLiveQuery`. Components **never** keep a separate copy of this data in Zustand, component state, or a cache layer. A write (insert/update/delete) goes through a repository function, which writes to SQLite; every component subscribed via `useLiveQuery` re-renders automatically. There is no manual "refetch" or "sync local state with DB" step to remember — and no possibility of showing a stale copy while the DB has already moved on.

### Rule 2 — Zustand holds UI/session state only, never domain data

Zustand stores are reserved for state that is inherently transient/UI-scoped and does not belong in SQLite: currently active filter chip, currently-selected semester id for quick access in a picker, modal open/closed flags, form-in-progress UI flags, etc. Zustand stores must **not** hold copies of tasks, subjects, semesters, or any other entity from the data model. This avoids a dual-source-of-truth bug class where the Zustand copy and the SQLite row disagree after a write from a different screen.

If a future need arises to cache a derived value for performance, it should be computed inside the query/selector layer (or memoized alongside the `useLiveQuery` result), not hand-copied into a Zustand store.

---

## Layering

```
UI layer            screens/components (app/ routes + src/components)
       │
Navigation layer     Expo Router routes (app/)
       │
State layer          Zustand stores — UI state only (src/stores)
       │
Business logic layer  Pure TypeScript functions (src/domain) — no React, no SQLite dependency:
                       - progress calculation
                       - status derivation (Pendiente/En progreso/Completada/Vencida)
                       - reminder scheduling math (offset → absolute fire time, reschedule rules)
                       - semester-close cascading rules
                       - subject-deletion blocking rule
       │
Persistence layer     Drizzle schema + repository-style query functions (src/db)
       │
Notifications layer   Thin wrapper around expo-notifications (src/lib/notifications)
       │
Files layer            Thin wrapper around expo-file-system/document-picker/sharing (src/lib/files)
       │
Validation layer       Zod schemas, ideally derived from Drizzle schemas via drizzle-zod (src/validation)
```

The business-logic layer is deliberately kept free of React and SQLite dependencies — it consists of plain, pure TypeScript functions that take primitive/plain-object inputs and return plain-object outputs. This is what makes the Strict TDD workflow practical (see `10-testing-strategy.md`): these functions are the cheapest and highest-value things to test, since they encode every rule in `03-business-rules.md` and need no test harness beyond a plain Jest test file.

---

## Proposed top-level folder structure

```
app/                          Expo Router routes (see 05-navigation.md for the full screen map)
├── (tabs)/
├── tarea/
├── materia/
├── semestres/
├── configuracion/
└── onboarding/

src/
├── db/                       Drizzle schema definitions + repository query functions
│   ├── schema/                one file per entity (semester.ts, subject.ts, task.ts, subtask.ts, reminder.ts, attachment.ts, settings.ts)
│   ├── repositories/           CRUD + query functions per entity, used by screens/hooks
│   └── migrations/             drizzle-kit generated migrations
│
├── domain/                   Pure business-logic functions (no React, no SQLite)
│   ├── task-status.ts          status derivation (03-business-rules.md §1, §3)
│   ├── task-progress.ts        progress calculation (§2)
│   ├── task-completion.ts      completion logic incl. completedLate (§4, §5)
│   ├── reminder-scheduling.ts  offset → absolute fire time, reschedule-on-edit rules (§7)
│   ├── semester-lifecycle.ts   one-active-semester + auto-close rule, read-only cascade (§10, §11)
│   └── subject-deletion.ts     blocking rule (§12)
│
├── features/                 Feature-oriented UI composition (screens' internals, grouped by area)
│   ├── dashboard/
│   ├── tasks/
│   ├── subjects/
│   ├── calendar/
│   ├── progress/
│   └── settings/
│
├── components/               Shared/reusable UI components (buttons, cards, ReminderPicker, etc.)
│
├── stores/                   Zustand stores — UI state only (Rule 2 above)
│   ├── filters-store.ts        active filter chip, selected semester for pickers
│   └── ui-store.ts             modal/sheet open flags, transient UI flags
│
├── lib/
│   ├── notifications/          thin wrapper around expo-notifications (schedule/cancel/reschedule)
│   └── files/                  thin wrapper around expo-file-system/document-picker/sharing
│
├── validation/                Zod schemas (ideally generated via drizzle-zod from src/db/schema)
│
└── theme/                     Design tokens (colors, spacing, typography) — semantic variables, never hardcoded hex in components
```

This mirrors the layering diagram above 1:1, so any developer can find "where does rule X live" by matching the rule's category to a `src/domain` file, and "where does screen Y live" by matching it to `app/` + the corresponding `src/features` folder.

---

## Growth path (no rewrite required)

The architecture intentionally keeps two seams open for future work called out in `01-product.md` as out-of-scope-for-v1 but not precluded:

- **Accounts + cloud sync**: the persistence layer is already isolated behind repository functions in `src/db/repositories`; introducing a remote sync engine later means adding a sync layer that reads/writes through the same repositories (or a parallel remote-aware implementation) without touching UI or business-logic code. UUID primary keys (see `06-data-model.md`) avoid renumbering collisions when reconciling with a server.
- **Dark mode**: because all UI colors are drawn from `src/theme` semantic tokens rather than hardcoded per-component hex values, adding a dark palette is a token-file addition plus a theme-context toggle — not a component-by-component rewrite.
