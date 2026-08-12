import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { db } from "@/db/client";
import { closeSemester, createSemester } from "@/db/repositories/semester";
import { semesters } from "@/db/schema/semester";
import { colors } from "@/theme";
import { desc } from "drizzle-orm";

export default function SemestresScreen() {
  const { data: semesterList } = useLiveQuery(
    db.select().from(semesters).orderBy(desc(semesters.createdAt)),
  );
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreateNew() {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await createSemester(trimmed);
      setNewLabel("");
    } finally {
      setBusy(false);
    }
  }

  function handleClosePress(id: string) {
    Alert.alert(
      "Cerrar semestre",
      "El semestre y todo lo que contiene (materias, tareas) pasará a ser de solo lectura.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar semestre",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await closeSemester(id);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Semestres</Text>

      <FlatList
        data={semesterList ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{item.label}</Text>
              <Text style={styles.cardStatus}>
                {item.status === "active" ? "Activo" : "Cerrado"}
              </Text>
            </View>
            {item.status === "active" ? (
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => handleClosePress(item.id)}
                disabled={busy}
              >
                <Text style={styles.closeButtonText}>Cerrar</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />

      <View style={styles.newSemesterRow}>
        <TextInput
          style={styles.input}
          placeholder="Nuevo semestre (ej. 2026-2)"
          value={newLabel}
          onChangeText={setNewLabel}
        />
        <TouchableOpacity style={styles.createButton} onPress={handleCreateNew} disabled={busy}>
          <Text style={styles.createButtonText}>Crear</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  list: { gap: 12, paddingVertical: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
  },
  cardBody: { gap: 2 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  cardStatus: { fontSize: 13, color: colors.textMuted },
  closeButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeButtonText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  newSemesterRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  createButtonText: { color: "#FFFFFF", fontWeight: "600" },
});
