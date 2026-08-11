import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

describe("schema migrations", () => {
  it("apply cleanly to a fresh SQLite database and create every table", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);

    migrate(db, { migrationsFolder: "src/db/migrations" });

    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tableNames).toEqual([
      "__drizzle_migrations",
      "attachments",
      "reminders",
      "semesters",
      "settings",
      "subjects",
      "subtasks",
      "tasks",
    ]);

    sqlite.close();
  });

  it("enforces the Subject -> Semester foreign key", () => {
    const sqlite = new Database(":memory:");
    // better-sqlite3 defaults foreign_keys on; explicit for clarity and in
    // case that ever changes.
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);

    migrate(db, { migrationsFolder: "src/db/migrations" });

    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO subjects (id, name, color, semester_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("subj-1", "Cálculo II", "indigo", "does-not-exist", Date.now(), Date.now());
    }).toThrow(/FOREIGN KEY constraint failed/);

    sqlite.close();
  });

  it("cascades subtask deletion when the parent task is deleted", () => {
    const sqlite = new Database(":memory:");
    // better-sqlite3 defaults foreign_keys on; explicit for clarity and in
    // case that ever changes.
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);

    migrate(db, { migrationsFolder: "src/db/migrations" });

    const now = Date.now();
    sqlite
      .prepare("INSERT INTO semesters (id, label, status, created_at) VALUES (?, ?, ?, ?)")
      .run("sem-1", "2026-1", "active", now);
    sqlite
      .prepare(
        "INSERT INTO subjects (id, name, color, semester_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("subj-1", "Cálculo II", "indigo", "sem-1", now, now);
    sqlite
      .prepare(
        "INSERT INTO tasks (id, title, subject_id, due_date_time, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("task-1", "Taller", "subj-1", now, "Alta", now, now);
    sqlite
      .prepare("INSERT INTO subtasks (id, task_id, text, `order`) VALUES (?, ?, ?, ?)")
      .run("st-1", "task-1", "Leer instrucciones", 0);

    sqlite.prepare("DELETE FROM tasks WHERE id = ?").run("task-1");

    const remaining = sqlite
      .prepare("SELECT COUNT(*) as count FROM subtasks WHERE task_id = ?")
      .get("task-1") as { count: number };
    expect(remaining.count).toBe(0);

    sqlite.close();
  });
});
