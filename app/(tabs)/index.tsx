import { Ionicons } from "@expo/vector-icons";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { db } from "@/db/client";
import { semesters } from "@/db/schema/semester";
import { settings } from "@/db/schema/settings";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { buildDashboardSummary, greetingForHour, type DashboardEntry } from "@/domain/dashboard";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus } from "@/domain/task-status";
import { colors, priorityColors, subjectPalette } from "@/theme";

// Duplicated from src/domain/dashboard.ts's private helper of the same
// name (not exported there — exporting it is Phase 7's own Task 1, a
// separate, not-yet-executed change; this task must not touch
// dashboard.ts's exports per Hard Constraint #1, so this 4-line helper is
// intentionally duplicated here rather than imported).
function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function HomeScreen() {
  // Time-derived counts (Pendientes/Hoy/Tareas urgentes/Vencida labels) go
  // stale without a recompute tick — same mechanism as tareas/index.tsx,
  // added here after Phase 6's whole-branch review flagged its initial
  // omission as an Important finding. Do not remove this.
  const [, forceStatusRecompute] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceStatusRecompute((tick) => tick + 1), 60_000);
    return () => clearInterval(id);
  }, []);

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

  const { data: profileRows } = useLiveQuery(db.select().from(settings).limit(1));
  const nickname = profileRows?.[0]?.nickname;

  const loaded =
    semesterUpdatedAt !== undefined &&
    subjectsUpdatedAt !== undefined &&
    tasksUpdatedAt !== undefined &&
    subtasksUpdatedAt !== undefined;

  // Dashboard, like Tareas and Materias, scopes to the active semester only
  // (03-business-rules.md §15 states this explicitly).
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
        completedSubtasks: taskSubtasks.filter((subtask) => subtask.completed).length,
        totalSubtasks: taskSubtasks.length,
        subject: subjectsById.get(task.subjectId),
      };
    });

  const enrichedByTaskId = new Map(enrichedTasks.map((entry) => [entry.task.id, entry]));

  const entries: DashboardEntry[] = enrichedTasks.map(({ task, status }) => ({ task, status }));
  const summary = buildDashboardSummary(entries);
  const greetingBase = greetingForHour(new Date().getHours());
  const greeting = nickname ? `${greetingBase}, ${nickname}` : greetingBase;
  const now = new Date();

  function formatDueLabel(entry: DashboardEntry): { text: string; isUrgent: boolean } {
    const time = entry.task.dueDateTime.toLocaleTimeString("es", {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (entry.status === "Vencida") {
      return { text: `Venció · ${time}`, isUrgent: true };
    }
    if (isSameCalendarDay(entry.task.dueDateTime, now)) {
      return { text: `Entrega hoy · ${time}`, isUrgent: true };
    }
    const date = entry.task.dueDateTime.toLocaleDateString("es", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    return { text: `Entrega ${date} · ${time}`, isUrgent: false };
  }

  function renderUrgentCard(entry: DashboardEntry) {
    const enriched = enrichedByTaskId.get(entry.task.id);
    const dueLabel = formatDueLabel(entry);
    return (
      <TouchableOpacity
        key={entry.task.id}
        style={styles.urgentCard}
        onPress={() => router.push(`/tarea/${entry.task.id}`)}
      >
        {enriched?.subject && (
          <View
            style={[
              styles.subjectChip,
              { backgroundColor: subjectPalette[enriched.subject.color] },
            ]}
          >
            <Text style={styles.subjectChipText}>{enriched.subject.name}</Text>
          </View>
        )}
        <Text style={styles.urgentTitle} numberOfLines={2}>
          {entry.task.title}
        </Text>
        <View style={styles.dueRow}>
          <Ionicons
            name="time-outline"
            size={14}
            color={dueLabel.isUrgent ? colors.danger : colors.textMuted}
          />
          <Text style={[styles.dueText, dueLabel.isUrgent && styles.dueTextUrgent]}>
            {dueLabel.text}
          </Text>
        </View>
        <View style={styles.priorityRow}>
          <View style={[styles.dot, { backgroundColor: priorityColors[entry.task.priority] }]} />
          <Text style={styles.priorityText}>{entry.task.priority}</Text>
        </View>
        {enriched && enriched.totalSubtasks > 0 && (
          <View style={styles.progressSection}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${enriched.progress}%` }]} />
            </View>
            <View style={styles.progressLabelRow}>
              <Text style={styles.progressLabel}>Progreso: {enriched.progress}%</Text>
              <Text style={styles.progressLabel}>
                {enriched.completedSubtasks}/{enriched.totalSubtasks} partes
              </Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  function renderProximaEntregaRow(entry: DashboardEntry) {
    const enriched = enrichedByTaskId.get(entry.task.id);
    return (
      <TouchableOpacity
        key={entry.task.id}
        style={styles.proximaRow}
        onPress={() => router.push(`/tarea/${entry.task.id}`)}
      >
        <View
          style={[
            styles.proximaIcon,
            {
              backgroundColor: enriched?.subject
                ? subjectPalette[enriched.subject.color]
                : colors.primary,
            },
          ]}
        >
          <Ionicons name="document-text-outline" size={18} color="#FFFFFF" />
        </View>
        <View style={styles.proximaBody}>
          <Text style={styles.proximaTitle} numberOfLines={2}>
            {entry.task.title}
          </Text>
          {enriched?.subject && <Text style={styles.proximaSubject}>{enriched.subject.name}</Text>}
        </View>
        <View style={styles.proximaDateBlock}>
          <Text style={styles.proximaDate}>
            {entry.task.dueDateTime.toLocaleDateString("es", { weekday: "long", day: "numeric" })}
          </Text>
          <Text style={styles.proximaTime}>
            {entry.task.dueDateTime.toLocaleTimeString("es", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.subtitle}>Estas son tus tareas pendientes.</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => router.push("/configuracion")}
          accessibilityLabel="Configuración"
        >
          <Ionicons name="settings-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {!loaded ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Cargando…</Text>
        </View>
      ) : (
        <>
          <View style={styles.kpiGrid}>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <View style={[styles.kpiIconCircle, { backgroundColor: colors.primaryTint }]}>
                  <Ionicons name="list-outline" size={18} color={colors.primary} />
                </View>
                <Text style={styles.kpiValue}>{summary.pendientesCount}</Text>
                <Text style={styles.kpiLabel}>PENDIENTES</Text>
              </View>
              <View style={[styles.kpiCard, summary.hoyCount > 0 && styles.kpiCardDanger]}>
                <View
                  style={[
                    styles.kpiIconCircle,
                    { backgroundColor: summary.hoyCount > 0 ? "#FFFFFF" : colors.dangerTint },
                  ]}
                >
                  <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                </View>
                <Text style={[styles.kpiValue, summary.hoyCount > 0 && styles.kpiValueOnDanger]}>
                  {summary.hoyCount}
                </Text>
                <Text style={[styles.kpiLabel, summary.hoyCount > 0 && styles.kpiLabelOnDanger]}>
                  HOY
                </Text>
              </View>
            </View>
            <View style={styles.kpiCardWide}>
              <View style={[styles.kpiIconCircle, { backgroundColor: colors.primaryTint }]}>
                <Ionicons name="checkmark-circle-outline" size={18} color={priorityColors.Baja} />
              </View>
              <View>
                <Text style={styles.kpiValue}>{summary.completadasUltimos7DiasCount}</Text>
                <Text style={styles.kpiLabel}>COMPLETADAS ESTA SEMANA</Text>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tareas urgentes</Text>
            </View>
            {summary.urgentEntries.length === 0 ? (
              <Text style={styles.emptyText}>Sin tareas urgentes por ahora. ¡Vas al día!</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {summary.urgentEntries.map(renderUrgentCard)}
              </ScrollView>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Próximas entregas</Text>
              <TouchableOpacity onPress={() => router.push("/tareas")}>
                <Text style={styles.sectionLink}>Ver todas</Text>
              </TouchableOpacity>
            </View>
            {summary.proximasEntregas.length === 0 ? (
              <Text style={styles.emptyText}>No tienes próximas entregas registradas.</Text>
            ) : (
              <View style={styles.verticalList}>
                {summary.proximasEntregas.map(renderProximaEntregaRow)}
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
  content: { padding: 20, gap: 24, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  headerText: { flex: 1, gap: 4 },
  settingsButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  greeting: { fontSize: 22, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 14, color: colors.textMuted },
  empty: { padding: 24, alignItems: "center" },
  emptyText: { color: colors.textMuted, textAlign: "center" },

  kpiGrid: { gap: 12 },
  kpiRow: { flexDirection: "row", gap: 12 },
  kpiCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  kpiCardDanger: { backgroundColor: colors.dangerTint, borderColor: colors.danger },
  kpiCardWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  kpiIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiValue: { fontSize: 26, fontWeight: "700", color: colors.text },
  kpiValueOnDanger: { color: colors.danger },
  kpiLabel: { fontSize: 11, fontWeight: "600", color: colors.textMuted, letterSpacing: 0.4 },
  kpiLabelOnDanger: { color: colors.danger },

  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  sectionLink: { fontSize: 13, fontWeight: "600", color: colors.primary },

  urgentCard: {
    width: 220,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
    marginRight: 12,
  },
  subjectChip: {
    alignSelf: "flex-start",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  subjectChipText: { fontSize: 11, fontWeight: "600", color: "#FFFFFF" },
  urgentTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  dueText: { fontSize: 12, color: colors.textMuted },
  dueTextUrgent: { color: colors.danger, fontWeight: "600" },
  priorityRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  priorityText: { fontSize: 12, color: colors.textMuted },
  progressSection: { gap: 4, marginTop: 4 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryTint,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3, backgroundColor: colors.primary },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between" },
  progressLabel: { fontSize: 11, color: colors.textMuted },

  verticalList: { gap: 12 },
  proximaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  proximaIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  proximaBody: { flex: 1, gap: 2 },
  proximaTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  proximaSubject: { fontSize: 12, color: colors.textMuted },
  proximaDateBlock: { alignItems: "flex-end" },
  proximaDate: { fontSize: 12, color: colors.text, textTransform: "capitalize" },
  proximaTime: { fontSize: 12, color: colors.textMuted },
});
