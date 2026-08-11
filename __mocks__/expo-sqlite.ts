import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Manual Jest mock for `expo-sqlite`.
 *
 * Jest auto-loads `__mocks__/expo-sqlite.ts` (adjacent to `node_modules`)
 * for every test run without needing an explicit `jest.mock("expo-sqlite")`
 * call, because `expo-sqlite`'s native module (`ExpoSQLite.NativeDatabase`)
 * only exists in a real Expo/React Native runtime.
 *
 * `src/db/client.ts` calls `openDatabaseSync` and `execSync` as
 * *module-level side effects* to build the on-device `db` export. Any test
 * that transitively imports it — even repository tests that only reference
 * it as an unused default-parameter value — would otherwise crash at import
 * time. Every repository test in this project injects its own
 * `better-sqlite3`-backed database explicitly and never touches this stub.
 */
export function openDatabaseSync(): SQLiteDatabase {
  return {
    execSync: () => undefined,
  } as unknown as SQLiteDatabase;
}
