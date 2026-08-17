import { useEffect, useState } from "react";
import { router } from "expo-router";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getProfile, saveProfile } from "@/db/repositories/settings";
import { colors } from "@/theme";

export default function ConfiguracionScreen() {
  const [nickname, setNickname] = useState("");
  const [fullName, setFullName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProfile().then((profile) => {
      if (cancelled) return;
      setNickname(profile.nickname ?? "");
      setFullName(profile.fullName ?? "");
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await saveProfile({
        nickname: nickname.trim() || null,
        fullName: fullName.trim() || null,
      });
      router.back();
    } catch {
      Alert.alert("Error", "No se pudo guardar el perfil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>← Volver</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Configuración</Text>

      {!loaded ? (
        <View style={styles.center}>
          <Text style={styles.loadingText}>Cargando…</Text>
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>Apodo</Text>
          <TextInput
            style={styles.input}
            value={nickname}
            onChangeText={setNickname}
            placeholder="Ej. Ale"
          />
          <Text style={styles.label}>Nombre completo</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Ej. Alejandro Díaz"
          />
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  backButton: { paddingHorizontal: 20, paddingTop: 12 },
  backButtonText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { color: colors.textMuted },
  form: { padding: 20, gap: 8 },
  label: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
});
