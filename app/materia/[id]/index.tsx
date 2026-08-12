import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { db } from "@/db/client";
import { subjects } from "@/db/schema/subject";
import {
  SemesterReadOnlyError,
  SubjectDeletionBlockedError,
  deleteSubject,
} from "@/db/repositories/subject";
import { colors, subjectPalette } from "@/theme";

export default function DetalleDeMateriaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: rows } = useLiveQuery(db.select().from(subjects).where(eq(subjects.id, id)));
  const subject = rows?.[0];
  const [deleting, setDeleting] = useState(false);

  async function handleDeletePress() {
    Alert.alert("Eliminar materia", "Esta acción eliminará la materia y sus tareas completadas.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteSubject(id);
            router.back();
          } catch (error) {
            if (error instanceof SubjectDeletionBlockedError) {
              Alert.alert(
                "No se puede eliminar",
                `Hay ${error.blockingTaskCount} tarea(s) pendiente(s) o en progreso. Complétalas, elimínalas o reasígnalas a otra materia antes de eliminar esta.`,
              );
            } else if (error instanceof SemesterReadOnlyError) {
              Alert.alert(
                "Semestre cerrado",
                "Este semestre está cerrado y no se puede eliminar la materia.",
              );
            } else {
              Alert.alert("Error", "No se pudo eliminar la materia.");
            }
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
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
      <View style={styles.headerRow}>
        <View style={[styles.colorDot, { backgroundColor: subjectPalette[subject.color] }]} />
        <Text style={styles.title}>{subject.name}</Text>
      </View>
      {subject.courseCode ? <Text style={styles.detail}>Código: {subject.courseCode}</Text> : null}
      {subject.professorName ? (
        <Text style={styles.detail}>Profesor: {subject.professorName}</Text>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => router.push(`/materia/${subject.id}/editar`)}
        >
          <Text style={styles.editButtonText}>Editar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeletePress}
          disabled={deleting}
        >
          <Text style={styles.deleteButtonText}>Eliminar materia</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  backButton: { alignSelf: "flex-start" },
  backButtonText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  detail: { fontSize: 14, color: colors.textMuted },
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
