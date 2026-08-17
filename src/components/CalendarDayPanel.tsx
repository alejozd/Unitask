import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { SubjectColor } from "@/db/repositories/subject";
import type { TaskStatus } from "@/domain/task-status";
import { colors, priorityColors, subjectPalette } from "@/theme";

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
        entries.map((item) => (
          <TouchableOpacity
            key={item.taskId}
            style={styles.row}
            onPress={() => onTaskPress(item.taskId)}
          >
            <View style={styles.rowBody}>
              <Text style={styles.title}>{item.title}</Text>
              <View style={styles.metaRow}>
                {item.subjectName && item.subjectColor && (
                  <View style={styles.metaChip}>
                    <View
                      style={[styles.dot, { backgroundColor: subjectPalette[item.subjectColor] }]}
                    />
                    <Text style={styles.metaText}>{item.subjectName}</Text>
                  </View>
                )}
                <View style={styles.metaChip}>
                  <View style={[styles.dot, { backgroundColor: priorityColors[item.priority] }]} />
                  <Text style={styles.metaText}>{item.priority}</Text>
                </View>
              </View>
            </View>
            <Text style={styles.status}>{item.status}</Text>
          </TouchableOpacity>
        ))
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  rowBody: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: "600", color: colors.text },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metaText: { fontSize: 12, color: colors.textMuted },
  status: { fontSize: 12, color: colors.textMuted },
});
