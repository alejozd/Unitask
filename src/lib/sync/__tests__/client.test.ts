import {
  register,
  login,
  logout,
  restoreSession,
  isLoggedIn,
  authenticatedFetch,
  getAccessToken,
  SyncAuthError,
  __resetSessionForTests,
} from "../client";

function mockFetchOnce(status: number, body: unknown) {
  return jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe("sync client", () => {
  beforeEach(async () => {
    await __resetSessionForTests();
    (global as any).fetch = undefined;
  });

  it("register posts credentials and does not throw on 201", async () => {
    global.fetch = mockFetchOnce(201, { ok: true });
    await expect(register("a@b.com", "pw")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "https://unitask-sync.zdevs.uk/auth/register",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("register throws on 409", async () => {
    global.fetch = mockFetchOnce(409, { error: "Email already registered" });
    await expect(register("a@b.com", "pw")).rejects.toThrow();
  });

  it("login stores the refresh token and marks the session as logged in", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");
    expect(isLoggedIn()).toBe(true);
  });

  it("login throws on 401 and does not mark the session as logged in", async () => {
    global.fetch = mockFetchOnce(401, { error: "Invalid credentials" });
    await expect(login("a@b.com", "wrong")).rejects.toThrow();
    expect(isLoggedIn()).toBe(false);
  });

  it("logout clears the session", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");
    global.fetch = mockFetchOnce(200, { ok: true });
    await logout();
    expect(isLoggedIn()).toBe(false);
  });

  it("restoreSession re-derives an access token from the stored refresh token", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");

    global.fetch = mockFetchOnce(200, { accessToken: "at-2", refreshToken: "rt-2" });
    const restored = await restoreSession();
    expect(restored).toBe(true);
    expect(isLoggedIn()).toBe(true);
  });

  it("restoreSession returns false when no refresh token was ever stored", async () => {
    const restored = await restoreSession();
    expect(restored).toBe(false);
  });

  it("getAccessToken returns null when no session exists", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("authenticatedFetch attaches the bearer token", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");

    global.fetch = mockFetchOnce(200, { ok: true });
    await authenticatedFetch("/sync/push", { method: "POST" });
    expect(fetch).toHaveBeenCalledWith(
      "https://unitask-sync.zdevs.uk/sync/push",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer at-1" }),
      }),
    );
  });

  it("authenticatedFetch refreshes once and retries on a 401, then succeeds", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "at-2", refreshToken: "rt-2" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);

    const response = await authenticatedFetch("/sync/pull?since=0");
    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("authenticatedFetch throws SyncAuthError when no session exists", async () => {
    await expect(authenticatedFetch("/sync/pull?since=0")).rejects.toThrow(SyncAuthError);
  });

  it("authenticatedFetch throws SyncAuthError when the refresh itself fails", async () => {
    global.fetch = mockFetchOnce(200, { accessToken: "at-1", refreshToken: "rt-1" });
    await login("a@b.com", "pw");

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response);

    await expect(authenticatedFetch("/sync/pull?since=0")).rejects.toThrow(SyncAuthError);
  });
});
