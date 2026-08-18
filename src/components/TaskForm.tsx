import { zodResolver } from "@hookform/resolvers/zod";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Controller, useForm } from "react-hook-form";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, priorityColors, subjectPalette } from "@/theme";
import { TASK_PRIORITIES, taskFormSchema, type TaskFormValues } from "@/validation/task";
import type { SubjectColor } from "@/db/repositories/subject";

export interface TaskFormSubjectOption {
  id: string;
  name: string;
  color: SubjectColor;
}

interface TaskFormProps {
  subjects: TaskFormSubjectOption[];
  initialValues?: Partial<TaskFormValues>;
  submitLabel: string;
  onSubmit: (values: TaskFormValues) => Promise<void>;
  /** Extra content rendered inside the scroll area, after Priority and before the submit button. */
  footer?: ReactNode;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("es", { year: "numeric", month: "long", day: "numeric" });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export function TaskForm({
  subjects,
  initialValues,
  submitLabel,
  onSubmit,
  footer,
}: TaskFormProps) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: initialValues?.title ?? "",
      description: initialValues?.description ?? "",
      subjectId: initialValues?.subjectId ?? "",
      dueDate: initialValues?.dueDate ?? new Date(),
      dueTime: initialValues?.dueTime ?? new Date(),
      priority: initialValues?.priority ?? "Media",
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Título</Text>
      <Controller
        control={control}
        name="title"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="Ej. Entregar ensayo final"
          />
        )}
      />
      {errors.title && <Text style={styles.error}>{errors.title.message}</Text>}

      <Text style={styles.label}>Descripción (opcional)</Text>
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <TextInput
            style={[styles.input, styles.multiline]}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="Detalles adicionales"
            multiline
          />
        )}
      />

      <Text style={styles.label}>Materia</Text>
      <Controller
        control={control}
        name="subjectId"
        render={({ field }) => (
          <View style={styles.subjectRow}>
            {subjects.map((subject) => (
              <TouchableOpacity
                key={subject.id}
                onPress={() => field.onChange(subject.id)}
                style={[
                  styles.subjectChip,
                  field.value === subject.id && styles.subjectChipSelected,
                ]}
              >
                <View
                  style={[styles.subjectDot, { backgroundColor: subjectPalette[subject.color] }]}
                />
                <Text style={styles.subjectChipText}>{subject.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      />
      {errors.subjectId && <Text style={styles.error}>{errors.subjectId.message}</Text>}

      <Text style={styles.label}>Fecha límite</Text>
      <Controller
        control={control}
        name="dueDate"
        render={({ field }) => (
          <>
            <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
              <Text>{formatDate(field.value)}</Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={field.value}
                mode="date"
                display="default"
                onValueChange={(_event, selectedDate) => {
                  setShowDatePicker(false);
                  field.onChange(selectedDate);
                }}
                onDismiss={() => setShowDatePicker(false)}
              />
            )}
          </>
        )}
      />

      <Text style={styles.label}>Hora límite</Text>
      <Controller
        control={control}
        name="dueTime"
        render={({ field }) => (
          <>
            <TouchableOpacity style={styles.input} onPress={() => setShowTimePicker(true)}>
              <Text>{formatTime(field.value)}</Text>
            </TouchableOpacity>
            {showTimePicker && (
              <DateTimePicker
                value={field.value}
                mode="time"
                display="default"
                onValueChange={(_event, selectedTime) => {
                  setShowTimePicker(false);
                  field.onChange(selectedTime);
                }}
                onDismiss={() => setShowTimePicker(false)}
              />
            )}
          </>
        )}
      />

      <Text style={styles.label}>Prioridad</Text>
      <Controller
        control={control}
        name="priority"
        render={({ field }) => (
          <View style={styles.priorityRow}>
            {TASK_PRIORITIES.map((priority) => (
              <TouchableOpacity
                key={priority}
                onPress={() => field.onChange(priority)}
                style={[
                  styles.priorityChip,
                  { borderColor: priorityColors[priority] },
                  field.value === priority && {
                    backgroundColor: priorityColors[priority],
                  },
                ]}
              >
                <Text
                  style={[
                    styles.priorityChipText,
                    field.value === priority
                      ? styles.priorityChipTextSelected
                      : { color: priorityColors[priority] },
                  ]}
                >
                  {priority}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      />

      {footer}

      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        onPress={handleSubmit(onSubmit)}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color={colors.onColor} />
        ) : (
          <Text style={styles.submitButtonText}>{submitLabel}</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  subjectRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 8,
  },
  subjectChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    opacity: 0.55,
  },
  subjectChipSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primaryTint,
    opacity: 1,
  },
  subjectDot: { width: 10, height: 10, borderRadius: 5 },
  subjectChipText: { fontSize: 14, color: colors.text },
  priorityRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 8,
  },
  priorityChip: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  priorityChipText: { fontSize: 14, fontWeight: "600" },
  priorityChipTextSelected: { color: colors.onColor },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.onColor,
    fontSize: 16,
    fontWeight: "600",
  },
});
