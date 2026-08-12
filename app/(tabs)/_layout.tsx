import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="tareas/index" options={{ title: "Tareas" }} />
      <Tabs.Screen name="calendario/index" options={{ title: "Calendario" }} />
      <Tabs.Screen name="materias/index" options={{ title: "Materias" }} />
      <Tabs.Screen name="progreso/index" options={{ title: "Progreso" }} />
    </Tabs>
  );
}
