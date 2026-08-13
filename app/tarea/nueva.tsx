import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ReminderPicker, formatReminderSpec } from "@/components/ReminderPicker";
import { TaskForm, type TaskFormSubjectOption } from "@/components/TaskForm";
import { db } from "@/db/client";
import { getActiveSemester } from "@/db/repositories/semester";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import { createTask } from "@/db/repositories/task";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { defaultReminder, type ReminderSpec } from "@/domain/reminder-scheduling";
import { colors } from "@/theme";
import { combineDateAndTime, type TaskFormValues } from "@/validation/task";

export default function NuevaTareaScreen() {
  // Same `updatedAt !== undefined` pattern as app/_layout.tsx (see its
  // top comment): `useLiveQuery`'s `data` starts as `[]`, not `undefined`,
  // so `activeSubjects.length === 0` is only meaningful once BOTH queries
  // below have resolved at least once — otherwise the empty-subjects
  // screen flashes on every fresh navigation, even when subjects exist.
  const { data: activeSemesterRows, updatedAt: semesterUpdatedAt } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;

  const { data: subjectRows, updatedAt: subjectsUpdatedAt } = useLiveQuery(
    db.select().from(subjects),
  );
  const activeSubjects = (subjectRows ?? [])
    .filter((subject) => subject.semesterId === activeSemesterId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  const loaded = semesterUpdatedAt !== undefined && subjectsUpdatedAt !== undefined;

  const [subtaskTexts, setSubtaskTexts] = useState<string[]>([]);
  const [newSubtaskText, setNewSubtaskText] = useState("");
  const [reminderSpecs, setReminderSpecs] = useState<ReminderSpec[]>([defaultReminder()]);

  function handleAddSubtaskDraft() {
    const trimmed = newSubtaskText.trim();
    if (!trimmed) return;
    setSubtaskTexts((current) => [...current, trimmed]);
    setNewSubtaskText("");
  }

  function handleRemoveSubtaskDraft(index: number) {
    setSubtaskTexts((current) => current.filter((_, i) => i !== index));
  }

  function handleAddReminderDraft(spec: ReminderSpec) {
    setReminderSpecs((current) => [...current, spec]);
  }

  function handleRemoveReminderDraft(index: number) {
    setReminderSpecs((current) => current.filter((_, i) => i !== index));
  }

  async function submitTask(values: TaskFormValues, dueDateTime: Date) {
    try {
      const activeSemester = await getActiveSemester();
      if (!activeSemester) {
        // Should be unreachable: the app never lets the user reach this
        // screen without an active semester (root layout redirect, Phase 2 Task 3).
        throw new Error("No hay un semestre activo");
      }
      await createTask({
        title: values.title,
        description: values.description || undefined,
        subjectId: values.subjectId,
        dueDateTime,
        priority: values.priority,
        subtaskTexts,
        reminderSpecs,
      });
      router.back();
    } catch (error) {
      if (error instanceof SemesterReadOnlyError) {
        Alert.alert("Semestre cerrado", "Este semestre está cerrado y no admite nuevas tareas.");
      } else {
        Alert.alert("Error", "No se pudo crear la tarea.");
      }
    }
  }

  async function handleSubmit(values: TaskFormValues) {
    const dueDateTime = combineDateAndTime(values.dueDate, values.dueTime);
    if (dueDateTime.getTime() <= Date.now()) {
      Alert.alert(
        "Fecha límite ya pasada",
        "La fecha y hora límite elegidas ya pasaron según el reloj del dispositivo. La tarea se creará como Vencida.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Crear de todas formas", onPress: () => submitTask(values, dueDateTime) },
        ],
      );
      return;
    }
    await submitTask(values, dueDateTime);
  }

  let content: ReactNode;
  if (!loaded) {
    content = (
      <View style={styles.center}>
        <Text>Cargando…</Text>
      </View>
    );
  } else if (activeSubjects.length === 0) {
    // Mirrors 04-user-flows.md flow 2's "If the subject picker is empty,
    // the user is redirected to create a subject first" — there is no
    // subject to assign the task to, so send them to create one instead
    // of rendering a form with an empty, unusable subject picker.
    content = (
      <View style={styles.center}>
        <Text style={styles.emptyText}>
          Necesitas al menos una materia antes de crear una tarea.
        </Text>
        <TouchableOpacity
          style={styles.emptyButton}
          onPress={() => router.replace("/materia/nueva")}
        >
          <Text style={styles.emptyButtonText}>Crear materia</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    content = (
      <TaskForm
        subjects={activeSubjects as TaskFormSubjectOption[]}
        submitLabel="Crear tarea"
        onSubmit={handleSubmit}
        footer={
          <>
            <View style={styles.subtasksSection}>
              <Text style={styles.subtasksTitle}>Subtareas iniciales (opcional)</Text>
              {subtaskTexts.map((text, index) => (
                <View key={`${text}-${index}`} style={styles.subtaskRow}>
                  <Text style={styles.subtaskText}>{text}</Text>
                  <TouchableOpacity onPress={() => handleRemoveSubtaskDraft(index)}>
                    <Text style={styles.subtaskRemove}>Quitar</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <View style={styles.subtaskInputRow}>
                <TextInput
                  style={styles.subtaskInput}
                  value={newSubtaskText}
                  onChangeText={setNewSubtaskText}
                  placeholder="Ej. Investigar fuentes"
                  onSubmitEditing={handleAddSubtaskDraft}
                />
                <TouchableOpacity style={styles.subtaskAddButton} onPress={handleAddSubtaskDraft}>
                  <Text style={styles.subtaskAddButtonText}>Añadir</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.subtasksSection}>
              <Text style={styles.subtasksTitle}>Recordatorios</Text>
              {reminderSpecs.map((spec, index) => (
                <View key={`${JSON.stringify(spec)}-${index}`} style={styles.subtaskRow}>
                  <Text style={styles.subtaskText}>{formatReminderSpec(spec)}</Text>
                  <TouchableOpacity onPress={() => handleRemoveReminderDraft(index)}>
                    <Text style={styles.subtaskRemove}>Quitar</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <ReminderPicker onAdd={handleAddReminderDraft} />
            </View>
          </>
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>← Volver</Text>
      </TouchableOpacity>
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  backButton: { paddingHorizontal: 20, paddingTop: 12 },
  backButtonText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  emptyText: { fontSize: 15, color: colors.textMuted, textAlign: "center" },
  emptyButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  emptyButtonText: { color: "#FFFFFF", fontWeight: "600" },
  subtasksSection: { paddingHorizontal: 20, paddingBottom: 24, gap: 8 },
  subtasksTitle: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  subtaskRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subtaskText: { fontSize: 15, color: colors.text, flex: 1 },
  subtaskRemove: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  subtaskInputRow: { flexDirection: "row", gap: 8, marginTop: 8 },
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
});
