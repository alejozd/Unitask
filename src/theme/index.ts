export const colors = {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#0F172A",
  textMuted: "#64748B",
  border: "#E2E8F0",
  primary: "#6366F1",
  danger: "#EF4444",
} as const;

/**
 * Hex values for the fixed subject color palette (03-business-rules.md
 * §8) — keyed by the same enum strings stored in the `subjects.color`
 * column (src/db/schema/subject.ts SUBJECT_COLORS).
 */
export const subjectPalette: Record<string, string> = {
  indigo: "#6366F1",
  emerald: "#10B981",
  amber: "#F59E0B",
  rose: "#F43F5E",
  sky: "#0EA5E9",
  violet: "#8B5CF6",
  teal: "#14B8A6",
  fuchsia: "#EC4899",
  cyan: "#06B6D4",
  slate: "#64748B",
} as const;
