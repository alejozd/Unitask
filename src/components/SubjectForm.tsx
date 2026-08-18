import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { SUBJECT_COLORS } from "@/db/schema/subject";
import { colors, subjectPalette } from "@/theme";
import { subjectFormSchema, type SubjectFormValues } from "@/validation/subject";

interface SubjectFormProps {
  initialValues?: Partial<SubjectFormValues>;
  submitLabel: string;
  onSubmit: (values: SubjectFormValues) => Promise<void>;
}

export function SubjectForm({ initialValues, submitLabel, onSubmit }: SubjectFormProps) {
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SubjectFormValues>({
    resolver: zodResolver(subjectFormSchema),
    defaultValues: {
      name: initialValues?.name ?? "",
      courseCode: initialValues?.courseCode ?? "",
      professorName: initialValues?.professorName ?? "",
      color: initialValues?.color ?? SUBJECT_COLORS[0],
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Nombre</Text>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="Ej. Cálculo II"
            placeholderTextColor={colors.textMuted}
          />
        )}
      />
      {errors.name && <Text style={styles.error}>{errors.name.message}</Text>}

      <Text style={styles.label}>Código (opcional)</Text>
      <Controller
        control={control}
        name="courseCode"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="Ej. MAT-201"
            placeholderTextColor={colors.textMuted}
          />
        )}
      />

      <Text style={styles.label}>Profesor (opcional)</Text>
      <Controller
        control={control}
        name="professorName"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            placeholder="Ej. Dra. García"
            placeholderTextColor={colors.textMuted}
          />
        )}
      />

      <Text style={styles.label}>Color</Text>
      <Controller
        control={control}
        name="color"
        render={({ field }) => (
          <View style={styles.colorRow}>
            {SUBJECT_COLORS.map((colorKey) => (
              <TouchableOpacity
                key={colorKey}
                accessibilityLabel={colorKey}
                onPress={() => field.onChange(colorKey)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: subjectPalette[colorKey] },
                  field.value === colorKey && styles.colorSwatchSelected,
                ]}
              />
            ))}
          </View>
        )}
      />

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
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingVertical: 8,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  colorSwatchSelected: {
    borderWidth: 3,
    borderColor: colors.text,
  },
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
