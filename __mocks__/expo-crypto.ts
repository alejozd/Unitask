import { randomUUID as nodeRandomUUID } from "node:crypto";

/**
 * Manual Jest mock for `expo-crypto`.
 *
 * `expo-crypto`'s `randomUUID()` calls straight through to the native
 * module (`ExpoCrypto.randomUUID()`) with no JS fallback. Under Jest, where
 * no native runtime exists, that silently returns `undefined` instead of
 * throwing. Repository code (e.g. `createSemester`) uses `randomUUID()` to
 * generate primary keys, so an `undefined` id trips the `id NOT NULL`
 * constraint on insert. This mock swaps in Node's built-in
 * `crypto.randomUUID()` so tests get real, distinct UUIDs.
 */
export function randomUUID(): string {
  return nodeRandomUUID();
}
