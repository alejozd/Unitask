import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";

import { saveProfile } from "@/db/repositories/settings";
import { colors } from "@/theme";

export default function OnboardingPerfilScreen() {
  const [nickname, setNickname] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleContinue() {
    if (saving) return;
    setSaving(true);
    try {
      await saveProfile({
        nickname: nickname.trim() || null,
        fullName: fullName.trim() || null,
      });
      router.replace("/(tabs)");
    } catch {
      setSaving(false);
      Alert.alert("Error", "No se pudo guardar el perfil. Inténtalo de nuevo.");
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>¿Cómo te llamamos?</Text>
      <Text style={styles.body}>
        Puedes cambiar esto más tarde desde Configuración. Este paso es opcional.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Apodo (ej. Ale)"
        placeholderTextColor={colors.textMuted}
        value={nickname}
        onChangeText={setNickname}
        autoFocus
      />
      <TextInput
        style={styles.input}
        placeholder="Nombre completo (opcional)"
        placeholderTextColor={colors.textMuted}
        value={fullName}
        onChangeText={setFullName}
      />
      <TouchableOpacity style={styles.button} onPress={handleContinue} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? "Guardando…" : "Continuar"}</Text>
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
    color: colors.text,
  },
  body: {
    fontSize: 15,
    color: colors.textMuted,
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: {
    color: colors.onColor,
    fontSize: 16,
    fontWeight: "600",
  },
});
