# 01 — Product Overview

## What is UniTask

UniTask is a mobile application for university students to organize their academic life: subjects, tasks, subtasks, reminders, and the files attached to their coursework. It is built with React Native and Expo, targeting Android phones for its MVP.

## The core question

UniTask exists to answer one question every student asks daily:

> **"What do I have to do, and what should I tackle first?"**

Every product decision below is filtered through that question: task prioritization, due dates, urgency signals on the dashboard, and status derivation all exist to make the answer obvious at a glance.

## Target user

A university student juggling multiple subjects per semester, each with its own assignments, deadlines, and files (readings, rubrics, submitted work). The user needs a lightweight, offline-capable tool — not a full LMS, not a generic to-do app that ignores the "subject" and "semester" structure of academic life.

## Product principles

- **Offline-first**: the app must be fully usable with no network connection. All data lives locally on the device.
- **No backend in v1**: there is no account system, no cloud storage, and no multi-device sync in the MVP. This is a deliberate scope cut, not an oversight — see "Out of scope for v1" below.
- **Architected for growth**: although v1 has no backend, the architecture (see `07-architecture.md`) must not preclude adding an account system, cloud sync, or multi-device support later without a full rewrite. Concretely, this means the persistence layer is abstracted behind repository-style functions and the data model uses stable local identifiers that could later be reconciled with remote ones.

## MVP scope

UniTask v1 includes:

- **Semester management**: create, view, and close academic semesters (see deliberate scope decision below).
- **Subject management**: create, edit, delete, and browse subjects within the active or a past semester.
- **Task management**: full CRUD for tasks, with priority, due date/time, subtasks, reminders, and attachments.
- **Subtasks**: ordered checklists inside a task, driving automatic progress calculation.
- **Reminders**: per-task local notifications, configurable at creation and afterward.
- **Attachments**: files copied into app-private storage and opened via Android's native "open with" flow.
- **Dashboard**: at-a-glance summary of pending work, today's load, recent completions, urgent tasks, and upcoming deadlines.
- **Calendar (month view)**: a monthly grid with per-day task indicators and an inline day panel.
- **Progress screen**: statistics derived from task/subtask completion.
- **Settings**: minimal — data export/import (JSON backup) as the primary function.
- **Manual JSON backup**: export and import of all local data, since there is no cloud safety net in v1.

## Out of scope for v1

The following were explicitly evaluated and deferred, not forgotten:

- **iOS**: MVP targets Android phones only. The codebase stays cross-platform-capable in principle (RN/Expo), but no iOS-specific testing, polish, or notification-limit handling is done in the MVP.
- **Dark mode UI**: the theming layer uses semantic design tokens (so dark mode is cheap to add later), but no dark theme is designed, tested, or exposed in Settings for v1.
- **Cloud accounts / authentication / multi-device sync**: no login, no remote backend, no real-time sync. The architecture must not preclude adding these later.
- **Calendar week/day views**: MVP ships month view only; the view-toggle seen in early mockups is a fast-follow candidate (see `11-roadmap.md`).
- **In-app file viewer**: attachments are opened via Android's native "open with" intent using apps already installed on the device; no custom PDF/DOCX/image viewer is built.
- **Tutorial/marketing onboarding**: no onboarding carousel or feature tour. The only first-run requirement is the mandatory creation of the user's first semester (a data bootstrap step, not a tutorial — see `04-user-flows.md`).
- **Notification digest / global notification toggle**: no daily "overdue tasks" digest and no master on/off switch for notifications in Settings. Reminder management is entirely per-task.
- **Merge import**: importing a JSON backup replaces all local data; there is no field-level or record-level merge logic in v1.
- **Login / auth screens**: not designed in this discovery phase. The architecture should not preclude adding them later.
- **In-app notification center / inbox**: notifications are fire-and-forget OS-level notifications; there is no in-app feed of past notifications.
- **Tablet layouts**: MVP targets the phone form factor only.

## Deliberate scope decision: Semester as a real entity

During architecture discovery, the initial recommendation was to **skip** Semester as a modeled entity and keep Subject as the top-level grouping, to reduce scope. The product owner overrode this recommendation: Semester is a first-class, user-managed entity in v1.

Rationale (product owner decision, documented here for traceability): academic terms are how students actually think about their workload, tasks and subjects are naturally scoped to a semester, and closing a past semester gives the student a clean, read-only historical record instead of an ever-growing flat list of subjects and tasks. This is treated as a deliberate scope **expansion**, not an oversight, and every downstream document (functional requirements, business rules, data model, navigation) reflects Semester as a real entity with its own lifecycle.
