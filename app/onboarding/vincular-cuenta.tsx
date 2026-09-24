import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { getActiveSemester } from "@/db/repositories/semester";
import { isLoggedIn, login, restoreSession } from "@/lib/sync/client";
import { runSync } from "@/lib/sync";
import { colors } from "@/theme";

// A release build swallows uncaught errors silently — surfacing the real
// message here (instead of a static string) is the only way to diagnose a
// sync failure on-device without attaching Metro/logcat.
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function VincularCuentaScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkingExistingSession, setCheckingExistingSession] = useState(true);

  // Covers a device that already linked a sync account but lands back on
  // this screen with no active semester (e.g. its only semester was just
  // deleted) — silently retries the sync instead of forcing the user to
  // type their email/password again for a session that's still valid.
  useEffect(() => {
    let cancelled = false;
    async function attemptAutoSync() {
      if (!isLoggedIn()) {
        const restored = await restoreSession();
        if (!restored) {
          if (!cancelled) setCheckingExistingSession(false);
          return;
        }
      }
      try {
        await runSync();
        if (cancelled) return;
        const active = await getActiveSemester();
        if (!active) {
          // Leaving this screen either way — no need to stop showing the
          // spinner first, that would just flash the login form for a
          // frame before the navigation lands.
          router.replace("/onboarding/primer-semestre");
          return;
        }
        // An active semester was pulled: stay on the spinner and let
        // app/_layout.tsx's own effect navigate away once its live query
        // reflects it, instead of flashing the login form in the meantime.
      } catch {
        // Best-effort background attempt — fall through to the manual form
        // silently, no alert for something the user didn't initiate.
        if (!cancelled) setCheckingExistingSession(false);
      }
    }
    attemptAutoSync();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert("Datos incompletos", "Ingresá tu email y contraseña.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      await runSync();
      const active = await getActiveSemester();
      // Deliberately no navigation to /(tabs) or /onboarding/perfil here
      // even when an active semester was pulled: app/_layout.tsx's redirect
      // effect owns that transition once its own live query reflects the
      // write, the same race-free pattern primer-semestre.tsx already
      // relies on — see that effect's comment. Only the "nothing to pull"
      // fallback below needs an explicit navigation, since there's no
      // semester write for that effect to react to.
      if (!active) {
        router.replace("/onboarding/primer-semestre");
      }
    } catch (error) {
      setSubmitting(false);
      Alert.alert("No se pudo iniciar sesión", describeError(error));
    }
  }

  function handleSkip() {
    router.replace("/onboarding/primer-semestre");
  }

  if (checkingExistingSession) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenido a UniTask</Text>
      <Text style={styles.body}>
        ¿Ya usás UniTask en otro dispositivo? Iniciá sesión para traer tus materias y tareas.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoFocus
      />
      <View style={styles.passwordFieldWrapper}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder="Contraseña"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={() => setShowPassword((prev) => !prev)}
          hitSlop={8}
        >
          <Ionicons
            name={showPassword ? "eye-off-outline" : "eye-outline"}
            size={20}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={colors.onColor} />
        ) : (
          <Text style={styles.buttonText}>Iniciar sesión y sincronizar</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.skipButton} onPress={handleSkip} disabled={submitting}>
        <Text style={styles.skipButtonText}>No tengo cuenta, empezar de cero</Text>
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
    // Explicit color + backgroundColor — without both set, Android's
    // "Forzar oscuro" (Force dark) system feature can repaint a masked
    // password field's dot glyph to match its own repainted background,
    // making typed characters invisible even though the same style's
    // plain-text fields render fine.
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
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.onColor,
    fontSize: 16,
    fontWeight: "600",
  },
  skipButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
  skipButtonText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
});
