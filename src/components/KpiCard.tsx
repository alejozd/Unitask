import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors } from "@/theme";

export interface KpiCardProps {
  icon: ComponentProps<typeof Ionicons>["name"];
  iconColor: string;
  iconBackgroundColor: string;
  value: number | string;
  label: string;
  valueColor?: string;
  labelColor?: string;
  /** Lets a caller add flex/width/background overrides (e.g. a 2-up row vs. a full-width card, or a danger-tinted variant) without this component hardcoding either. */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Phase 9.5 UI-consistency pass: shared stat-card layout (icon-left +
 * value-right in row 1, label in row 2) used by the Dashboard's KPI grid
 * and the Progreso screen's stat grid — previously two separately-styled
 * implementations (Dashboard already matched this shape; Progreso's
 * stacked icon/value/label 3-row layout is migrated to match it here).
 */
export function KpiCard({
  icon,
  iconColor,
  iconBackgroundColor,
  value,
  label,
  valueColor,
  labelColor,
  containerStyle,
}: KpiCardProps) {
  return (
    <View style={[styles.card, containerStyle]}>
      <View style={styles.topRow}>
        <View style={[styles.iconCircle, { backgroundColor: iconBackgroundColor }]}>
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        <Text style={[styles.value, valueColor && { color: valueColor }]}>{value}</Text>
      </View>
      <Text style={[styles.label, labelColor && { color: labelColor }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 6,
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  value: { fontSize: 22, fontWeight: "700", color: colors.text },
  label: { fontSize: 10, fontWeight: "600", color: colors.textMuted, letterSpacing: 0.3 },
});
