import { renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";

import { useAutoSync } from "../useAutoSync";

jest.mock("../index", () => ({
  runSync: jest.fn().mockResolvedValue({ pushed: 0, rejected: 0, pulled: 0 }),
  isSyncConfigured: jest.fn().mockReturnValue(true),
  SyncNotConfiguredError: class SyncNotConfiguredError extends Error {},
}));
import { runSync, isSyncConfigured } from "../index";

describe("useAutoSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isSyncConfigured as jest.Mock).mockReturnValue(true);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("runs a sync once on mount when sync is configured", async () => {
    renderHook(() => useAutoSync());
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("does not run a sync on mount when sync is not configured", async () => {
    (isSyncConfigured as jest.Mock).mockReturnValue(false);
    renderHook(() => useAutoSync());
    await Promise.resolve();
    expect(runSync).not.toHaveBeenCalled();
  });

  it("runs another sync every SYNC_INTERVAL_MS while mounted", async () => {
    renderHook(() => useAutoSync());
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(10 * 60 * 1000);
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it("runs a sync when the app returns to the foreground", async () => {
    const addEventListenerSpy = jest.spyOn(AppState, "addEventListener");
    renderHook(() => useAutoSync());
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(1);

    const changeHandler = addEventListenerSpy.mock.calls.find(([event]) => event === "change")?.[1];
    expect(changeHandler).toBeDefined();

    // AppState.currentState starts "active" by default in RN's jest
    // environment — go through "background" first so the listener's own
    // "was backgrounded, now active" transition check actually fires.
    changeHandler?.("background");
    changeHandler?.("active");
    await Promise.resolve();
    expect(runSync).toHaveBeenCalledTimes(2);
  });

  it("swallows a SyncNotConfiguredError instead of throwing", async () => {
    const { SyncNotConfiguredError } = jest.requireMock("../index");
    (runSync as jest.Mock).mockRejectedValueOnce(new SyncNotConfiguredError());
    expect(() => renderHook(() => useAutoSync())).not.toThrow();
  });
});
