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
});
