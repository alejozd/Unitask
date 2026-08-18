import { BACKUP_VERSION, parseBackupFile, serializeBackup, type BackupTables } from "../backup";

function fixtureTables(): BackupTables {
  return {
    semesters: [
      {
        id: "sem-1",
        label: "2026-1",
        status: "active",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        closedAt: null,
      },
    ],
    subjects: [
      {
        id: "sub-1",
        name: "Cálculo",
        courseCode: null,
        professorName: null,
        color: "indigo",
        semesterId: "sem-1",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ],
    tasks: [
      {
        id: "task-1",
        title: "Tarea 1",
        description: null,
        subjectId: "sub-1",
        dueDateTime: new Date("2026-02-01T12:00:00.000Z"),
        priority: "Media",
        completed: false,
        completedAt: null,
        completedLate: false,
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    ],
    subtasks: [{ id: "subtask-1", taskId: "task-1", text: "Paso 1", completed: false, order: 0 }],
    reminders: [
      {
        id: "rem-1",
        taskId: "task-1",
        kind: "relative",
        offsetValue: 1,
        offsetUnit: "days",
        fixedDateTime: null,
        computedFireAt: new Date("2026-01-31T12:00:00.000Z"),
        notificationId: "notif-1",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    ],
    attachments: [
      {
        id: "att-1",
        taskId: "task-1",
        originalFileName: "notas.pdf",
        storedPath: "file:///attachments/task-1/att-1-notas.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    ],
    settings: [
      {
        id: "settings-1",
        nickname: "Ale",
        fullName: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
  };
}

function emptyTables(): BackupTables {
  return {
    semesters: [],
    subjects: [],
    tasks: [],
    subtasks: [],
    reminders: [],
    attachments: [],
    settings: [],
  };
}

describe("serializeBackup", () => {
  it("wraps tables with the correct version and exportedAt", () => {
    const now = new Date("2026-08-17T10:00:00.000Z");
    const file = serializeBackup(fixtureTables(), now);

    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.exportedAt).toBe(now.toISOString());
  });

  it("accepts all-empty table arrays as a legitimate backup", () => {
    const file = serializeBackup(emptyTables(), new Date("2026-08-17T10:00:00.000Z"));

    expect(file.data.semesters).toEqual([]);
    expect(file.data.tasks).toEqual([]);
  });
});

describe("parseBackupFile", () => {
  it("round-trips fixture tables through serialize -> JSON.stringify -> parse with real Date instances", () => {
    const tables = fixtureTables();
    const json = JSON.stringify(serializeBackup(tables, new Date("2026-08-17T10:00:00.000Z")));

    const result = parseBackupFile(json);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data.semesters[0].createdAt).toBeInstanceOf(Date);
    expect(result.data.semesters[0].createdAt.getTime()).toBe(
      tables.semesters[0].createdAt.getTime(),
    );
    expect(result.data.tasks[0].dueDateTime.getTime()).toBe(tables.tasks[0].dueDateTime.getTime());
    expect(result.data.reminders[0].computedFireAt.getTime()).toBe(
      tables.reminders[0].computedFireAt.getTime(),
    );
  });

  it("rejects malformed JSON text", () => {
    const result = parseBackupFile("{not json");

    expect(result).toEqual({ valid: false, reason: "not-json" });
  });

  it("rejects a missing or mismatched version", () => {
    const json = JSON.stringify({ version: 2, data: emptyTables() });

    const result = parseBackupFile(json);

    expect(result).toEqual({ valid: false, reason: "unsupported-version" });
  });

  it("rejects data missing one of the 7 table keys", () => {
    const { tasks: _omitted, ...incompleteData } = emptyTables();
    const json = JSON.stringify({ version: BACKUP_VERSION, data: incompleteData });

    const result = parseBackupFile(json);

    expect(result).toEqual({ valid: false, reason: "wrong-shape" });
  });

  it("rejects a table value that isn't an array", () => {
    const json = JSON.stringify({
      version: BACKUP_VERSION,
      data: { ...emptyTables(), tasks: {} },
    });

    const result = parseBackupFile(json);

    expect(result).toEqual({ valid: false, reason: "wrong-shape" });
  });

  it("rejects a row with an unparseable date field", () => {
    const tables = fixtureTables();
    const backup = JSON.parse(
      JSON.stringify(serializeBackup(tables, new Date("2026-08-17T10:00:00.000Z"))),
    );
    backup.data.tasks[0].dueDateTime = "not-a-date";

    const result = parseBackupFile(JSON.stringify(backup));

    expect(result).toEqual({ valid: false, reason: "wrong-shape" });
  });

  it("keeps a legitimately-null nullable date field null", () => {
    const tables = fixtureTables(); // semesters[0].closedAt is null (active semester)
    const json = JSON.stringify(serializeBackup(tables, new Date("2026-08-17T10:00:00.000Z")));

    const result = parseBackupFile(json);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data.semesters[0].closedAt).toBeNull();
  });

  it("passes subtasks (zero date fields) through unchanged", () => {
    const tables = fixtureTables();
    const json = JSON.stringify(serializeBackup(tables, new Date("2026-08-17T10:00:00.000Z")));

    const result = parseBackupFile(json);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data.subtasks).toEqual(tables.subtasks);
  });
});
