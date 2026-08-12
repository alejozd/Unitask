import { z } from "zod";

import { SUBJECT_COLORS } from "@/db/schema/subject";

export const subjectFormSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio"),
  courseCode: z.string().trim().optional(),
  professorName: z.string().trim().optional(),
  color: z.enum(SUBJECT_COLORS),
});

export type SubjectFormValues = z.infer<typeof subjectFormSchema>;
