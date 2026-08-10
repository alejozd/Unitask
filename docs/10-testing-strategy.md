# 10 — Testing Strategy

The user's global tooling convention has **Strict TDD Mode enabled**. Every implementation phase in `11-roadmap.md` follows a test-first workflow: write a failing test → implement the minimum to pass it → refactor. No phase is considered "done" until its tests are written and passing — testing is not an afterthought bolted on at the end of a phase.

## Tools

| Layer | Tool |
|---|---|
| Pure business-logic functions | Jest |
| Components | Jest + React Native Testing Library |
| Drizzle queries / persistence | Jest against an in-memory/test SQLite instance (integration-style) |
| Critical end-to-end flows | Maestro |

## Coverage strategy by layer

### Pure business-logic functions (`src/domain`) — heaviest coverage

These are the highest-value, cheapest-to-test files in the codebase, since they are plain TypeScript with no React or SQLite dependency (`07-architecture.md`). Every rule in `03-business-rules.md` should have a corresponding unit test suite here, including edge cases:

- `task-status.ts`: all four status branches, including the "Vencida takes priority over En progreso for an incomplete overdue task" ordering rule, and the boundary condition at exactly `dueDateTime == now`.
- `task-progress.ts`: zero-subtask binary behavior (0%/100%), partial completion ratios, rounding behavior.
- `task-completion.ts`: `completedLate` computed correctly on-time vs. late, auto-check-all-subtasks behavior, that `completedLate` is never recalculated after being set once.
- `reminder-scheduling.ts`: relative-offset → absolute fire time math; the due-date-edit reschedule rule for both relative and fixed reminders, including the "recomputed fire time now in the past → auto-remove" and "fixed datetime now at/after new due date → auto-remove" branches.
- `semester-lifecycle.ts`: auto-close-previous-on-create-new, exactly-one-active invariant, read-only cascade evaluation for a subject/task under a closed semester.
- `subject-deletion.ts`: blocked-by-pending/in-progress-tasks branch (with correct count), allowed-with-cascade-delete-of-completed-tasks branch.

Because these functions are pure, tests should be written **before** the function exists, per Strict TDD — the test file encodes the rule from `03-business-rules.md` directly, then the implementation is written to satisfy it.

### Components (`src/features`, `src/components`)

React Native Testing Library covers: rendering of derived status badges/filter chips against various task states, form validation behavior (React Hook Form + Zod — e.g. required fields, file-size/type rejection messaging), the Reminder picker component's relative-vs-fixed toggle, and read-only rendering (disabled create/edit/delete affordances) for entities under a closed semester.

### Drizzle queries / repositories (`src/db`)

Lighter integration tests run against an in-memory or ephemeral test SQLite database (not the pure-function unit-test depth, but enough to catch schema/query mistakes): repository CRUD functions per entity, cascade-delete behavior (task delete → subtasks/reminders/attachments removed; subject delete → only-completed-tasks cascade per §12), and that `useLiveQuery`-driven reads reflect writes made through the same repository layer.

### End-to-end (Maestro)

A small, curated set of critical flows — recommended as a **later-phase addition**, not a Phase 1 blocker:

- Create a task (with a reminder and an attachment) end-to-end.
- Complete a task via both entry points (list checkbox and detail-screen button).
- Close a semester and verify its subjects/tasks become read-only.

Maestro coverage should be introduced once the corresponding screens exist and stabilize (roughly around Phase 6–9 in `11-roadmap.md`), rather than attempting E2E scaffolding before there's a UI to drive.

## Per-phase expectation

Every phase entry in `11-roadmap.md` lists explicit test expectations (which layer, roughly what's covered) alongside its acceptance criteria — the roadmap and this document are meant to be read together, not duplicated. The general shape for every phase that introduces new business logic is:

1. Write failing unit test(s) for the new pure function(s) or repository function(s), asserting the exact rule from `03-business-rules.md`/`06-data-model.md`.
2. Implement the minimum code to make the test(s) pass.
3. Refactor with tests green.
4. Add/extend component tests for any new UI surface introduced in the same phase.
5. Only after 1–4 are green does the phase's acceptance criteria get evaluated as met.
