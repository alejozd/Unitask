import { randomUUID } from "expo-crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import { assertTaskEditable } from "@/db/repositories/task";
import type { Database } from "@/db/repositories/semester";
import { enqueueChange } from "@/lib/sync/queue";
import { subtasks, type Subtask } from "@/db/schema/subtask";

async function getSubtaskOrThrow(id: string, database: Database) {
  const rows = await database.select().from(subtasks).where(eq(subtasks.id, id)).limit(1);
  const subtask = rows[0];
  if (!subtask) throw new Error(`Subtask not found: ${id}`);
  return subtask;
}

export async function addSubtask(
  taskId: string,
  text: string,
  database: Database = defaultDb,
): Promise<Subtask> {
  await assertTaskEditable(taskId, database);

  const existing = await database
    .select({ order: subtasks.order })
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId));
  const nextOrder = existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.order)) + 1;

  const now = new Date();
  const newSubtask: typeof subtasks.$inferInsert = {
    id: randomUUID(),
    taskId,
    text,
    completed: false,
    order: nextOrder,
    createdAt: now,
    updatedAt: now,
  };
  await database.insert(subtasks).values(newSubtask);
  await enqueueChange("subtasks", newSubtask.id, "upsert", database);
  return newSubtask as Subtask;
}

export async function updateSubtaskText(
  id: string,
  text: string,
  database: Database = defaultDb,
): Promise<void> {
  const subtask = await getSubtaskOrThrow(id, database);
  await assertTaskEditable(subtask.taskId, database);
  await database.update(subtasks).set({ text, updatedAt: new Date() }).where(eq(subtasks.id, id));
  await enqueueChange("subtasks", id, "upsert", database);
}

export async function toggleSubtaskCompleted(
  id: string,
  completed: boolean,
  database: Database = defaultDb,
): Promise<void> {
  const subtask = await getSubtaskOrThrow(id, database);
  await assertTaskEditable(subtask.taskId, database);
  await database.update(subtasks).set({ completed, updatedAt: new Date() }).where(eq(subtasks.id, id));
  await enqueueChange("subtasks", id, "upsert", database);
}

export async function deleteSubtask(id: string, database: Database = defaultDb): Promise<void> {
  const subtask = await getSubtaskOrThrow(id, database);
  await assertTaskEditable(subtask.taskId, database);
  await database.delete(subtasks).where(eq(subtasks.id, id));
  await enqueueChange("subtasks", id, "delete", database);
}

/**
 * Simple adjacent-swap reordering (no drag-and-drop library in this
 * project) — moves the given subtask up or down by one position within
 * its parent task's list by swapping `order` with its neighbor. A no-op
 * if already at that end of the list.
 */
export async function moveSubtask(
  id: string,
  direction: "up" | "down",
  database: Database = defaultDb,
): Promise<void> {
  const subtask = await getSubtaskOrThrow(id, database);
  await assertTaskEditable(subtask.taskId, database);

  const siblings = (
    await database.select().from(subtasks).where(eq(subtasks.taskId, subtask.taskId))
  ).sort((a, b) => a.order - b.order);

  const currentIndex = siblings.findIndex((s) => s.id === id);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) return;

  const current = siblings[currentIndex];
  const target = siblings[targetIndex];

  const now = new Date();
  await database.transaction((tx) => {
    tx.update(subtasks).set({ order: target.order, updatedAt: now }).where(eq(subtasks.id, current.id)).run();
    tx.update(subtasks).set({ order: current.order, updatedAt: now }).where(eq(subtasks.id, target.id)).run();
  });
  await enqueueChange("subtasks", current.id, "upsert", database);
  await enqueueChange("subtasks", target.id, "upsert", database);
}
