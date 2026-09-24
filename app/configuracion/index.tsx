import { useEffect, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import * as IntentLauncher from "expo-intent-launcher";
import { File, Paths } from "expo-file-system";
import Constants from "expo-constants";

import { getProfile, saveProfile } from "@/db/repositories/settings";
import { exportBackupJson, importBackup } from "@/db/repositories/backup";
import { parseBackupFile, type BackupTables } from "@/domain/backup";
import { register, login, logout, isLoggedIn, restoreSession } from "@/lib/sync/client";
import { runSync, enqueueEverythingForInitialPush, SyncNotConfiguredError } from "@/lib/sync";
import { colors } from "@/theme";

// A release build swallows uncaught errors silently — surfacing the real
// message here (instead of a static string) is the only way to diagnose a
// sync failure on-device without attaching Metro/logcat.
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function ConfiguracionScreen() {
  const [nickname, setNickname] = useState("");
  const [fullName, setFullName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncEmail, setSyncEmail] = useState("");
  const [syncPassword, setSyncPassword] = useState("");
  const [showSyncPassword, setShowSyncPassword] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncLoggedIn, setSyncLoggedIn] = useState(() => isLoggedIn());
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

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

  useEffect(() => {
    // `isLoggedIn()` only reflects the in-memory access token, which starts
    // out empty on every fresh app process — the refresh token in
    // SecureStore is what actually survives across app restarts/screen
    // visits. Without this, the screen shows the login form even when the
    // session is really still valid, forcing the user to re-enter their
    // credentials every time.
    if (isLoggedIn()) return;
    let cancelled = false;
    restoreSession().then((restored) => {
      if (!cancelled && restored) setSyncLoggedIn(true);
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

  async function handleSyncAuth(mode: "login" | "register") {
    if (!syncEmail.trim() || !syncPassword) {
      Alert.alert("Datos incompletos", "Ingresá un email y una contraseña.");
      return;
    }
    setSyncing(true);
    try {
      if (mode === "register") {
        await register(syncEmail.trim(), syncPassword);
      }
      await login(syncEmail.trim(), syncPassword);
      await enqueueEverythingForInitialPush();
      setSyncLoggedIn(true);
      setSyncPassword("");
      setSyncStatus("Cuenta vinculada. Sincronizando…");
      await handleSyncNow();
    } catch (error) {
      Alert.alert("Error", `No se pudo iniciar sesión de sincronización: ${describeError(error)}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const result = await runSync();
      setSyncStatus(
        `Última sincronización: ${new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })} · ${result.pulled} cambio(s) recibido(s), ${result.pushed} enviado(s).`,
      );
    } catch (error) {
      if (error instanceof SyncNotConfiguredError) {
        setSyncLoggedIn(false);
        setSyncStatus(null);
      } else {
        setSyncStatus(
          `No se pudo sincronizar (${describeError(error)}). Se reintentará automáticamente.`,
        );
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncLogout() {
    setSyncing(true);
    try {
      await logout();
      setSyncLoggedIn(false);
      setSyncStatus(null);
    } finally {
      setSyncing(false);
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

  // Phase 10.6: neither settings screen can be opened without knowing the
  // app's own package name — read from app.json via expo-constants (already
  // used above for the version string), not hardcoded, so it stays correct
  // if the package id ever changes.
  const androidPackage = Constants.expoConfig?.android?.package;

  async function handleOpenExactAlarmSettings() {
    try {
      await IntentLauncher.startActivityAsync(
        "android.settings.REQUEST_SCHEDULE_EXACT_ALARM",
        androidPackage ? { data: `package:${androidPackage}` } : undefined,
      );
    } catch {
      Alert.alert("No disponible", "Tu dispositivo no permite abrir esta pantalla de ajustes.");
    }
  }

  async function handleOpenBatteryOptimizationSettings() {
    // Unlike the exact-alarm screen above, Android requires this intent's
    // data URI to specify the target package — there is no "show it for the
    // current app" fallback, so without a resolvable package id there's
    // nothing valid to launch.
    if (!androidPackage) {
      Alert.alert("No disponible", "No se pudo determinar el paquete de la app.");
      return;
    }
    try {
      await IntentLauncher.startActivityAsync(
        "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
        { data: `package:${androidPackage}` },
      );
    } catch {
      Alert.alert("No disponible", "Tu dispositivo no permite abrir esta pantalla de ajustes.");
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
        <ScrollView contentContainerStyle={styles.form}>
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
            <Text style={styles.sectionTitle}>Sincronizar</Text>
            {syncLoggedIn ? (
              <>
                <Text style={styles.sectionNote}>
                  {syncStatus ?? "Cuenta vinculada. Sincroniza automáticamente cada 10 minutos."}
                </Text>
                <TouchableOpacity
                  style={[styles.secondaryButton, syncing && styles.saveButtonDisabled]}
                  onPress={handleSyncNow}
                  disabled={syncing}
                >
                  {syncing ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Text style={styles.secondaryButtonText}>Sincronizar ahora</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryButton, syncing && styles.saveButtonDisabled]}
                  onPress={handleSyncLogout}
                  disabled={syncing}
                >
                  <Text style={styles.secondaryButtonText}>Cerrar sesión de sincronización</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.sectionNote}>
                  Vinculá una cuenta para compartir tus datos entre dispositivos.
                </Text>
                <TextInput
                  style={styles.input}
                  value={syncEmail}
                  onChangeText={setSyncEmail}
                  placeholder="Email"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <View style={styles.passwordFieldWrapper}>
                  <TextInput
                    style={[styles.input, styles.passwordInput]}
                    value={syncPassword}
                    onChangeText={setSyncPassword}
                    placeholder="Contraseña"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!showSyncPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowSyncPassword((prev) => !prev)}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={showSyncPassword ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[styles.secondaryButton, syncing && styles.saveButtonDisabled]}
                  onPress={() => handleSyncAuth("login")}
                  disabled={syncing}
                >
                  {syncing ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Text style={styles.secondaryButtonText}>Iniciar sesión</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryButton, syncing && styles.saveButtonDisabled]}
                  onPress={() => handleSyncAuth("register")}
                  disabled={syncing}
                >
                  {syncing ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Text style={styles.secondaryButtonText}>Crear cuenta</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>

          <View style={styles.dataSection}>
            <Text style={styles.sectionTitle}>Puntualidad</Text>
            <Text style={styles.sectionNote}>
              Android puede retrasar los recordatorios con poca antelación (menos de 5 minutos) para
              ahorrar batería. Activa estas opciones para recibirlos a tiempo.
            </Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleOpenExactAlarmSettings}>
              <Text style={styles.secondaryButtonText}>Activar alarmas exactas</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleOpenBatteryOptimizationSettings}
            >
              <Text style={styles.secondaryButtonText}>Excluir de optimización de batería</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.dataSection}>
            <Text style={styles.sectionTitle}>Acerca de</Text>
            <Text style={styles.sectionNote}>UniTask v{Constants.expoConfig?.version ?? "—"}</Text>
          </View>
        </ScrollView>
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
    // Explicit color + backgroundColor — without both set, Android's
    // "Forzar oscuro" (Force dark) system feature can repaint a masked
    // password field's dot glyph to match its own repainted background,
    // making typed characters invisible even though the same style's
    // plain-text fields (nickname/email) render fine. Setting both here
    // opts every input using this style out of that repainting.
    color: colors.text,
    backgroundColor: colors.surface,
  },
  passwordFieldWrapper: {
    justifyContent: "center",
  },
  passwordInput: {
    paddingRight: 44,
  },
  eyeButton: {
    position: "absolute",
    right: 12,
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
