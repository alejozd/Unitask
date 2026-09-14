import * as SecureStore from "expo-secure-store";

export const SYNC_API_BASE_URL = "https://unitask-sync.zdevs.uk";

const REFRESH_TOKEN_KEY = "unitask-refresh-token";

export class SyncAuthError extends Error {
  constructor(message = "Sync session expired or was never established") {
    super(message);
    this.name = "SyncAuthError";
  }
}

// In-memory only, per this plan's Global Constraints — never written to
// SQLite or SecureStore. Re-derived from the stored refresh token via
// restoreSession() on cold start.
let accessToken: string | null = null;

export function isLoggedIn(): boolean {
  return accessToken !== null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// Test-only — resets the in-memory session and any stored refresh token
// between test cases. Not part of the real runtime API; the app itself
// never has a reason to call this (logout() is the real equivalent).
export async function __resetSessionForTests(): Promise<void> {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

async function parseJsonOrThrow(response: Response, errorMessage: string): Promise<any> {
  if (!response.ok) {
    throw new Error(`${errorMessage} (status ${response.status})`);
  }
  return response.json();
}

export async function register(email: string, password: string): Promise<void> {
  const response = await fetch(`${SYNC_API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await parseJsonOrThrow(response, "No se pudo registrar la cuenta");
}

export async function login(email: string, password: string): Promise<void> {
  const response = await fetch(`${SYNC_API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseJsonOrThrow(response, "Credenciales inválidas");
  accessToken = body.accessToken;
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, body.refreshToken);
}

export async function logout(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (refreshToken) {
    try {
      await fetch(`${SYNC_API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Best-effort server-side revocation — the local session is cleared
      // regardless, since the whole point of logging out locally is to stop
      // this device from acting as this account even if offline.
    }
  }
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;

  const response = await fetch(`${SYNC_API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) return false;

  const body = await response.json();
  accessToken = body.accessToken;
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, body.refreshToken);
  return true;
}

export async function restoreSession(): Promise<boolean> {
  return refreshAccessToken();
}

export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (accessToken === null) {
    const restored = await refreshAccessToken();
    if (!restored) throw new SyncAuthError();
  }

  const withAuth = (headers: HeadersInit | undefined): HeadersInit => ({
    ...headers,
    Authorization: `Bearer ${accessToken}`,
  });

  let response = await fetch(`${SYNC_API_BASE_URL}${path}`, {
    ...init,
    headers: withAuth(init.headers),
  });
  if (response.status !== 401) return response;

  const refreshed = await refreshAccessToken();
  if (!refreshed) throw new SyncAuthError();

  response = await fetch(`${SYNC_API_BASE_URL}${path}`, {
    ...init,
    headers: withAuth(init.headers),
  });
  if (response.status === 401) throw new SyncAuthError();
  return response;
}
