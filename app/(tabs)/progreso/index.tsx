import { Ionicons } from "@expo/vector-icons";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { StyleSheet, Text, View } from "react-native";

import { db } from "@/db/client";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { subtasks } from "@/db/schema/subtask";
import { tasks } from "@/db/schema/task";
import { buildProgressSummary, encouragementMessage } from "@/domain/progress";
import type { DashboardEntry } from "@/domain/dashboard";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus } from "@/domain/task-status";
import { colors, priorityColors, subjectPalette } from "@/theme";

export default function ProgresoScreen() {
  const { data: activeSemesterRows, updatedAt: semesterUpdatedAt } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;

  const { data: subjectRows, updatedAt: subjectsUpdatedAt } = useLiveQuery(
    db.select().from(subjects),
  );
  const activeSubjects = (subjectRows ?? []).filter(
    (subject) => subject.semesterId === activeSemesterId,
  );
  const activeSubjectIds = new Set(activeSubjects.map((subject) => subject.id));

  const { data: taskRows, updatedAt: tasksUpdatedAt } = useLiveQuery(db.select().from(tasks));
  const { data: subtaskRows, updatedAt: subtasksUpdatedAt } = useLiveQuery(
    db.select().from(subtasks),
  );

  const loaded =
    semesterUpdatedAt !== undefined &&
    subjectsUpdatedAt !== undefined &&
    tasksUpdatedAt !== undefined &&
    subtasksUpdatedAt !== undefined;

  const entries: DashboardEntry[] = (taskRows ?? [])
    .filter((task) => activeSubjectIds.has(task.subjectId))
    .map((task) => {
      const taskSubtasks = (subtaskRows ?? []).filter((subtask) => subtask.taskId === task.id);
      const progress = calculateTaskProgress(taskSubtasks, task.completed);
      const status = deriveTaskStatus({
        completed: task.completed,
        dueDateTime: task.dueDateTime,
        progress,
      });
      return { task, status };
    });

  const summary = buildProgressSummary(entries, activeSubjects);
  const message = encouragementMessage(summary.overallCompletionRate, summary.totalCount);

  if (!loaded) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.emptyText}>Cargando…</Text>
        </View>
      </View>
    );
  }

  // Empty state is driven by totalCount, NOT by the rate (which is always
  // a valid 0-100 number per src/domain/progress.ts's contract — never
  // NaN, never null). Showing a stat grid full of zeros when the active
  // semester genuinely has no tasks yet would be technically accurate but
  // uninviting; a single friendly message is the deliberate UI choice
  // here (confirmed with the human when approving this plan's execution).
  if (summary.totalCount === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Tu Progreso</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.emptyStateText}>Aún no hay tareas este semestre todavía.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tu Progreso</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.overallCard}>
          <Text style={styles.overallTitle}>Rendimiento General</Text>
          <Text style={styles.overallValue}>{summary.overallCompletionRate}%</Text>
          <Text style={styles.overallCaption}>tareas completadas</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${summary.overallCompletionRate}%` }]} />
          </View>
        </View>

        <View style={styles.statGrid}>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.primaryTint }]}>
                <Ionicons name="checkmark-circle-outline" size={18} color={priorityColors.Baja} />
              </View>
              <Text style={styles.statValue}>{summary.completadasCount}</Text>
              <Text style={styles.statLabel}>Completadas</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.primaryTint }]}>
                <Ionicons name="sync-outline" size={18} color={priorityColors.Media} />
              </View>
              <Text style={styles.statValue}>{summary.enProgresoCount}</Text>
              <Text style={styles.statLabel}>En progreso</Text>
            </View>
          </View>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.primaryTint }]}>
                <Ionicons name="list-outline" size={18} color={colors.primary} />
              </View>
              <Text style={styles.statValue}>{summary.pendientesCount}</Text>
              <Text style={styles.statLabel}>Pendientes</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIconCircle, { backgroundColor: colors.dangerTint }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              </View>
              <Text style={styles.statValue}>{summary.vencidasCount}</Text>
              <Text style={styles.statLabel}>Vencidas</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Desglose por Materia</Text>
          {summary.bySubject.length === 0 ? (
            <Text style={styles.emptyText}>No tienes materias con tareas registradas.</Text>
          ) : (
            <View style={styles.subjectList}>
              {summary.bySubject.map((item) => (
                <View
                  key={item.subjectId}
                  style={[
                    styles.subjectCard,
                    { borderLeftColor: subjectPalette[item.subjectColor] },
                  ]}
                >
                  <View style={styles.subjectHeaderRow}>
                    <Text style={styles.subjectName}>{item.subjectName}</Text>
                    <Text
                      style={[styles.subjectRate, { color: subjectPalette[item.subjectColor] }]}
                    >
                      {item.completionRate}%
                    </Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${item.completionRate}%`,
                          backgroundColor: subjectPalette[item.subjectColor],
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.subjectCaption}>
                    {item.completedCount} de {item.totalCount} tareas completadas
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.encouragementCard}>
          <View style={styles.encouragementIconCircle}>
            <Ionicons name="cafe-outline" size={28} color={colors.primary} />
          </View>
          <Text style={styles.encouragementText}>{message}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  emptyStateText: { color: colors.textMuted, textAlign: "center", fontSize: 15 },
  content: { padding: 20, paddingTop: 0, gap: 20 },

  overallCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: "center",
    gap: 4,
  },
  overallTitle: { fontSize: 15, fontWeight: "600", color: colors.text, alignSelf: "flex-start" },
  overallValue: { fontSize: 40, fontWeight: "700", color: colors.primary, marginTop: 8 },
  overallCaption: { fontSize: 13, color: colors.textMuted, marginBottom: 12 },

  statGrid: { gap: 10 },
  statRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 6,
  },
  statIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: { fontSize: 22, fontWeight: "700", color: colors.text },
  statLabel: { fontSize: 12, color: colors.textMuted },

  section: { gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  subjectList: { gap: 12 },
  subjectCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: 14,
    gap: 8,
  },
  subjectHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  subjectName: { fontSize: 15, fontWeight: "600", color: colors.text },
  subjectRate: { fontSize: 14, fontWeight: "700" },
  subjectCaption: { fontSize: 12, color: colors.textMuted },

  progressTrack: {
    width: "100%",
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: colors.primary },

  encouragementCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 12,
  },
  encouragementIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  encouragementText: { fontSize: 14, color: colors.text, textAlign: "center" },
});
