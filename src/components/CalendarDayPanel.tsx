import { StyleSheet, Text, View } from "react-native";

import type { SubjectColor } from "@/db/repositories/subject";
import type { TaskStatus } from "@/domain/task-status";
import { colors } from "@/theme";
import { TaskRow } from "./TaskRow";

export interface CalendarDayPanelEntry {
  taskId: string;
  title: string;
  subjectName: string | undefined;
  subjectColor: SubjectColor | undefined;
  priority: "Alta" | "Media" | "Baja";
  status: TaskStatus;
}

interface CalendarDayPanelProps {
  date: Date;
  entries: CalendarDayPanelEntry[];
  onTaskPress: (taskId: string) => void;
}

function formatDayHeader(date: Date): string {
  return date.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}

export function CalendarDayPanel({ date, entries, onTaskPress }: CalendarDayPanelProps) {
  const pendientesCount = entries.filter((item) => item.status === "Pendiente").length;
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>{formatDayHeader(date)}</Text>
        {entries.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {pendientesCount} {pendientesCount === 1 ? "Pendiente" : "Pendientes"}
            </Text>
          </View>
        )}
      </View>
      {entries.length === 0 ? (
        <Text style={styles.emptyText}>No hay tareas para este día.</Text>
      ) : (
        <View style={styles.list}>
          {entries.map((item) => (
            <TaskRow
              key={item.taskId}
              entry={{
                taskId: item.taskId,
                title: item.title,
                completed: item.status === "Completada",
                subjectName: item.subjectName,
                subjectColor: item.subjectColor,
                priority: item.priority,
                trailingLabel: item.status,
                trailingIsUrgent: item.status === "Vencida",
              }}
              onPress={() => onTaskPress(item.taskId)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  header: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    textTransform: "capitalize",
  },
  badge: {
    backgroundColor: colors.primaryTint,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, fontWeight: "600", color: colors.primary },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  list: { gap: 12 },
});
