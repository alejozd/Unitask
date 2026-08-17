import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { db } from "@/db/client";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { buildDashboardSummary, greetingForHour, type DashboardEntry } from "@/domain/dashboard";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus } from "@/domain/task-status";
import { colors, priorityColors, subjectPalette } from "@/theme";

export default function HomeScreen() {
  const { data: activeSemesterRows, updatedAt: semesterUpdatedAt } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;

  const { data: subjectRows, updatedAt: subjectsUpdatedAt } = useLiveQuery(
    db.select().from(subjects),
  );
  const activeSubjectIds = new Set(
    (subjectRows ?? [])
      .filter((subject) => subject.semesterId === activeSemesterId)
      .map((subject) => subject.id),
  );
  const subjectsById = new Map((subjectRows ?? []).map((subject) => [subject.id, subject]));

  const { data: taskRows, updatedAt: tasksUpdatedAt } = useLiveQuery(db.select().from(tasks));
  const { data: subtaskRows, updatedAt: subtasksUpdatedAt } = useLiveQuery(
    db.select().from(subtasks),
  );

  // Same `updatedAt !== undefined` pattern as tareas/index.tsx — all 4
  // queries must have resolved at least once before the dashboard's counts
  // are meaningful; otherwise a fresh mount would briefly show "0 tareas"
  // before the live queries settle.
  const loaded =
    semesterUpdatedAt !== undefined &&
    subjectsUpdatedAt !== undefined &&
    tasksUpdatedAt !== undefined &&
    subtasksUpdatedAt !== undefined;

  // Dashboard, like Tareas and Materias, scopes to the active semester only
  // (03-business-rules.md §15 states this explicitly) — a closed semester's
  // tasks are historical/read-only and not part of "what do I have to do".
  const enrichedTasks = (taskRows ?? [])
    .filter((task) => activeSubjectIds.has(task.subjectId))
    .map((task) => {
      const taskSubtasks = (subtaskRows ?? []).filter((subtask) => subtask.taskId === task.id);
      const progress = calculateTaskProgress(taskSubtasks, task.completed);
      const status = deriveTaskStatus({
        completed: task.completed,
        dueDateTime: task.dueDateTime,
        progress,
      });
      return {
        task,
        status,
        progress,
        subject: subjectsById.get(task.subjectId),
      };
    })
    .sort((a, b) => a.task.dueDateTime.getTime() - b.task.dueDateTime.getTime());

  const entries: DashboardEntry[] = enrichedTasks.map(({ task, status }) => ({ task, status }));
  const summary = buildDashboardSummary(entries);
  const greeting = greetingForHour(new Date().getHours());

  function renderEntry(entry: DashboardEntry, withDueDate: boolean) {
    const subject = subjectsById.get(entry.task.subjectId);
    return (
      <TouchableOpacity
        key={entry.task.id}
        style={withDueDate ? styles.listCard : styles.horizontalCard}
        onPress={() => router.push(`/tarea/${entry.task.id}`)}
      >
        <Text style={styles.cardTitle} numberOfLines={2}>
          {entry.task.title}
        </Text>
        <View style={styles.cardMetaRow}>
          {subject && (
            <View style={styles.metaChip}>
              <View style={[styles.dot, { backgroundColor: subjectPalette[subject.color] }]} />
              <Text style={styles.metaText}>{subject.name}</Text>
            </View>
          )}
          <View style={styles.metaChip}>
            <View style={[styles.dot, { backgroundColor: priorityColors[entry.task.priority] }]} />
            <Text style={styles.metaText}>{entry.task.priority}</Text>
          </View>
        </View>
        {withDueDate && (
          <Text style={styles.dueDateText}>
            {entry.task.dueDateTime.toLocaleString("es", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.greeting}>{greeting}</Text>
        <Text style={styles.title}>UniTask</Text>
      </View>

      {!loaded ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Cargando…</Text>
        </View>
      ) : (
        <>
          <View style={styles.statsRow}>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{summary.pendientesCount}</Text>
              <Text style={styles.statLabel}>Pendientes</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{summary.hoyCount}</Text>
              <Text style={styles.statLabel}>Hoy</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{summary.completadasUltimos7DiasCount}</Text>
              <Text style={styles.statLabel}>Completadas últimos 7 días</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tareas urgentes</Text>
            {summary.urgentEntries.length === 0 ? (
              <Text style={styles.emptyText}>No hay tareas urgentes.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {summary.urgentEntries.map((entry) => renderEntry(entry, false))}
              </ScrollView>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Próximas entregas</Text>
            {summary.proximasEntregas.length === 0 ? (
              <Text style={styles.emptyText}>No tienes próximas entregas.</Text>
            ) : (
              <View style={styles.verticalList}>
                {summary.proximasEntregas.map((entry) => renderEntry(entry, true))}
              </View>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 20, paddingBottom: 40 },
  header: { gap: 2 },
  greeting: { fontSize: 15, color: colors.textMuted },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  empty: { padding: 24, alignItems: "center" },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  statsRow: { flexDirection: "row", gap: 12 },
  statTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  statValue: { fontSize: 22, fontWeight: "700", color: colors.text },
  statLabel: { fontSize: 12, color: colors.textMuted, textAlign: "center" },
  section: { gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  horizontalCard: {
    width: 200,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
    marginRight: 12,
  },
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  verticalList: { gap: 12 },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  cardMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metaText: { fontSize: 12, color: colors.textMuted },
  dueDateText: { fontSize: 12, color: colors.textMuted },
});
