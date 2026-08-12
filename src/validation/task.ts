import { z } from "zod";

export const TASK_PRIORITIES = ["Alta", "Media", "Baja"] as const;

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio"),
  description: z.string().trim().optional(),
  subjectId: z.string().min(1, "Debes elegir una materia"),
  dueDate: z.date(),
  dueTime: z.date(),
  priority: z.enum(TASK_PRIORITIES),
});

export type TaskFormValues = z.infer<typeof taskFormSchema>;

/**
 * Combines the form's separate date and time pickers into the single
 * `dueDateTime` instant every business rule operates on
 * (06-data-model.md's Task entity note). Takes the calendar date from
 * `date` and the hour/minute from `time`, zeroing seconds/ms.
 */
export function combineDateAndTime(date: Date, time: Date): Date {
  const combined = new Date(date);
  combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return combined;
}
