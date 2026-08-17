import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { CalendarAddTaskFab } from "@/components/CalendarAddTaskFab";
import { CalendarDayPanel, type CalendarDayPanelEntry } from "@/components/CalendarDayPanel";
import { db } from "@/db/client";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks } from "@/db/schema/task";
import { buildCalendarMonth } from "@/domain/calendar";
import { isSameCalendarDay, type DashboardEntry } from "@/domain/dashboard";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus } from "@/domain/task-status";
import { colors, priorityColors } from "@/theme";

function formatMonthHeader(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("es", { month: "long", year: "numeric" });
}

// Monday-first single-letter weekday header (visual cue from
// calendario_unitask.png — "guía, no spec"), matching this module's own
// Monday-first grid convention in src/domain/calendar.ts.
const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

export default function CalendarioScreen() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);

  // Status (esp. Vencida) is time-derived and must not go stale across a
  // long-open session — same tick as tareas/index.tsx. Phase 6's
  // whole-branch review flagged the Home screen's initial omission of this
  // as an Important finding; this screen ships with it from the start.
  const [, forceStatusRecompute] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceStatusRecompute((tick) => tick + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data: activeSemesterRows, updatedAt: semesterUpdatedAt } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;

  const { data: subjectRows, updatedAt: subjectsUpdatedAt } = useLiveQuery(
    db.select().from(subjects),
  );
  const activeSubjectIds = new Set(
    (subjectRows ?? [])
      .filter((subject) => subject.semesterId === activeSemesterId)
      .map((subject) => subject.id),
  );
  const subjectsById = new Map((subjectRows ?? []).map((subject) => [subject.id, subject]));

  const { data: taskRows, updatedAt: tasksUpdatedAt } = useLiveQuery(db.select().from(tasks));
  const { data: subtaskRows, updatedAt: subtasksUpdatedAt } = useLiveQuery(
    db.select().from(subtasks),
  );

  const loaded =
    semesterUpdatedAt !== undefined &&
    subjectsUpdatedAt !== undefined &&
    tasksUpdatedAt !== undefined &&
    subtasksUpdatedAt !== undefined;

  const entries: DashboardEntry[] = (taskRows ?? [])
    .filter((task) => activeSubjectIds.has(task.subjectId))
    .map((task) => {
      const taskSubtasks = (subtaskRows ?? []).filter((subtask) => subtask.taskId === task.id);
      const progress = calculateTaskProgress(taskSubtasks, task.completed);
      const status = deriveTaskStatus({
        completed: task.completed,
        dueDateTime: task.dueDateTime,
        progress,
      });
      return { task, status };
    });

  const days = buildCalendarMonth(entries, viewYear, viewMonth);
  const selectedDay = days.find((day) => isSameCalendarDay(day.date, selectedDate));
  const panelEntries: CalendarDayPanelEntry[] = (selectedDay?.entries ?? []).map((item) => {
    const subject = subjectsById.get(item.task.subjectId);
    return {
      taskId: item.task.id,
      title: item.task.title,
      subjectName: subject?.name,
      subjectColor: subject?.color,
      priority: item.task.priority,
      status: item.status,
    };
  });

  function goToPreviousMonth() {
    const prev = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(prev.getFullYear());
    setViewMonth(prev.getMonth());
  }

  function goToNextMonth() {
    const next = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goToPreviousMonth}>
          <Text style={styles.navArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{formatMonthHeader(viewYear, viewMonth)}</Text>
        <TouchableOpacity onPress={goToNextMonth}>
          <Text style={styles.navArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {!loaded ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Cargando…</Text>
        </View>
      ) : (
        <ScrollView>
          <View style={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((label, index) => (
              <Text key={`${label}-${index}`} style={styles.weekdayLabel}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {days.map((day) => {
              const isSelected = isSameCalendarDay(day.date, selectedDate);
              return (
                <TouchableOpacity
                  key={day.date.toISOString()}
                  style={[
                    styles.dayCell,
                    isSelected && styles.dayCellSelected,
                    !day.isCurrentMonth && styles.dayCellDimmed,
                  ]}
                  onPress={() => setSelectedDate(day.date)}
                >
                  <Text
                    style={[
                      styles.dayNumber,
                      !day.isCurrentMonth && styles.dayNumberDimmed,
                      isSelected && styles.dayNumberSelected,
                    ]}
                  >
                    {day.date.getDate()}
                  </Text>
                  <View style={styles.dotsRow}>
                    {day.priorityDots.map((priority) => (
                      <View
                        key={priority}
                        style={[styles.dot, { backgroundColor: priorityColors[priority] }]}
                      />
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <CalendarDayPanel
            date={selectedDate}
            entries={panelEntries}
            onTaskPress={(taskId) => router.push(`/tarea/${taskId}`)}
          />
        </ScrollView>
      )}

      <CalendarAddTaskFab selectedDate={selectedDate} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
  },
  navArrow: { fontSize: 24, color: colors.primary, paddingHorizontal: 12 },
  monthTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    textTransform: "capitalize",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.textMuted },
  weekdayRow: { flexDirection: "row", paddingHorizontal: 12, paddingBottom: 4 },
  weekdayLabel: {
    width: "14.28%",
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12 },
  dayCell: {
    width: "14.28%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  dayCellSelected: { backgroundColor: colors.primary, borderRadius: 999 },
  dayCellDimmed: { opacity: 0.4 },
  dayNumber: { fontSize: 14, color: colors.text },
  dayNumberDimmed: { color: colors.textMuted },
  dayNumberSelected: { color: "#FFFFFF", fontWeight: "700" },
  dotsRow: { flexDirection: "row", gap: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
