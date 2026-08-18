import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { SubjectColor } from "@/db/repositories/subject";
import { colors, priorityColors } from "@/theme";
import { SubjectIcon } from "./SubjectIcon";

export interface TaskRowEntry {
  taskId: string;
  title: string;
  completed: boolean;
  subjectName: string | undefined;
  subjectColor: SubjectColor | undefined;
  priority: "Alta" | "Media" | "Baja";
  /** Either a formatted due-date label or a status word — the caller decides which fits its context. */
  trailingLabel: string;
  trailingIsUrgent?: boolean;
}

interface TaskRowProps {
  entry: TaskRowEntry;
  onPress: () => void;
}

/**
 * Phase 9.5 UI-consistency pass: shared row (SubjectIcon + completion
 * checkbox + title + subject/priority tags + a trailing date-or-status
 * label) used by the Dashboard's "Próximas entregas" list and the
 * Calendar's day panel — previously two separately-styled row
 * implementations. The Dashboard's richer "Tareas urgentes" carousel card
 * keeps its own distinct format (not this component, per the human's
 * explicit instruction).
 *
 * Completion state (confirmed with the human): a completed task shows a
 * filled checkbox with a white check, a struck-through title, and the
 * whole row dimmed to ~0.6 opacity; a pending task shows the same empty
 * circle already used by the Tareas tab's quick-complete checkbox. The
 * checkbox here is purely a status indicator, not tappable — quick-
 * complete from this row was explicitly out of scope (matches Phase 7's
 * own deferral of quick-complete-from-calendar).
 */
export function TaskRow({ entry, onPress }: TaskRowProps) {
  return (
    <TouchableOpacity
      style={[styles.row, entry.completed && styles.rowCompleted]}
      onPress={onPress}
    >
      {entry.subjectName && entry.subjectColor ? (
        <SubjectIcon name={entry.subjectName} color={entry.subjectColor} />
      ) : (
        <View style={styles.iconPlaceholder} />
      )}

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <View style={[styles.checkbox, entry.completed && styles.checkboxFilled]}>
            {entry.completed && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={[styles.title, entry.completed && styles.titleCompleted]} numberOfLines={2}>
            {entry.title}
          </Text>
        </View>
        <View style={styles.tagsRow}>
          {entry.subjectName && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{entry.subjectName}</Text>
            </View>
          )}
          <View style={styles.tag}>
            <View style={[styles.dot, { backgroundColor: priorityColors[entry.priority] }]} />
            <Text style={styles.tagText}>{entry.priority}</Text>
          </View>
        </View>
      </View>

      <Text style={[styles.trailing, entry.trailingIsUrgent && styles.trailingUrgent]}>
        {entry.trailingLabel}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  rowCompleted: { opacity: 0.6 },
  iconPlaceholder: { width: 40, height: 40 },
  body: { flex: 1, gap: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxFilled: { backgroundColor: colors.primary },
  checkmark: { color: colors.onColor, fontSize: 12, fontWeight: "700" },
  title: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  titleCompleted: { textDecorationLine: "line-through" },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tag: { flexDirection: "row", alignItems: "center", gap: 4 },
  tagText: { fontSize: 12, color: colors.textMuted },
  dot: { width: 8, height: 8, borderRadius: 4 },
  trailing: { fontSize: 12, color: colors.textMuted, textAlign: "right" },
  trailingUrgent: { color: colors.danger, fontWeight: "600" },
});
