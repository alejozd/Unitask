import { SUBJECT_COLORS } from "@/db/schema/subject";

export const colors = {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#0F172A",
  textMuted: "#64748B",
  border: "#E2E8F0",
  primary: "#6366F1",
  primaryTint: "rgba(99, 102, 241, 0.12)",
  danger: "#EF4444",
  dangerTint: "rgba(239, 68, 68, 0.12)",
  // Text/icon color for content that sits ON a saturated background
  // (primary buttons, FABs, selected states) — deliberately kept distinct
  // from `surface` even though both are currently "#FFFFFF": a future
  // dark theme could change `surface` without needing on-primary text to
  // follow (Phase 10's theming-cleanup pass).
  onColor: "#FFFFFF",
} as const;

/**
 * Hex values for the fixed subject color palette (03-business-rules.md
 * §8) — keyed by the same enum strings stored in the `subjects.color`
 * column (src/db/schema/subject.ts SUBJECT_COLORS).
 */
export const subjectPalette: Record<(typeof SUBJECT_COLORS)[number], string> = {
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
};

/**
 * Task priority stripe/dot colors (03-business-rules.md, 06-data-model.md):
 * High reuses `colors.danger` (the same red), Medium/Low are distinct from
 * every subject-palette hue so a student never confuses "this task's
 * priority" with "this subject's color" at a glance.
 */
export const priorityColors: Record<"Alta" | "Media" | "Baja", string> = {
  Alta: colors.danger,
  Media: "#F59E0B",
  Baja: "#10B981",
};
