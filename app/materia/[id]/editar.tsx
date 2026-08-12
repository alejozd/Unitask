import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { SubjectForm } from "@/components/SubjectForm";
import { db } from "@/db/client";
import { subjects } from "@/db/schema/subject";
import { updateSubject } from "@/db/repositories/subject";
import type { SubjectFormValues } from "@/validation/subject";

export default function EditarMateriaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: rows } = useLiveQuery(db.select().from(subjects).where(eq(subjects.id, id)));
  const subject = rows?.[0];

  async function handleSubmit(values: SubjectFormValues) {
    await updateSubject(id, {
      name: values.name,
      courseCode: values.courseCode || null,
      professorName: values.professorName || null,
      color: values.color,
    });
    router.back();
  }

  if (!subject) {
    return (
      <View style={styles.center}>
        <Text>Cargando…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
