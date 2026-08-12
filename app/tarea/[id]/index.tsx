import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { db } from "@/db/client";
import { deleteTask, completeTaskAction } from "@/db/repositories/task";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import {
  addSubtask,
  deleteSubtask,
  moveSubtask,
  toggleSubtaskCompleted,
} from "@/db/repositories/subtask";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks } from "@/db/schema/task";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus } from "@/domain/task-status";
import { colors, priorityColors, subjectPalette } from "@/theme";

function handleActionError(error: unknown, fallbackMessage: string) {
  if (error instanceof SemesterReadOnlyError) {
    Alert.alert("Semestre cerrado", "Este semestre está cerrado y no se puede modificar.");
  } else {
    Alert.alert("Error", fallbackMessage);
  }
}

export default function DetalleDeTareaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: taskRows } = useLiveQuery(db.select().from(tasks).where(eq(tasks.id, id)));
  const task = taskRows?.[0];
  // Deliberately NOT `.where(eq(subjects.id, task?.subjectId ?? ""))`: that
  // WHERE clause's value would depend on another useLiveQuery's still-
  // resolving result, and this project has already found real bugs (Phase 2
  // Task 4) from assuming — rather than verifying — how useLiveQuery
  // reacts to a query argument that changes shape across renders without
  // an explicit deps array. Fetching all subjects and finding the match in
  // JS sidesteps the question entirely; it's the same proven pattern the
  // Tareas list (Task 5) and Materias list (Phase 2) already use.
  const { data: subjectRows } = useLiveQuery(db.select().from(subjects));
  const subject = subjectRows?.find((s) => s.id === task?.subjectId);
  const { data: subtaskRows } = useLiveQuery(
    db.select().from(subtasks).where(eq(subtasks.taskId, id)),
  );
  const taskSubtasks = (subtaskRows ?? []).slice().sort((a, b) => a.order - b.order);

  const [newSubtaskText, setNewSubtaskText] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleComplete() {
    setBusy(true);
    try {
      await completeTaskAction(id);
    } catch (error) {
      handleActionError(error, "No se pudo completar la tarea.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddSubtask() {
    const trimmed = newSubtaskText.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await addSubtask(id, trimmed);
      setNewSubtaskText("");
    } catch (error) {
      handleActionError(error, "No se pudo añadir la subtarea.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleSubtask(subtaskId: string, completed: boolean) {
    setBusy(true);
    try {
      await toggleSubtaskCompleted(subtaskId, completed);
    } catch (error) {
      handleActionError(error, "No se pudo actualizar la subtarea.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveSubtask(subtaskId: string) {
    setBusy(true);
    try {
      await deleteSubtask(subtaskId);
    } catch (error) {
      handleActionError(error, "No se pudo eliminar la subtarea.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveSubtask(subtaskId: string, direction: "up" | "down") {
    setBusy(true);
    try {
      await moveSubtask(subtaskId, direction);
    } catch (error) {
      handleActionError(error, "No se pudo reordenar la subtarea.");
    } finally {
      setBusy(false);
    }
  }

  function handleDeletePress() {
    Alert.alert("Eliminar tarea", "Esta acción eliminará la tarea y sus subtareas.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteTask(id);
            router.back();
          } catch (error) {
            handleActionError(error, "No se pudo eliminar la tarea.");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (!task) {
    return (
      <SafeAreaView style={styles.center} edges={["top"]}>
        <Text>Cargando…</Text>
      </SafeAreaView>
    );
  }

  const progress = calculateTaskProgress(taskSubtasks, task.completed);
  const status = deriveTaskStatus({
    completed: task.completed,
    dueDateTime: task.dueDateTime,
    progress,
  });

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>← Volver</Text>
      </TouchableOpacity>

      <View style={styles.headerRow}>
        <View style={[styles.priorityDot, { backgroundColor: priorityColors[task.priority] }]} />
        <Text style={styles.title}>{task.title}</Text>
      </View>
      <Text style={styles.statusLine}>
        {status} · {progress}% · Prioridad {task.priority}
      </Text>
      {subject && (
        <View style={styles.subjectRow}>
          <View style={[styles.subjectDot, { backgroundColor: subjectPalette[subject.color] }]} />
          <Text style={styles.detail}>{subject.name}</Text>
        </View>
      )}
      <Text style={styles.detail}>
        Vence: {task.dueDateTime.toLocaleString("es", { dateStyle: "long", timeStyle: "short" })}
      </Text>
      {task.description ? <Text style={styles.description}>{task.description}</Text> : null}

      <TouchableOpacity
        style={[styles.completeButton, task.completed && styles.completeButtonDisabled]}
        onPress={handleComplete}
        disabled={task.completed || busy}
      >
        <Text style={styles.completeButtonText}>
          {task.completed ? "Completada" : "Marcar como completada"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Subtareas</Text>
      {taskSubtasks.map((subtask, index) => (
        <View key={subtask.id} style={styles.subtaskRow}>
          <TouchableOpacity
            style={styles.subtaskCheckbox}
            disabled={busy}
            onPress={() => handleToggleSubtask(subtask.id, !subtask.completed)}
          >
            <Text style={styles.subtaskCheckboxText}>{subtask.completed ? "✓" : "○"}</Text>
          </TouchableOpacity>
          <Text style={[styles.subtaskText, subtask.completed && styles.subtaskTextCompleted]}>
            {subtask.text}
          </Text>
          <TouchableOpacity
            disabled={busy || index === 0}
            onPress={() => handleMoveSubtask(subtask.id, "up")}
          >
            <Text style={styles.subtaskAction}>↑</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={busy || index === taskSubtasks.length - 1}
            onPress={() => handleMoveSubtask(subtask.id, "down")}
          >
            <Text style={styles.subtaskAction}>↓</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={() => handleRemoveSubtask(subtask.id)}>
            <Text style={styles.subtaskRemove}>Quitar</Text>
          </TouchableOpacity>
        </View>
      ))}
      <View style={styles.subtaskInputRow}>
        <TextInput
          style={styles.subtaskInput}
          value={newSubtaskText}
          onChangeText={setNewSubtaskText}
          placeholder="Nueva subtarea"
          onSubmitEditing={handleAddSubtask}
        />
        <TouchableOpacity
          style={styles.subtaskAddButton}
          disabled={busy}
          onPress={handleAddSubtask}
        >
          <Text style={styles.subtaskAddButtonText}>Añadir</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => router.push(`/tarea/${task.id}/editar`)}
        >
          <Text style={styles.editButtonText}>Editar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeletePress}
          disabled={deleting}
        >
          <Text style={styles.deleteButtonText}>Eliminar tarea</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  backButton: { alignSelf: "flex-start" },
  backButtonText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  priorityDot: { width: 14, height: 14, borderRadius: 7 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, flex: 1 },
  statusLine: { fontSize: 13, color: colors.textMuted },
  subjectRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  subjectDot: { width: 10, height: 10, borderRadius: 5 },
  detail: { fontSize: 14, color: colors.textMuted },
  description: { fontSize: 14, color: colors.text, marginTop: 4 },
  completeButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  completeButtonDisabled: { opacity: 0.5 },
  completeButtonText: { color: "#FFFFFF", fontWeight: "600" },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 20 },
  subtaskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subtaskCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  subtaskCheckboxText: { fontSize: 13, color: colors.primary, fontWeight: "700" },
  subtaskText: { flex: 1, fontSize: 14, color: colors.text },
  subtaskTextCompleted: { textDecorationLine: "line-through", color: colors.textMuted },
  subtaskAction: { fontSize: 16, color: colors.primary, paddingHorizontal: 4 },
  subtaskRemove: { color: colors.danger, fontSize: 12, fontWeight: "600" },
  subtaskInputRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  subtaskInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  subtaskAddButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  subtaskAddButtonText: { color: colors.primary, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 12, marginTop: 24 },
  editButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  editButtonText: { color: colors.primary, fontWeight: "600" },
  deleteButton: {
    flex: 1,
    backgroundColor: colors.danger,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  deleteButtonText: { color: "#FFFFFF", fontWeight: "600" },
});
