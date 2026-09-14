import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { runSync, isSyncConfigured, SyncNotConfiguredError } from "./index";

export const SYNC_INTERVAL_MS = 10 * 60 * 1000;

async function trySync(): Promise<void> {
  if (!isSyncConfigured()) return;
  try {
    await runSync();
  } catch (error) {
    if (error instanceof SyncNotConfiguredError) return;
    // Network failures and everything else are swallowed here too, per the
    // design spec §6: a failed sync attempt is retried on the next trigger
    // (foreground, timer, or manual button), never surfaced as a thrown
    // error to whatever mounted this hook.
  }
}

function isAppStateStatus(value: unknown): value is AppStateStatus {
  return typeof value === "string";
}

export function useAutoSync(): void {
  // Falls back to "active" if the host environment doesn't populate a real
  // string for AppState.currentState before the first render (observed
  // under this project's Jest RN mock; a real RN runtime always does).
  const appState = useRef<AppStateStatus>(
    isAppStateStatus(AppState.currentState) ? AppState.currentState : "active",
  );

  useEffect(() => {
    trySync();

    const interval = setInterval(trySync, SYNC_INTERVAL_MS);

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (/inactive|background/.test(appState.current) && nextState === "active") {
        trySync();
      }
      appState.current = nextState;
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);
}
