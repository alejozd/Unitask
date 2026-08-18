import { useEffect, useState } from "react";
import { router } from "expo-router";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import Constants from "expo-constants";

import { getProfile, saveProfile } from "@/db/repositories/settings";
import { exportBackupJson, importBackup } from "@/db/repositories/backup";
import { parseBackupFile, type BackupTables } from "@/domain/backup";
import { colors } from "@/theme";

export default function ConfiguracionScreen() {
  const [nickname, setNickname] = useState("");
  const [fullName, setFullName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

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

  async function handleExport() {
    setExporting(true);
    try {
      const json = await exportBackupJson();
      const file = new File(Paths.cache, `unitask-backup-${Date.now()}.json`);
      file.create();
      file.write(json);
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(file.uri, { mimeType: "application/json" });
      }
    } catch {
      Alert.alert("Error", "No se pudo exportar los datos.");
    } finally {
      setExporting(false);
    }
  }

  function reasonMessage(reason: "not-json" | "unsupported-version" | "wrong-shape"): string {
    switch (reason) {
      case "not-json":
        return "El archivo no es un JSON válido.";
      case "unsupported-version":
        return "Este archivo no es una copia de seguridad de UniTask compatible.";
      case "wrong-shape":
        return "El archivo no tiene el formato esperado de una copia de seguridad de UniTask.";
    }
  }

  async function handleImportPress() {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/json",
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    let parsed: ReturnType<typeof parseBackupFile>;
    try {
      const jsonText = await new File(asset.uri).text();
      parsed = parseBackupFile(jsonText);
    } catch {
      Alert.alert("Archivo inválido", "No se pudo leer el archivo seleccionado.");
      return;
    }
    if (!parsed.valid) {
      Alert.alert("Archivo inválido", reasonMessage(parsed.reason));
      return;
    }

    Alert.alert(
      "¿Reemplazar todos los datos?",
      "Esta acción reemplazará TODOS los datos actuales y no se puede deshacer. Los archivos adjuntos no se restauran, solo su información.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Reemplazar", style: "destructive", onPress: () => runImport(parsed.data) },
      ],
    );
  }

  async function runImport(data: BackupTables) {
    setImporting(true);
    try {
      const result = await importBackup(data);
      Alert.alert(
        "Datos importados",
        result.remindersUnscheduled > 0
          ? `${result.remindersScheduled} recordatorio(s) reprogramado(s). ${result.remindersUnscheduled} no se pudieron reprogramar (permiso de notificaciones).`
          : `${result.remindersScheduled} recordatorio(s) reprogramado(s).`,
        [{ text: "OK", onPress: () => router.replace("/(tabs)") }],
      );
    } catch {
      Alert.alert("Error", "No se pudo importar los datos.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
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
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.label}>Nombre completo</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Ej. Alejandro Díaz"
            placeholderTextColor={colors.textMuted}
          />
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
          </TouchableOpacity>

          <View style={styles.dataSection}>
            <Text style={styles.sectionTitle}>Datos</Text>
            <Text style={styles.sectionNote}>
              Los archivos adjuntos no se incluyen en la exportación, solo su información.
            </Text>
            <TouchableOpacity
              style={[styles.secondaryButton, exporting && styles.saveButtonDisabled]}
              onPress={handleExport}
              disabled={exporting || importing}
            >
              <Text style={styles.secondaryButtonText}>
                {exporting ? "Exportando…" : "Exportar datos"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, importing && styles.saveButtonDisabled]}
              onPress={handleImportPress}
              disabled={exporting || importing}
            >
              <Text style={styles.secondaryButtonText}>
                {importing ? "Importando…" : "Importar datos"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.dataSection}>
            <Text style={styles.sectionTitle}>Acerca de</Text>
            <Text style={styles.sectionNote}>UniTask v{Constants.expoConfig?.version ?? "—"}</Text>
          </View>
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
  saveButtonText: { color: colors.onColor, fontSize: 16, fontWeight: "600" },
  dataSection: {
    gap: 8,
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  sectionNote: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
});
