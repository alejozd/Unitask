import type { Semester } from "@/db/schema/semester";
import type { Subject } from "@/db/schema/subject";
import type { Task } from "@/db/schema/task";
import type { Subtask } from "@/db/schema/subtask";
import type { Reminder } from "@/db/schema/reminder";
import type { Attachment } from "@/db/schema/attachment";
import type { Settings } from "@/db/schema/settings";

/**
 * 03-business-rules.md §14 / 04-user-flows.md flows 6-7: a single JSON file
 * containing every local table. There is exactly one supported version — a
 * migration path is speculative until a second version actually exists
 * (YAGNI, see docs/superpowers/plans/2026-08-17-phase9-settings-export-import.md's
 * Global Constraints).
 */
export const BACKUP_VERSION = 1;

export interface BackupTables {
  semesters: Semester[];
  subjects: Subject[];
  tasks: Task[];
  subtasks: Subtask[];
  reminders: Reminder[];
  attachments: Attachment[];
  settings: Settings[];
}

export interface BackupFile {
  version: typeof BACKUP_VERSION;
  exportedAt: string; // ISO 8601
  data: BackupTables;
}

/**
 * Wraps the raw table rows with a version + export timestamp.
 * `JSON.stringify` on the result automatically serializes every `Date`
 * field to an ISO string (native `Date.prototype.toJSON` behavior) — no
 * manual per-field conversion needed on the export side.
 */
export function serializeBackup(tables: BackupTables, now: Date = new Date()): BackupFile {
  return { version: BACKUP_VERSION, exportedAt: now.toISOString(), data: tables };
}

export type BackupParseResult =
  | { valid: true; data: BackupTables }
  | { valid: false; reason: "not-json" | "unsupported-version" | "wrong-shape" };

const TABLE_KEYS = [
  "semesters",
  "subjects",
  "tasks",
  "subtasks",
  "reminders",
  "attachments",
  "settings",
] as const;

// Known Date-typed fields per table (see each src/db/schema/*.ts file) —
// these come back as ISO strings from JSON.parse and must be converted
// back to real Date objects before the repository layer can insert them.
const DATE_FIELDS: Record<(typeof TABLE_KEYS)[number], string[]> = {
  semesters: ["createdAt", "closedAt"],
  subjects: ["createdAt", "updatedAt"],
  tasks: ["dueDateTime", "completedAt", "createdAt", "updatedAt"],
  subtasks: [],
  reminders: ["fixedDateTime", "computedFireAt", "createdAt"],
  attachments: ["createdAt"],
  settings: ["createdAt", "updatedAt"],
};

function reviveDates(rows: unknown[], dateFields: string[]): unknown[] | null {
  const revived: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return null;
    const next: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    for (const field of dateFields) {
      const value = next[field];
      if (value === null || value === undefined) continue; // nullable date field
      if (typeof value !== "string") return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      next[field] = parsed;
    }
    revived.push(next);
  }
  return revived;
}

/**
 * Basic shape/version check only (04-user-flows.md flow 7 step 3's own
 * wording) — NOT a full schema validator. Confirms JSON parses, the
 * version matches exactly, all 7 table keys exist as arrays, and every
 * row's known date fields parse to a valid Date. Does not check FK
 * integrity, enum membership, or field completeness beyond that.
 */
export function parseBackupFile(jsonText: string): BackupParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { valid: false, reason: "not-json" };
  }

  if (typeof raw !== "object" || raw === null) {
    return { valid: false, reason: "wrong-shape" };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== BACKUP_VERSION) {
    return { valid: false, reason: "unsupported-version" };
  }
  if (typeof candidate.data !== "object" || candidate.data === null) {
    return { valid: false, reason: "wrong-shape" };
  }
  const data = candidate.data as Record<string, unknown>;

  const result: Partial<BackupTables> = {};
  for (const key of TABLE_KEYS) {
    const rows = data[key];
    if (!Array.isArray(rows)) {
      return { valid: false, reason: "wrong-shape" };
    }
    const revived = reviveDates(rows, DATE_FIELDS[key]);
    if (revived === null) {
      return { valid: false, reason: "wrong-shape" };
    }
    result[key] = revived as never;
  }

  return { valid: true, data: result as BackupTables };
}
