import { render, screen } from "@testing-library/react-native";

import { CalendarDayPanel } from "../CalendarDayPanel";

describe("CalendarDayPanel", () => {
  it("renders each task's title, subject name, and priority as a dot plus text label (03-business-rules.md §18: never color alone)", () => {
    render(
      <CalendarDayPanel
        date={new Date(2026, 7, 20)}
        entries={[
          {
            taskId: "t1",
            title: "Entregar ensayo",
            subjectName: "Historia",
            subjectColor: "indigo",
            priority: "Alta",
            status: "Pendiente",
          },
        ]}
        onTaskPress={jest.fn()}
      />,
    );

    expect(screen.getByText("Entregar ensayo")).toBeTruthy();
    expect(screen.getByText("Historia")).toBeTruthy();
    expect(screen.getByText("Alta")).toBeTruthy();
  });

  it("shows a 'N Pendientes' badge counting only entries with status Pendiente (visual cue borrowed from calendario_unitask.png, guía-not-spec)", () => {
    render(
      <CalendarDayPanel
        date={new Date(2026, 7, 20)}
        entries={[
          {
            taskId: "t1",
            title: "Tarea pendiente",
            subjectName: "Historia",
            subjectColor: "indigo",
            priority: "Alta",
            status: "Pendiente",
          },
          {
            taskId: "t2",
            title: "Tarea completada",
            subjectName: "Historia",
            subjectColor: "indigo",
            priority: "Media",
            status: "Completada",
          },
        ]}
        onTaskPress={jest.fn()}
      />,
    );

    expect(screen.getByText("1 Pendiente")).toBeTruthy();
  });

  it("shows an empty-state message when the day has no tasks", () => {
    render(<CalendarDayPanel date={new Date(2026, 7, 20)} entries={[]} onTaskPress={jest.fn()} />);

    expect(screen.getByText("No hay tareas para este día.")).toBeTruthy();
  });
});
