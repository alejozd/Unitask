import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { colors } from "@/theme";
import type {
  ReminderOffsetUnit,
  ReminderSpec,
  UnscheduledReason,
} from "@/domain/reminder-scheduling";

const OFFSET_UNITS: ReminderOffsetUnit[] = ["minutes", "hours", "days"];

const OFFSET_UNIT_LABELS: Record<ReminderOffsetUnit, { singular: string; plural: string }> = {
  minutes: { singular: "minuto", plural: "minutos" },
  hours: { singular: "hora", plural: "horas" },
  days: { singular: "día", plural: "días" },
};

/**
 * Human-readable Spanish label for a reminder spec, shared by every
 * screen that lists reminders (draft or persisted).
 */
export function formatReminderSpec(spec: ReminderSpec): string {
  if (spec.kind === "fixed") {
    return spec.fixedDateTime.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
  }
  const label = OFFSET_UNIT_LABELS[spec.offsetUnit];
  const unitText = spec.offsetValue === 1 ? label.singular : label.plural;
  return `${spec.offsetValue} ${unitText} antes`;
}

const UNSCHEDULED_REASON_LABELS: Record<UnscheduledReason, string> = {
  "fire-time-in-past": "hora ya pasó",
  "permission-denied": "permiso denegado",
};

/**
 * Human-readable Spanish label for why a reminder has no OS notification
 * scheduled, shared by every screen that lists persisted reminders.
 */
export function formatUnscheduledReason(reason: UnscheduledReason): string {
  return UNSCHEDULED_REASON_LABELS[reason];
}

export interface ReminderPickerProps {
  onAdd: (spec: ReminderSpec) => void;
}

export function ReminderPicker({ onAdd }: ReminderPickerProps) {
  const [kind, setKind] = useState<"relative" | "fixed">("relative");
  const [offsetValueText, setOffsetValueText] = useState("1");
  const [offsetUnit, setOffsetUnit] = useState<ReminderOffsetUnit>("days");
  const [fixedDateTime, setFixedDateTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  function handleAdd() {
    if (kind === "relative") {
      const offsetValue = parseInt(offsetValueText, 10);
      if (!Number.isFinite(offsetValue) || offsetValue <= 0) return;
      onAdd({ kind: "relative", offsetValue, offsetUnit });
      setOffsetValueText("1");
    } else {
      onAdd({ kind: "fixed", fixedDateTime: new Date(fixedDateTime) });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.kindRow}>
        <TouchableOpacity
          style={[styles.kindChip, kind === "relative" && styles.kindChipSelected]}
          onPress={() => setKind("relative")}
        >
          <Text style={[styles.kindChipText, kind === "relative" && styles.kindChipTextSelected]}>
            Relativo
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.kindChip, kind === "fixed" && styles.kindChipSelected]}
          onPress={() => setKind("fixed")}
        >
          <Text style={[styles.kindChipText, kind === "fixed" && styles.kindChipTextSelected]}>
            Fecha fija
          </Text>
        </TouchableOpacity>
      </View>

      {kind === "relative" ? (
        <View style={styles.relativeRow}>
          <TextInput
            style={styles.offsetInput}
            value={offsetValueText}
            onChangeText={setOffsetValueText}
            keyboardType="number-pad"
          />
          <View style={styles.unitRow}>
            {OFFSET_UNITS.map((unit) => (
              <TouchableOpacity
                key={unit}
                style={[styles.unitChip, offsetUnit === unit && styles.unitChipSelected]}
                onPress={() => setOffsetUnit(unit)}
              >
                <Text
                  style={[styles.unitChipText, offsetUnit === unit && styles.unitChipTextSelected]}
                >
                  {OFFSET_UNIT_LABELS[unit].plural}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.fixedRow}>
          <TouchableOpacity style={styles.fixedButton} onPress={() => setShowDatePicker(true)}>
            <Text>
              {fixedDateTime.toLocaleDateString("es", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fixedButton} onPress={() => setShowTimePicker(true)}>
            <Text>
              {fixedDateTime.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={fixedDateTime}
              mode="date"
              display="default"
              onChange={(_event, selectedDate) => {
                setShowDatePicker(false);
                if (selectedDate) {
                  const merged = new Date(fixedDateTime);
                  merged.setFullYear(
                    selectedDate.getFullYear(),
                    selectedDate.getMonth(),
                    selectedDate.getDate(),
                  );
                  setFixedDateTime(merged);
                }
              }}
            />
          )}
          {showTimePicker && (
            <DateTimePicker
              value={fixedDateTime}
              mode="time"
              display="default"
              onChange={(_event, selectedTime) => {
                setShowTimePicker(false);
                if (selectedTime) {
                  const merged = new Date(fixedDateTime);
                  merged.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
                  setFixedDateTime(merged);
                }
              }}
            />
          )}
        </View>
      )}

      <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
        <Text style={styles.addButtonText}>Añadir recordatorio</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10, paddingVertical: 8 },
  kindRow: { flexDirection: "row", gap: 8 },
  kindChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    opacity: 0.55,
  },
  kindChipSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primaryTint,
    opacity: 1,
  },
  kindChipText: { fontSize: 13, color: colors.textMuted },
  kindChipTextSelected: { color: colors.primary, fontWeight: "600" },
  relativeRow: { gap: 8 },
  offsetInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: 80,
  },
  unitRow: { flexDirection: "row", gap: 8 },
  unitChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  unitChipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  unitChipText: { fontSize: 12, color: colors.textMuted },
  unitChipTextSelected: { color: colors.primary, fontWeight: "600" },
  fixedRow: { flexDirection: "row", gap: 8 },
  fixedButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  addButtonText: { color: colors.primary, fontWeight: "600" },
});
