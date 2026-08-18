import { router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity } from "react-native";

import { colors } from "@/theme";

interface CalendarAddTaskFabProps {
  selectedDate: Date;
}

/**
 * 11-roadmap.md Phase 7: "contextual 'Añadir tarea' pre-filling the
 * selected date" — passes the currently selected calendar day as a route
 * param so app/tarea/nueva.tsx can pre-fill TaskForm's dueDate field.
 */
export function CalendarAddTaskFab({ selectedDate }: CalendarAddTaskFabProps) {
  function handlePress() {
    router.push({
      pathname: "/tarea/nueva",
      params: { dueDate: selectedDate.toISOString() },
    });
  }

  return (
    <TouchableOpacity style={styles.fab} onPress={handlePress}>
      <Text style={styles.fabText}>+</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  fabText: { color: colors.onColor, fontSize: 28, lineHeight: 30 },
});
