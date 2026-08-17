import type { Task } from "@/db/schema/task";
import { isSameCalendarDay, type DashboardEntry } from "./dashboard";

type Priority = Task["priority"];

const PRIORITY_ORDER: Priority[] = ["Alta", "Media", "Baja"];

export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  priorityDots: Priority[];
  entries: DashboardEntry[];
}

/**
 * 03-business-rules.md §16: builds a Monday-first month grid (leading/
 * trailing days from adjacent months fill out partial weeks). Each day's
 * `priorityDots` is one dot per distinct priority present that day (Alta >
 * Media > Baja, deduped) — §16 explicitly leaves multi-task visual
 * treatment as an implementation decision; this is the resolved choice,
 * not a product-level rule. `entries` includes ALL tasks due that day
 * regardless of completion status — unlike the Dashboard's widgets (§15),
 * §16 does not state a completed-task exclusion for the day indicator.
 */
export function buildCalendarMonth(
  entries: DashboardEntry[],
  year: number,
  month: number,
): CalendarDay[] {
  const firstOfMonth = new Date(year, month, 1);
  const mondayFirstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayFirstWeekday);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((mondayFirstWeekday + daysInMonth) / 7) * 7;

  const days: CalendarDay[] = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dayEntries = entries
      .filter((item) => isSameCalendarDay(item.task.dueDateTime, date))
      .sort((a, b) => a.task.dueDateTime.getTime() - b.task.dueDateTime.getTime());
    const priorityDots = PRIORITY_ORDER.filter((priority) =>
      dayEntries.some((item) => item.task.priority === priority),
    );
    days.push({
      date,
      isCurrentMonth: date.getMonth() === month,
      priorityDots,
      entries: dayEntries,
    });
  }
  return days;
}
