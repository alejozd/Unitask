import { StyleSheet, Text, View } from "react-native";

import type { SubjectColor } from "@/db/repositories/subject";
import { subjectPalette } from "@/theme";

export interface SubjectIconProps {
  name: string;
  color: SubjectColor;
  size?: number;
}

/** Max 2 uppercase letters: initials of the first 2 words, or the first 2 letters of a single-word name. */
export function subjectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Phase 9.5 UI-consistency pass: replaces the generic document-icon glyph
 * previously used for a subject's visual identity with a tinted circle
 * showing the subject's initials in its own full-saturation color —
 * same "tinted background + strong text" language already used by
 * kpiIconCircle/the calendar day-panel badge, applied per-subject.
 */
export function SubjectIcon({ name, color, size = 40 }: SubjectIconProps) {
  const hex = subjectPalette[color];
  const initials = subjectInitials(name);
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: hexToRgba(hex, 0.15),
        },
      ]}
    >
      <Text style={[styles.text, { color: hex, fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { fontWeight: "700" },
});
