# 05 — Navigation

Built with **Expo Router** (file-based navigation). This document defines the full screen map, the tab structure, and which screens are modal vs. stack-push vs. tab, including screens the original mockups implied but did not actually design (called out explicitly below).

---

## Bottom tab bar (5 tabs)

Five direct tabs — chosen over a "Más" hub-menu pattern and over a 4-tab-plus-center-FAB pattern, based on comparison to standard task-app patterns (Todoist, TickTick, Google Tasks):

| Tab | Screen | Purpose |
|---|---|---|
| Home | Dashboard | At-a-glance summary: stats, urgent tasks, upcoming deadlines |
| Tareas | Task list | Full task list with filter chips (Todas/Pendientes/En progreso/Completadas/Vencidas) |
| Calendario | Calendar (month view) | Monthly grid with per-day task indicators and inline day panel |
| Materias | Subject list | Browse/manage subjects |
| Progreso | Progress | Statistics derived from task/subtask completion |

**Settings does not get a tab.** It is reached via a gear icon in the header, following the standard pattern that infrequently-visited settings shouldn't cost a permanent tab slot.

**No bell/notification-center icon** in headers — dropped entirely (not even decorative) since UniTask has no in-app notification feed; all reminders are fire-and-forget OS notifications (see `08-notifications.md`).

---

## Floating Action Button (FAB)

A contextual "+" FAB appears on Home, Tareas, Calendario, and Materias:

| Screen | FAB creates | Notes |
|---|---|---|
| Home | New task | Opens Nueva Tarea modal |
| Tareas | New task | Opens Nueva Tarea modal |
| Calendario | New task | Opens Nueva Tarea modal; pre-fills due date with the currently selected day, if any |
| Materias | New subject | Opens Nueva Materia modal |
| Progreso | *(no FAB)* | Read-only screen, nothing to create |

---

## Full screen map

```
app/
├── (tabs)/                          [tab navigator]
│   ├── index.tsx                    Home / Dashboard          [tab]
│   ├── tareas/
│   │   └── index.tsx                Task list                 [tab]
│   ├── calendario/
│   │   └── index.tsx                Calendar (month view)      [tab]
│   ├── materias/
│   │   └── index.tsx                Subject list               [tab]
│   └── progreso/
│       └── index.tsx                Progress                   [tab]
├── tarea/
│   ├── nueva.tsx                    Nueva Tarea                [modal]
│   ├── [id]/
│   │   ├── index.tsx                Detalle de Tarea           [stack push]
│   │   └── editar.tsx               Editar Tarea (same form as Nueva Tarea, edit mode) [modal]
├── materia/
│   ├── nueva.tsx                    Nueva Materia               [modal]
│   └── [id]/
│       ├── index.tsx                Detalle de Materia (NEW)    [stack push]
│       └── editar.tsx               Editar Materia (NEW, reuses Nueva Materia form) [modal]
├── semestres/
│   └── index.tsx                    Semester switcher / history (NEW) [stack push]
├── configuracion/
│   └── index.tsx                    Settings (NEW target for gear icon) [stack push]
└── onboarding/
    └── primer-semestre.tsx          First-run "create your first semester" (NEW) [full-screen, pre-tab-navigator]
```

Reminder picker is **not** a separate route — it is a shared component (`components/ReminderPicker`) used inline inside both Nueva/Editar Tarea and Detalle de Tarea.

---

## Screens newly identified in this discovery phase

The mockups implied these but never actually designed them; they are now specified as part of this discovery so implementation has a clear target:

| Screen | Purpose |
|---|---|
| **Detalle de Materia** (Subject detail) | Tap a subject card → see its task list, edit professor/code/color, trigger delete (with the blocking rule from `03-business-rules.md` §12). |
| **Nueva/Editar Materia** | Form to create or edit a subject (name, course code, professor, color swatch picker). |
| **Reminder picker** (component, not a screen) | Shared UI for adding/editing a reminder — choose relative offset or custom fixed datetime. Used inside Nueva/Editar Tarea and Detalle de Tarea. |
| **First-run "create your first semester"** | The mandatory data-bootstrap prompt shown when zero semesters exist (see `04-user-flows.md` flow 1). |
| **Settings** | Reached via the header gear icon. Minimal in v1: "Exportar datos" and "Importar datos" actions. No theme section, no notification section (see `01-product.md`, `03-business-rules.md`). |
| **Semester switcher / history** | View all semesters (active + closed), see a closed semester's read-only content, and trigger "Cerrar semestre" on the active one. |

Delete-confirmation dialogs (task, subject, semester close, import-overwrite) are **not** separate screens — they are modal dialog components triggered inline wherever the destructive action is initiated (see `03-business-rules.md` §13).

**Login/auth screens are explicitly not designed** in this discovery phase — v1 has no accounts. The architecture should not preclude adding them later (see `01-product.md`, `07-architecture.md`).

---

## Modal vs. stack-push vs. tab

| Screen | Presentation | Rationale |
|---|---|---|
| Home / Tareas / Calendario / Materias / Progreso | Tab | Primary navigation destinations |
| Nueva Tarea / Editar Tarea | Modal (slide-up, close "X") | Focused creation/edit task, not a navigation destination |
| Nueva Materia / Editar Materia | Modal (slide-up, close "X") | Same rationale as tasks |
| Detalle de Tarea | Stack push (back arrow) | Browsable content, not a form |
| Detalle de Materia | Stack push (back arrow) | Browsable content, not a form |
| Settings | Stack push (back arrow) | **Decision**: stack push chosen over modal — simpler and more standard for a settings screen the user backs out of via the system/back-arrow gesture rather than an explicit "done" action. |
| Semester switcher/history | Stack push (back arrow) | Browsable content |
| First-run semester prompt | Full-screen, outside the tab navigator | Shown only when no semester exists; not reachable via normal navigation once satisfied |

---

## Editing a task (architectural note)

Editing a task reuses the **same** Nueva Tarea form component in an "edit mode": identical fields, pre-filled from the existing task, header text changes to "Editar Tarea," and the route carries a `taskId` param (`app/tarea/[id]/editar.tsx`) that the form uses to load initial values and switch its submit handler from create to update. No separate screen/file duplication is needed.

The same pattern applies to Materia: `app/materia/[id]/editar.tsx` reuses the Nueva Materia form component.
