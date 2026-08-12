import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, StyleSheet, Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SubjectForm } from "@/components/SubjectForm";
import { db } from "@/db/client";
import { subjects } from "@/db/schema/subject";
import { updateSubject, SemesterReadOnlyError } from "@/db/repositories/subject";
import { colors } from "@/theme";
import type { SubjectFormValues } from "@/validation/subject";

export default function EditarMateriaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: rows } = useLiveQuery(db.select().from(subjects).where(eq(subjects.id, id)));
  const subject = rows?.[0];

  async function handleSubmit(values: SubjectFormValues) {
    try {
      await updateSubject(id, {
        name: values.name,
        courseCode: values.courseCode || null,
        professorName: values.professorName || null,
        color: values.color,
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

  if (!subject) {
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
      <SubjectForm
        submitLabel="Guardar cambios"
        initialValues={{
          name: subject.name,
          courseCode: subject.courseCode ?? "",
          professorName: subject.professorName ?? "",
          color: subject.color,
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
