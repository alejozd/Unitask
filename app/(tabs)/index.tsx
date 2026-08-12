import { StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>UniTask</Text>
      <Text style={styles.subtitle}>Próximamente: resumen de tus tareas</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 14,
    color: "#64748B",
  },
});
