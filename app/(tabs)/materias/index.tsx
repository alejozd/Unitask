import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { eq } from "drizzle-orm";
import { Link, router } from "expo-router";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { db } from "@/db/client";
import { semesters } from "@/db/schema/semester";
import { subjects } from "@/db/schema/subject";
import { colors, subjectPalette } from "@/theme";

export default function MateriasScreen() {
  const { data: activeSemesterRows } = useLiveQuery(
    db.select({ id: semesters.id }).from(semesters).where(eq(semesters.status, "active")),
  );
  const activeSemesterId = activeSemesterRows?.[0]?.id;

  // No `.orderBy()` here: SQLite's default BINARY collation sorts accented
  // characters (e.g. "Á") after unaccented later-alphabet letters (e.g.
  // "Z"), which is wrong for Spanish subject names. The repository layer
  // fixes this with `localeCompare(..., "es")`, but `useLiveQuery` needs a
  // reactive query object (Rule 1), not an async repository call — so the
  // same locale-aware sort is applied here in JS instead, after filtering.
  const { data: subjectRows } = useLiveQuery(db.select().from(subjects));
  const subjectList = (subjectRows ?? [])
    .filter((subject) => subject.semesterId === activeSemesterId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mis Materias</Text>
        {/*
          Temporary entry point to /semestres — Phase 9's Settings screen
          (gear icon) is the permanent home for this per docs/05-navigation.md;
          until then, Materias is the most relevant screen to surface it from,
          since semester context directly affects what's shown here.
        */}
        <Link href="/semestres" asChild>
          <TouchableOpacity>
            <Text style={styles.semestresLink}>Semestres</Text>
          </TouchableOpacity>
        </Link>
      </View>

      {subjectList.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Aún no tienes materias. Crea la primera.</Text>
        </View>
      ) : (
        <FlatList
          data={subjectList}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/materia/${item.id}`)}
            >
              <View style={[styles.colorDot, { backgroundColor: subjectPalette[item.color] }]} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                {item.courseCode ? (
                  <Text style={styles.cardSubtitle}>{item.courseCode}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <Link href="/materia/nueva" asChild>
        <TouchableOpacity style={styles.fab}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  semestresLink: { color: colors.primary, fontSize: 14, fontWeight: "600" },
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
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  cardSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
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
  fabText: { color: colors.onColor, fontSize: 28, lineHeight: 30 },
});
