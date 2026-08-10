# UniTask

UniTask is a mobile app for university students to organize their academic life — subjects, tasks, subtasks, reminders, and attachments — around one core question: **"What do I have to do, and what should I tackle first?"**

It is offline-first, with no backend/account/cloud sync in v1, and targets Android phones for its MVP.

## Objective

Give students a lightweight, structured alternative to generic to-do apps — one that understands the academic-semester → subject → task hierarchy, automatically derives task status/urgency instead of relying on manual bookkeeping, and keeps working fully offline.

## Tech stack

- **React Native + Expo** (managed workflow, EAS-buildable)
- **TypeScript**
- **Expo Router** (file-based navigation)
- **Drizzle ORM** over `expo-sqlite`, with `drizzle-kit` migrations and `useLiveQuery` for reactive reads
- **Zustand** for UI/session state only (never domain data — see architecture doc)
- **React Hook Form + Zod** (validation schemas ideally derived from Drizzle schemas via `drizzle-zod`)
- **expo-notifications** for local-only reminders
- **expo-document-picker / expo-file-system / expo-sharing** for attachments and JSON backup export/import
- **Jest + React Native Testing Library** for unit/component tests, **Maestro** for a handful of critical E2E flows

## Architecture summary

UniTask is layered as UI (screens/components) → navigation (Expo Router routes) → state (Zustand, UI-only) → business logic (pure TypeScript functions for status derivation, progress calculation, reminder scheduling math, semester-close cascades) → persistence (Drizzle schema + repository functions) → notifications/files (thin wrapper modules) → validation (Zod). Two rules are load-bearing and easy to violate by accident: **Drizzle + `useLiveQuery` is the single source of truth for domain data**, and **Zustand never holds a copy of domain data**. Full detail, including the proposed folder structure and the future growth path (accounts/sync, dark mode) without a rewrite: see [`docs/07-architecture.md`](docs/07-architecture.md).

## How to run

**Not yet applicable.** This repository currently contains only discovery-phase documentation (`docs/`) — the Expo project has not been scaffolded yet (no `npx create-expo-app` run, no dependencies installed, no application code written). Project scaffolding is planned as Phase 0 of [`docs/11-roadmap.md`](docs/11-roadmap.md). Once scaffolding lands, this section will be updated with real install/run instructions.

## Intended project structure

Once scaffolded, the codebase is planned to follow this structure (see [`docs/07-architecture.md`](docs/07-architecture.md) for the full rationale):

```
app/                  Expo Router routes (tabs, task/subject modals & stacks, settings, onboarding)
src/
├── db/               Drizzle schema + repository query functions
├── domain/           Pure business-logic functions (status, progress, reminders, semester rules)
├── features/         Feature-oriented UI composition (dashboard, tasks, subjects, calendar, progress, settings)
├── components/        Shared/reusable UI components
├── stores/            Zustand stores — UI state only
├── lib/
│   ├── notifications/  expo-notifications wrapper
│   └── files/           expo-file-system/document-picker/sharing wrapper
├── validation/         Zod schemas
└── theme/               Design tokens (colors, spacing, typography)
```

## Documentation

This repository's `docs/` folder contains the full discovery-phase documentation for UniTask:

1. [`docs/01-product.md`](docs/01-product.md) — product overview, MVP scope, out-of-scope-for-v1, and the deliberate Semester-as-entity scope decision
2. [`docs/02-functional-requirements.md`](docs/02-functional-requirements.md) — CRUD operations and constraints per entity/feature area
3. [`docs/03-business-rules.md`](docs/03-business-rules.md) — the single source of truth for every automatic/derived behavior in the app
4. [`docs/04-user-flows.md`](docs/04-user-flows.md) — step-by-step flows for the key user journeys
5. [`docs/05-navigation.md`](docs/05-navigation.md) — full screen map, tab structure, modal/stack/tab classification
6. [`docs/06-data-model.md`](docs/06-data-model.md) — entities, fields, types, relationships, and derived (not stored) fields
7. [`docs/07-architecture.md`](docs/07-architecture.md) — stack, layering, folder structure, and the two prominent architectural rules
8. [`docs/08-notifications.md`](docs/08-notifications.md) — reminder-to-notification mapping, Android permission handling, scheduling triggers
9. [`docs/09-file-management.md`](docs/09-file-management.md) — attach/view/cleanup flow and JSON export/import mechanics
10. [`docs/10-testing-strategy.md`](docs/10-testing-strategy.md) — the Strict TDD-first testing approach and coverage strategy per layer
11. [`docs/11-roadmap.md`](docs/11-roadmap.md) — phased implementation plan (Phase 0–10) plus fast-follow candidates

Each document is internally consistent with the others — the same rule is never restated with contradictory wording across files. `03-business-rules.md` is the canonical source whenever a rule is referenced elsewhere.
