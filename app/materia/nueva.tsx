import { router } from "expo-router";
import { Alert, StyleSheet, Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SubjectForm } from "@/components/SubjectForm";
import { getActiveSemester } from "@/db/repositories/semester";
import { createSubject, SemesterReadOnlyError } from "@/db/repositories/subject";
import { colors } from "@/theme";
import type { SubjectFormValues } from "@/validation/subject";

export default function NuevaMateriaScreen() {
  async function handleSubmit(values: SubjectFormValues) {
    try {
      const activeSemester = await getActiveSemester();
      if (!activeSemester) {
        // Should be unreachable: the app never lets the user reach this
        // screen without an active semester (root layout redirect, Task 3).
        throw new Error("No hay un semestre activo");
      }
      await createSubject({
        name: values.name,
        courseCode: values.courseCode || undefined,
        professorName: values.professorName || undefined,
        color: values.color,
        semesterId: activeSemester.id,
      });
      router.back();
    } catch (error) {
      if (error instanceof SemesterReadOnlyError) {
        Alert.alert("Semestre cerrado", "Este semestre está cerrado y no admite nuevas materias.");
      } else {
        Alert.alert("Error", "No se pudo crear la materia.");
      }
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>← Volver</Text>
      </TouchableOpacity>
      <SubjectForm submitLabel="Crear materia" onSubmit={handleSubmit} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backButton: { paddingHorizontal: 20, paddingTop: 12 },
  backButtonText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
});
