import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { SubjectForm } from "@/components/SubjectForm";
import { getActiveSemester } from "@/db/repositories/semester";
import { createSubject } from "@/db/repositories/subject";
import type { SubjectFormValues } from "@/validation/subject";

export default function NuevaMateriaScreen() {
  async function handleSubmit(values: SubjectFormValues) {
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
  }

  return (
    <View style={styles.container}>
      <SubjectForm submitLabel="Crear materia" onSubmit={handleSubmit} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
