import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, StyleSheet, Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TaskForm, type TaskFormSubjectOption } from "@/components/TaskForm";
import { db } from "@/db/client";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import { updateTask } from "@/db/repositories/task";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { colors } from "@/theme";
import { combineDateAndTime, type TaskFormValues } from "@/validation/task";

export default function EditarTareaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: taskRows } = useLiveQuery(db.select().from(tasks).where(eq(tasks.id, id)));
  const task = taskRows?.[0];

  const { data: activeSemesterRows } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;
  const { data: subjectRows } = useLiveQuery(db.select().from(subjects));
  const activeSubjects = (subjectRows ?? [])
    .filter((subject) => subject.semesterId === activeSemesterId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  async function handleSubmit(values: TaskFormValues) {
    try {
      await updateTask(id, {
        title: values.title,
        description: values.description || null,
        subjectId: values.subjectId,
        dueDateTime: combineDateAndTime(values.dueDate, values.dueTime),
        priority: values.priority,
      });
      router.back();
    } catch (error) {
      if (error instanceof SemesterReadOnlyError) {
        Alert.alert("Semestre cerrado", "Este semestre está cerrado y no se puede editar.");
      } else {
        Alert.alert("Error", "No se pudo guardar los cambios.");
      }
    }
  }

  if (!task) {
    return (
      <SafeAreaView style={styles.center} edges={["top"]}>
        <Text>Cargando…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>← Volver</Text>
      </TouchableOpacity>
      <TaskForm
        subjects={activeSubjects as TaskFormSubjectOption[]}
        submitLabel="Guardar cambios"
        initialValues={{
          title: task.title,
          description: task.description ?? "",
          subjectId: task.subjectId,
          dueDate: task.dueDateTime,
          dueTime: task.dueDateTime,
          priority: task.priority,
        }}
        onSubmit={handleSubmit}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  backButton: { paddingHorizontal: 20, paddingTop: 12 },
  backButtonText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
});
