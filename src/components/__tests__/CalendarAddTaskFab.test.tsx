import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { CalendarAddTaskFab } from "../CalendarAddTaskFab";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

describe("CalendarAddTaskFab", () => {
  it("navigates to /tarea/nueva with the selected day pre-filled as the dueDate param", () => {
    const selectedDate = new Date(2026, 7, 20);
    render(<CalendarAddTaskFab selectedDate={selectedDate} />);

    fireEvent.press(screen.getByText("+"));

    expect(router.push).toHaveBeenCalledWith({
      pathname: "/tarea/nueva",
      params: { dueDate: selectedDate.toISOString() },
    });
  });
});
