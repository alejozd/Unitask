import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { db } from "@/db/client";
import { SemesterReadOnlyError } from "@/db/repositories/subject";
import { completeTaskAction } from "@/db/repositories/task";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { tasks } from "@/db/schema/task";
import { subtasks } from "@/db/schema/subtask";
import { attachments } from "@/db/schema/attachment";
import { calculateTaskProgress } from "@/domain/task-progress";
import { deriveTaskStatus, type TaskStatus } from "@/domain/task-status";
import { colors, priorityColors, subjectPalette } from "@/theme";

type FilterChip = "Todas" | TaskStatus;

const FILTER_CHIPS: FilterChip[] = ["Todas", "Pendiente", "En progreso", "Completada", "Vencida"];

export default function TareasScreen() {
  const [filter, setFilter] = useState<FilterChip>("Todas");
  const [completingId, setCompletingId] = useState<string | null>(null);

  // Status (Pendiente/En progreso/Vencida) is derived from the current time
  // at render, never stored — without this tick, a task sitting past its
  // due date keeps showing its stale status until something else (e.g. a
  // live query result) forces a re-render.
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
  const { data: attachmentRows, updatedAt: attachmentsUpdatedAt } = useLiveQuery(
    db.select().from(attachments),
  );

  // Same `updatedAt !== undefined` pattern as app/_layout.tsx — all 5
  // queries must have resolved at least once before "no tasks match this
  // filter" is a meaningful statement; otherwise the empty-filter message
  // flashes on every fresh mount before the live queries settle.
  const loaded =
    semesterUpdatedAt !== undefined &&
    subjectsUpdatedAt !== undefined &&
    tasksUpdatedAt !== undefined &&
    subtasksUpdatedAt !== undefined &&
    attachmentsUpdatedAt !== undefined;

  // Tareas, like Materias, scopes to the active semester only — a closed
  // semester's tasks are historical/read-only and not part of "what do I
  // have to do" (same reasoning 03-business-rules.md §15 states explicitly
  // for the Dashboard's scope).
  const attachmentCountByTaskId = new Map<string, number>();
  for (const attachment of attachmentRows ?? []) {
    attachmentCountByTaskId.set(
      attachment.taskId,
      (attachmentCountByTaskId.get(attachment.taskId) ?? 0) + 1,
    );
  }

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
        attachmentCount: attachmentCountByTaskId.get(task.id) ?? 0,
      };
    })
    .sort((a, b) => a.task.dueDateTime.getTime() - b.task.dueDateTime.getTime());

  const visibleTasks =
    filter === "Todas" ? enrichedTasks : enrichedTasks.filter((entry) => entry.status === filter);

  async function handleQuickComplete(taskId: string) {
    setCompletingId(taskId);
    try {
      await completeTaskAction(taskId);
    } catch (error) {
      if (error instanceof SemesterReadOnlyError) {
        Alert.alert("Semestre cerrado", "Este semestre está cerrado y no se puede completar.");
      } else {
        Alert.alert("Error", "No se pudo completar la tarea.");
      }
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mis Tareas</Text>
      </View>

      <View style={styles.chipsRow}>
        {FILTER_CHIPS.map((chip) => (
          <TouchableOpacity
            key={chip}
            style={[styles.chip, filter === chip && styles.chipSelected]}
            onPress={() => setFilter(chip)}
          >
            <Text style={[styles.chipText, filter === chip && styles.chipTextSelected]}>
              {chip}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!loaded ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Cargando…</Text>
        </View>
      ) : visibleTasks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No hay tareas en este filtro.</Text>
        </View>
      ) : (
        <FlatList
          data={visibleTasks}
          keyExtractor={(entry) => entry.task.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/tarea/${item.task.id}`)}
            >
              <TouchableOpacity
                style={styles.checkbox}
                disabled={item.task.completed || completingId === item.task.id}
                onPress={() => handleQuickComplete(item.task.id)}
              >
                <Text style={styles.checkboxText}>{item.task.completed ? "✓" : "○"}</Text>
              </TouchableOpacity>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.task.title}</Text>
                <View style={styles.cardMetaRow}>
                  {item.subject && (
                    <View style={styles.metaChip}>
                      <View
                        style={[
                          styles.subjectDot,
                          { backgroundColor: subjectPalette[item.subject.color] },
                        ]}
                      />
                      <Text style={styles.metaText}>{item.subject.name}</Text>
                    </View>
                  )}
                  <View style={styles.metaChip}>
                    <View
                      style={[
                        styles.priorityDot,
                        { backgroundColor: priorityColors[item.task.priority] },
                      ]}
                    />
                    <Text style={styles.metaText}>{item.task.priority}</Text>
                  </View>
                  {item.attachmentCount > 0 && (
                    <View style={styles.metaChip}>
                      <Text style={styles.metaText}>📎 {item.attachmentCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cardStatus}>
                  {item.status} · {item.progress}%
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <Link href="/tarea/nueva" asChild>
        <TouchableOpacity style={styles.fab}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textMuted },
  chipTextSelected: { color: "#FFFFFF", fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  list: { paddingHorizontal: 20, paddingBottom: 96, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxText: { fontSize: 16, color: colors.primary, fontWeight: "700" },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  cardMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  subjectDot: { width: 8, height: 8, borderRadius: 4 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  metaText: { fontSize: 12, color: colors.textMuted },
  cardStatus: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  fabText: { color: "#FFFFFF", fontSize: 28, lineHeight: 30 },
});
