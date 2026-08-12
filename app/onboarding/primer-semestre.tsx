import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { createSemester } from "@/db/repositories/semester";

export default function PrimerSemestreScreen() {
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmedLabel = label.trim();
  const canSubmit = trimmedLabel.length > 0 && !submitting;

  async function handleCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await createSemester(trimmedLabel);
      // Deliberately no navigation call here. `app/_layout.tsx`'s effect
      // owns the redirect to `/(tabs)`, firing once its own live query of
      // active semesters actually reflects this write — navigating from
      // here instead raced that same query and bounced back to this
      // screen with the form silently reset (reproduced on-device). Stay
      // in the `submitting` state (spinner visible) until the root layout
      // unmounts this screen for us; only clear it below if the write
      // itself failed.
    } catch {
      setSubmitting(false);
      Alert.alert("Error", "No se pudo crear el semestre. Inténtalo de nuevo.");
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenido a UniTask</Text>
      <Text style={styles.body}>
        UniTask organiza tus materias y tareas por semestre académico. Para empezar, crea tu
        semestre actual.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Ej. 2026-1"
        value={label}
        onChangeText={setLabel}
        autoFocus
      />
      <TouchableOpacity
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleCreate}
        disabled={!canSubmit}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Crear semestre</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  body: {
    fontSize: 15,
    color: "#64748B",
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#6366F1",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
