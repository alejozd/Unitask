# Multi-Device Sync — Phase A: Backend Scaffold + Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new, independently deployable Node/Fastify backend with Postgres-backed user accounts and JWT authentication (register/login/refresh/logout), deployed live on the user's Ubuntu server via pm2 behind Cloudflare — the foundation Phase B (sync push/pull) and later client work build on.

**Architecture:** A brand-new repository, sibling to the existing `UniTask` Expo app repo, not nested inside it. Fastify exposes HTTP routes; Drizzle ORM (the same ORM already used client-side, targeting Postgres instead of SQLite here) handles all database access; `jsonwebtoken` + `bcrypt` implement auth directly (no auth-as-a-service dependency). The server factory (`buildServer()`) never calls `.listen()` itself, so every route is tested via Fastify's `.inject()` against a real Postgres test database — no mocked DB layer, matching this project's own established preference for integration-level repository tests over mocking.

**Tech Stack:** Node.js (LTS — confirm the exact version already installed on the target Ubuntu server with `node -v` before starting, and set `engines` in `package.json` to match), TypeScript, Fastify, Drizzle ORM + `pg`, `bcrypt`, `jsonwebtoken`, Jest + `ts-jest`, `drizzle-kit`, deployed under `pm2` behind Cloudflare.

## Global Constraints

- This is a **new git repository**, created as a sibling directory to `F:\Proyectos\UniTask` (e.g. `F:\Proyectos\unitask-sync-server`) — never created inside the existing Expo app's working tree.
- TDD is mandatory for every file containing logic (schema/config declaration files are the only exception — they are exercised indirectly by the integration tests that use them, per Task 2).
- No secrets are ever committed. `.env` is gitignored; `.env.example` documents every required variable with placeholder values.
- Package versions shown below (Fastify ^5, drizzle-orm ^0.36, drizzle-kit ^0.28, etc.) are current as of this plan's writing (2026-09-12) — confirm there has been no breaking major-version change before installing, the same "check current docs before writing code" discipline this project's own `AGENTS.md` already requires for Expo.
- Every task ends with a real `git commit`.
- This plan covers **Phase A only** (backend scaffold + auth, deployed and reachable over HTTPS). Phase B (sync push/pull + attachments on the server) and the client-side phases (sync_log migration, sync engine, attachment sync) are each separate plan documents, written just before that phase starts — the same one-plan-per-phase convention already used throughout this project's `docs/superpowers/plans/` history. See `docs/superpowers/specs/2026-09-12-multi-device-sync-design.md` for the full, already-approved cross-phase design.

---

## File Structure (end state of this phase)

```
unitask-sync-server/
  package.json
  tsconfig.json
  jest.config.js
  jest.setup.ts
  drizzle.config.ts
  ecosystem.config.js
  .env.example
  .gitignore
  drizzle/                       # drizzle-kit generated SQL migrations (committed)
  src/
    config.ts                    # env loading
    server.ts                    # buildServer() factory, registers all routes
    index.ts                     # real entrypoint: buildServer().listen(...)
    db/
      schema.ts                  # users, refresh_tokens tables
      client.ts                  # Drizzle + pg Pool
      migrate.ts                 # programmatic migration runner
      __tests__/
        schema.integration.test.ts
    auth/
      password.ts                # hashPassword / verifyPassword
      tokens.ts                  # issue/verify access + refresh JWTs
      users-repository.ts        # createUser / findUserByEmail
      refresh-tokens-repository.ts
      routes.ts                  # /auth/register, /login, /refresh, /logout
      middleware.ts               # requireAuth preHandler
      __tests__/
        password.test.ts
        users-repository.test.ts
        tokens.test.ts
        refresh-tokens-repository.test.ts
        routes.test.ts
        middleware.test.ts
    routes/
      health.ts                  # GET /health
      me.ts                      # GET /auth/me (protected, proves requireAuth works)
      __tests__/
        health.test.ts
```

---

### Task 1: Project scaffold + health check

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `jest.config.js`
- Create: `jest.setup.ts`
- Create: `src/config.ts`
- Create: `src/server.ts`
- Create: `src/routes/health.ts`
- Create: `src/index.ts`
- Test: `src/routes/__tests__/health.test.ts`

**Interfaces:**
- Produces: `buildServer(): FastifyInstance` (from `src/server.ts`) — every later task registers its routes onto this instance and every route test calls this function directly. `config` (from `src/config.ts`) — `{ port: number, databaseUrl: string, jwtAccessSecret: string, jwtRefreshSecret: string }`.

- [ ] **Step 1: Initialize the repository and install dependencies**

```bash
mkdir unitask-sync-server && cd unitask-sync-server
git init
npm init -y
npm install fastify drizzle-orm pg bcrypt jsonwebtoken dotenv
npm install -D typescript ts-node ts-node-dev jest ts-jest @types/node @types/pg @types/bcrypt @types/jsonwebtoken @types/jest drizzle-kit
npx tsc --init
```

- [ ] **Step 2: Write `package.json` scripts, `tsconfig.json`, `.gitignore`, `.env.example`**

`package.json` (merge these fields into the file `npm init -y` created):

```json
{
  "name": "unitask-sync-server",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "ts-node-dev --respawn src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "jest",
    "db:generate": "drizzle-kit generate",
    "db:migrate:dev": "ts-node src/db/migrate.ts",
    "db:migrate": "node dist/db/migrate.js"
  }
}
```

`tsconfig.json` (replace the generated file's compilerOptions):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

`.gitignore`:

```
node_modules/
dist/
.env
```

`.env.example`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/unitask_sync
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/unitask_sync_test
JWT_ACCESS_SECRET=replace-with-a-long-random-value
JWT_REFRESH_SECRET=replace-with-a-different-long-random-value
PORT=8787
```

Copy `.env.example` to `.env` locally and fill in real values before continuing (`.env` is gitignored and never committed).

- [ ] **Step 3: Write `jest.config.js` and `jest.setup.ts`**

`jest.config.js`:

```js
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  setupFiles: ["<rootDir>/jest.setup.ts"],
};
```

`jest.setup.ts` (safe defaults for tests; forces every test run against the **test** database regardless of what `.env` points at for local dev):

```ts
import "dotenv/config";

process.env.JWT_ACCESS_SECRET ||= "test-access-secret";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret";
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgres://postgres:postgres@localhost:5432/unitask_sync_test";
```

- [ ] **Step 4: Write the failing test for `GET /health`**

`src/routes/__tests__/health.test.ts`:

```ts
import { buildServer } from "../../server";

describe("GET /health", () => {
  it("returns status ok", async () => {
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 5: Run the test and confirm it fails**

Run: `npx jest src/routes/__tests__/health.test.ts`
Expected: FAIL — `Cannot find module '../../server'` (the module doesn't exist yet).

- [ ] **Step 6: Implement `config.ts`, `server.ts`, `routes/health.ts`, `index.ts`**

`src/config.ts`:

```ts
import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl: requireEnv("DATABASE_URL"),
  jwtAccessSecret: requireEnv("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: requireEnv("JWT_REFRESH_SECRET"),
};
```

`src/routes/health.ts`:

```ts
import { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok" }));
}
```

`src/server.ts`:

```ts
import Fastify, { FastifyInstance } from "fastify";

import { healthRoutes } from "./routes/health";

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  return app;
}
```

`src/index.ts`:

```ts
import { buildServer } from "./server";
import { config } from "./config";

const app = buildServer();

app.listen({ port: config.port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `npx jest src/routes/__tests__/health.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Fastify backend with health check"
```

---

### Task 2: Postgres schema (`users`, `refresh_tokens`) + migrations

**Prerequisite:** create the test database once, on whichever Postgres instance your `.env`'s `DATABASE_URL_TEST` points at:

```bash
createdb unitask_sync_test
```

(If your Postgres role needs a password or a different host, adjust `DATABASE_URL_TEST` in `.env` accordingly — the value only needs to be correct locally; it is never committed.)

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`
- Create: `src/db/migrate.ts`
- Test: `src/db/__tests__/schema.integration.test.ts`

**Interfaces:**
- Consumes: `config` from Task 1.
- Produces: `db` (Drizzle instance, from `src/db/client.ts`), `users`, `refreshTokens` (Drizzle table objects), `User`, `NewUser`, `RefreshToken`, `NewRefreshToken` (inferred types) — all from `src/db/schema.ts`, used by every later auth task.

- [ ] **Step 1: Write the failing integration test**

`src/db/__tests__/schema.integration.test.ts`:

```ts
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

import { db } from "../client";
import { users, refreshTokens } from "../schema";

describe("users and refresh_tokens schema", () => {
  afterEach(async () => {
    await db.delete(refreshTokens);
    await db.delete(users);
  });

  it("inserts a user and a refresh token referencing it", async () => {
    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      email: "test@example.com",
      passwordHash: "hashed",
    });

    const tokenId = randomUUID();
    await db.insert(refreshTokens).values({
      id: tokenId,
      userId,
      tokenHash: "token-hash",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.id, tokenId));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/db/__tests__/schema.integration.test.ts`
Expected: FAIL — `Cannot find module '../client'` (and `../schema`).

- [ ] **Step 3: Write `schema.ts`, `client.ts`, `migrate.ts`**

`src/db/schema.ts`:

```ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
```

`src/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { config } from "../config";
import * as schema from "./schema";

const pool = new Pool({ connectionString: config.databaseUrl });

export const db = drizzle(pool, { schema });
```

`src/db/migrate.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { config } from "../config";

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`drizzle.config.ts` (repo root):

```ts
import "dotenv/config";
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
```

- [ ] **Step 4: Generate and apply the migration against the test database**

```bash
npx drizzle-kit generate
DATABASE_URL="$DATABASE_URL_TEST" npx ts-node src/db/migrate.ts
```

(On Windows PowerShell: `$env:DATABASE_URL=$env:DATABASE_URL_TEST; npx ts-node src/db/migrate.ts`)

Confirm it prints `Migrations applied.` with no errors.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx jest src/db/__tests__/schema.integration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit (including the generated migration SQL under `drizzle/`)**

```bash
git add -A
git commit -m "feat: add users and refresh_tokens schema with migrations"
```

---

### Task 3: Password hashing

**Files:**
- Create: `src/auth/password.ts`
- Test: `src/auth/__tests__/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plainPassword: string): Promise<string>`, `verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean>` — used by Task 7's routes.

- [ ] **Step 1: Write the failing test**

`src/auth/__tests__/password.test.ts`:

```ts
import { hashPassword, verifyPassword } from "../password";

describe("password hashing", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/auth/__tests__/password.test.ts`
Expected: FAIL — `Cannot find module '../password'`.

- [ ] **Step 3: Implement `password.ts`**

```ts
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/auth/__tests__/password.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add password hashing helpers"
```

---

### Task 4: Users repository

**Files:**
- Create: `src/auth/users-repository.ts`
- Test: `src/auth/__tests__/users-repository.test.ts`

**Interfaces:**
- Consumes: `db`, `users`, `User` from Task 2.
- Produces: `createUser(email: string, passwordHash: string, database?): Promise<User>`, `findUserByEmail(email: string, database?): Promise<User | null>`, `EmailAlreadyRegisteredError` — used by Task 7's routes.

- [ ] **Step 1: Write the failing test**

`src/auth/__tests__/users-repository.test.ts`:

```ts
import { db } from "../../db/client";
import { users } from "../../db/schema";
import { createUser, findUserByEmail, EmailAlreadyRegisteredError } from "../users-repository";

describe("users repository", () => {
  afterEach(async () => {
    await db.delete(users);
  });

  it("creates a user and finds it by email", async () => {
    const created = await createUser("student@example.com", "hashed-password");
    expect(created.email).toBe("student@example.com");

    const found = await findUserByEmail("student@example.com");
    expect(found?.id).toBe(created.id);
  });

  it("rejects a duplicate email", async () => {
    await createUser("dup@example.com", "hashed-password");
    await expect(createUser("dup@example.com", "another-hash")).rejects.toThrow(
      EmailAlreadyRegisteredError,
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/auth/__tests__/users-repository.test.ts`
Expected: FAIL — `Cannot find module '../users-repository'`.

- [ ] **Step 3: Implement `users-repository.ts`**

```ts
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "../db/client";
import { users, type User } from "../db/schema";

type Database = typeof defaultDb;

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("Email is already registered");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export async function createUser(
  email: string,
  passwordHash: string,
  database: Database = defaultDb,
): Promise<User> {
  const existing = await database.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    throw new EmailAlreadyRegisteredError();
  }

  const id = randomUUID();
  await database.insert(users).values({ id, email, passwordHash });

  const [created] = await database.select().from(users).where(eq(users.id, id)).limit(1);
  return created;
}

export async function findUserByEmail(
  email: string,
  database: Database = defaultDb,
): Promise<User | null> {
  const rows = await database.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/auth/__tests__/users-repository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add users repository"
```

---

### Task 5: JWT issuing and verification

**Files:**
- Create: `src/auth/tokens.ts`
- Test: `src/auth/__tests__/tokens.test.ts`

**Interfaces:**
- Consumes: `config` from Task 1.
- Produces: `issueAccessToken(userId): string`, `verifyAccessToken(token): AccessTokenPayload`, `issueRefreshToken(userId): string`, `verifyRefreshToken(token): AccessTokenPayload`, `refreshTokenExpiryDate(): Date`, `AccessTokenPayload { userId: string }` — used by Tasks 6, 7, 8.

- [ ] **Step 1: Write the failing test**

`src/auth/__tests__/tokens.test.ts`:

```ts
import {
  issueAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
} from "../tokens";

describe("tokens", () => {
  it("issues and verifies an access token round-trip", () => {
    const token = issueAccessToken("user-123");
    expect(verifyAccessToken(token)).toEqual({ userId: "user-123" });
  });

  it("issues and verifies a refresh token round-trip", () => {
    const token = issueRefreshToken("user-123");
    expect(verifyRefreshToken(token)).toEqual({ userId: "user-123" });
  });

  it("rejects an access token verified with the refresh secret", () => {
    const token = issueAccessToken("user-123");
    expect(() => verifyRefreshToken(token)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/auth/__tests__/tokens.test.ts`
Expected: FAIL — `Cannot find module '../tokens'`.

- [ ] **Step 3: Implement `tokens.ts`**

```ts
import jwt from "jsonwebtoken";

import { config } from "../config";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "30d";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccessTokenPayload {
  userId: string;
}

export function issueAccessToken(userId: string): string {
  return jwt.sign({ userId } satisfies AccessTokenPayload, config.jwtAccessSecret, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwtAccessSecret) as AccessTokenPayload;
}

export function issueRefreshToken(userId: string): string {
  return jwt.sign({ userId } satisfies AccessTokenPayload, config.jwtRefreshSecret, {
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

export function verifyRefreshToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwtRefreshSecret) as AccessTokenPayload;
}

export function refreshTokenExpiryDate(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/auth/__tests__/tokens.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add JWT access/refresh token helpers"
```

---

### Task 6: Refresh tokens repository

**Files:**
- Create: `src/auth/refresh-tokens-repository.ts`
- Test: `src/auth/__tests__/refresh-tokens-repository.test.ts`

**Interfaces:**
- Consumes: `db`, `users`, `refreshTokens` from Task 2; `refreshTokenExpiryDate` from Task 5.
- Produces: `storeRefreshToken(userId, token, database?): Promise<void>`, `isRefreshTokenActive(token, database?): Promise<boolean>`, `revokeRefreshToken(token, database?): Promise<void>` — used by Task 7's routes.

- [ ] **Step 1: Write the failing test**

`src/auth/__tests__/refresh-tokens-repository.test.ts`:

```ts
import { randomUUID } from "crypto";

import { db } from "../../db/client";
import { users, refreshTokens } from "../../db/schema";
import {
  storeRefreshToken,
  isRefreshTokenActive,
  revokeRefreshToken,
} from "../refresh-tokens-repository";

describe("refresh tokens repository", () => {
  let userId: string;

  beforeEach(async () => {
    userId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, passwordHash: "x" });
  });

  afterEach(async () => {
    await db.delete(refreshTokens);
    await db.delete(users);
  });

  it("treats a stored token as active", async () => {
    await storeRefreshToken(userId, "raw-refresh-token");
    await expect(isRefreshTokenActive("raw-refresh-token")).resolves.toBe(true);
  });

  it("treats an unknown token as inactive", async () => {
    await expect(isRefreshTokenActive("never-issued")).resolves.toBe(false);
  });

  it("treats a revoked token as inactive", async () => {
    await storeRefreshToken(userId, "raw-refresh-token");
    await revokeRefreshToken("raw-refresh-token");
    await expect(isRefreshTokenActive("raw-refresh-token")).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/auth/__tests__/refresh-tokens-repository.test.ts`
Expected: FAIL — `Cannot find module '../refresh-tokens-repository'`.

- [ ] **Step 3: Implement `refresh-tokens-repository.ts`**

Refresh tokens are stored hashed (SHA-256), never in plaintext, so a database leak alone doesn't hand out usable tokens:

```ts
import { randomUUID, createHash } from "crypto";
import { eq, and, isNull } from "drizzle-orm";

import { db as defaultDb } from "../db/client";
import { refreshTokens } from "../db/schema";
import { refreshTokenExpiryDate } from "./tokens";

type Database = typeof defaultDb;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function storeRefreshToken(
  userId: string,
  token: string,
  database: Database = defaultDb,
): Promise<void> {
  await database.insert(refreshTokens).values({
    id: randomUUID(),
    userId,
    tokenHash: hashToken(token),
    expiresAt: refreshTokenExpiryDate(),
  });
}

export async function isRefreshTokenActive(
  token: string,
  database: Database = defaultDb,
): Promise<boolean> {
  const rows = await database
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, hashToken(token)), isNull(refreshTokens.revokedAt)));
  const row = rows[0];
  if (!row) return false;
  return row.expiresAt.getTime() > Date.now();
}

export async function revokeRefreshToken(
  token: string,
  database: Database = defaultDb,
): Promise<void> {
  await database
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, hashToken(token)));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/auth/__tests__/refresh-tokens-repository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add refresh tokens repository"
```

---

### Task 7: Auth routes (register, login, refresh, logout)

**Files:**
- Create: `src/auth/routes.ts`
- Modify: `src/server.ts` (register `authRoutes`)
- Test: `src/auth/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` (Task 3), `createUser`/`findUserByEmail`/`EmailAlreadyRegisteredError` (Task 4), `issueAccessToken`/`issueRefreshToken`/`verifyRefreshToken` (Task 5), `storeRefreshToken`/`isRefreshTokenActive`/`revokeRefreshToken` (Task 6).
- Produces: `authRoutes(app: FastifyInstance)` registering `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`.

- [ ] **Step 1: Write the failing test**

`src/auth/__tests__/routes.test.ts`:

```ts
import { buildServer } from "../../server";
import { db } from "../../db/client";
import { users, refreshTokens } from "../../db/schema";

describe("auth routes", () => {
  afterEach(async () => {
    await db.delete(refreshTokens);
    await db.delete(users);
  });

  it("registers, logs in, refreshes, and logs out", async () => {
    const app = buildServer();

    const registerResponse = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "flow@example.com", password: "s3cret-password" },
    });
    expect(registerResponse.statusCode).toBe(201);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "flow@example.com", password: "s3cret-password" },
    });
    expect(loginResponse.statusCode).toBe(200);
    const { accessToken, refreshToken } = loginResponse.json();
    expect(typeof accessToken).toBe("string");
    expect(typeof refreshToken).toBe("string");

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(refreshResponse.statusCode).toBe(200);
    const rotated = refreshResponse.json();
    expect(rotated.refreshToken).not.toBe(refreshToken);

    const reuseOldResponse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(reuseOldResponse.statusCode).toBe(401);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/auth/logout",
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(logoutResponse.statusCode).toBe(200);
  });

  it("rejects registering the same email twice", async () => {
    const app = buildServer();
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "dup@example.com", password: "correct-password" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "dup@example.com", password: "another-password" },
    });
    expect(response.statusCode).toBe(409);
  });

  it("rejects login with the wrong password", async () => {
    const app = buildServer();
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "wrongpass@example.com", password: "correct-password" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "wrongpass@example.com", password: "incorrect" },
    });
    expect(response.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/auth/__tests__/routes.test.ts`
Expected: FAIL — `Cannot find module '../routes'`.

- [ ] **Step 3: Implement `routes.ts` and register it in `server.ts`**

`src/auth/routes.ts`:

```ts
import { FastifyInstance } from "fastify";

import { hashPassword, verifyPassword } from "./password";
import { createUser, findUserByEmail, EmailAlreadyRegisteredError } from "./users-repository";
import { issueAccessToken, issueRefreshToken, verifyRefreshToken } from "./tokens";
import {
  storeRefreshToken,
  isRefreshTokenActive,
  revokeRefreshToken,
} from "./refresh-tokens-repository";

interface CredentialsBody {
  email: string;
  password: string;
}

interface RefreshBody {
  refreshToken: string;
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: CredentialsBody }>("/auth/register", async (request, reply) => {
    const { email, password } = request.body;
    const passwordHash = await hashPassword(password);
    try {
      await createUser(email, passwordHash);
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        return reply.status(409).send({ error: "Email already registered" });
      }
      throw error;
    }
    return reply.status(201).send({ ok: true });
  });

  app.post<{ Body: CredentialsBody }>("/auth/login", async (request, reply) => {
    const { email, password } = request.body;
    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const accessToken = issueAccessToken(user.id);
    const refreshToken = issueRefreshToken(user.id);
    await storeRefreshToken(user.id, refreshToken);
    return reply.send({ accessToken, refreshToken });
  });

  app.post<{ Body: RefreshBody }>("/auth/refresh", async (request, reply) => {
    const { refreshToken } = request.body;
    if (!(await isRefreshTokenActive(refreshToken))) {
      return reply.status(401).send({ error: "Invalid refresh token" });
    }

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return reply.status(401).send({ error: "Invalid refresh token" });
    }

    await revokeRefreshToken(refreshToken);
    const newAccessToken = issueAccessToken(payload.userId);
    const newRefreshToken = issueRefreshToken(payload.userId);
    await storeRefreshToken(payload.userId, newRefreshToken);
    return reply.send({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  });

  app.post<{ Body: RefreshBody }>("/auth/logout", async (request, reply) => {
    await revokeRefreshToken(request.body.refreshToken);
    return reply.send({ ok: true });
  });
}
```

Modify `src/server.ts`:

```ts
import Fastify, { FastifyInstance } from "fastify";

import { healthRoutes } from "./routes/health";
import { authRoutes } from "./auth/routes";

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  app.register(authRoutes);
  return app;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/auth/__tests__/routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add register/login/refresh/logout routes"
```

---

### Task 8: `requireAuth` middleware + protected `/auth/me`

**Files:**
- Create: `src/auth/middleware.ts`
- Create: `src/routes/me.ts`
- Modify: `src/server.ts` (register `meRoutes`)
- Test: `src/auth/__tests__/middleware.test.ts`

**Interfaces:**
- Consumes: `verifyAccessToken` (Task 5).
- Produces: `requireAuth(request, reply): Promise<void>` (Fastify `preHandler`, sets `request.userId`) — every Phase B sync route reuses this exact middleware to scope requests by user.

- [ ] **Step 1: Write the failing test**

`src/auth/__tests__/middleware.test.ts`:

```ts
import { buildServer } from "../../server";
import { db } from "../../db/client";
import { users, refreshTokens } from "../../db/schema";
import { issueAccessToken } from "../tokens";

describe("requireAuth", () => {
  afterEach(async () => {
    await db.delete(refreshTokens);
    await db.delete(users);
  });

  it("rejects a request with no Authorization header", async () => {
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/auth/me" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a request with an invalid token", async () => {
    const app = buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("accepts a request with a valid access token and exposes the userId", async () => {
    const app = buildServer();
    const token = issueAccessToken("user-abc");
    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: "user-abc" });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/auth/__tests__/middleware.test.ts`
Expected: FAIL — `Cannot find module '../../routes/me'`-shaped error (route doesn't exist, 404 instead of 401/200).

- [ ] **Step 3: Implement `middleware.ts`, `routes/me.ts`, and register it**

`src/auth/middleware.ts`:

```ts
import { FastifyReply, FastifyRequest } from "fastify";

import { verifyAccessToken } from "./tokens";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Missing bearer token" });
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    request.userId = payload.userId;
  } catch {
    return reply.status(401).send({ error: "Invalid or expired token" });
  }
}
```

`src/routes/me.ts`:

```ts
import { FastifyInstance } from "fastify";

import { requireAuth } from "../auth/middleware";

export async function meRoutes(app: FastifyInstance) {
  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    return { userId: request.userId };
  });
}
```

Modify `src/server.ts`:

```ts
import Fastify, { FastifyInstance } from "fastify";

import { healthRoutes } from "./routes/health";
import { authRoutes } from "./auth/routes";
import { meRoutes } from "./routes/me";

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(meRoutes);
  return app;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/auth/__tests__/middleware.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and confirm everything is green**

Run: `npx jest`
Expected: all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add requireAuth middleware and protected /auth/me route"
```

---

### Task 9: Deploy to the Ubuntu server (pm2 + Cloudflare)

**Files:**
- Create: `ecosystem.config.js`

**Interfaces:**
- Consumes: the built `dist/` output from `npm run build`.
- Produces: a live HTTPS endpoint (`https://api.unitask.<your-domain>`) that Phase B's routes will be added to.

- [ ] **Step 1: Push this repository to a remote you control** (GitHub, or self-hosted git on the same Ubuntu server), so the server can `git clone`/`git pull` it.

- [ ] **Step 2: On the Ubuntu server, create the real database**

```bash
sudo -u postgres createdb unitask_sync
```

- [ ] **Step 3: Clone the repo on the server and install/build**

```bash
git clone <your-repo-url> unitask-sync-server
cd unitask-sync-server
npm ci
npm run build
```

- [ ] **Step 4: Create the server's real `.env`** (never committed) — generate strong secrets rather than reusing the local dev ones:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # run twice, once per secret
cp .env.example .env
# edit .env: real DATABASE_URL (unitask_sync, not the test db), the two generated secrets, PORT=8787
```

- [ ] **Step 5: Apply migrations against the real database**

```bash
npm run db:migrate
```

Expected: prints `Migrations applied.`

- [ ] **Step 6: Add `ecosystem.config.js` and start under pm2**

```js
module.exports = {
  apps: [
    {
      name: "unitask-sync-api",
      script: "dist/index.js",
      env_file: ".env",
    },
  ],
};
```

```bash
pm2 start ecosystem.config.js
pm2 save
```

- [ ] **Step 7: Add a reverse-proxy entry for the new subdomain**

If nginx already fronts your other pm2 sites, add a server block (adapt to Caddy or a Cloudflare Tunnel if that's what you actually use instead):

```
server {
    listen 80;
    server_name api.unitask.<your-domain>;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

- [ ] **Step 8: Add the Cloudflare DNS record**

Add an A (or CNAME) record for `api.unitask` pointing at the server's IP, proxied (orange cloud) so Cloudflare terminates TLS — same as your other sites.

- [ ] **Step 9: Verify from outside the server**

```bash
curl https://api.unitask.<your-domain>/health
# expected: {"status":"ok"}

curl -X POST https://api.unitask.<your-domain>/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"a-real-password"}'
# expected: 201, {"ok":true}
```

- [ ] **Step 10: Commit**

```bash
git add ecosystem.config.js
git commit -m "chore: add pm2 ecosystem config for deployment"
```

---

## Self-Review

**1. Spec coverage:** the design spec's §3 (architecture: Fastify + Drizzle + Postgres + pm2 + Cloudflare), and the auth half of §5.1 (`/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`) and §7 (deployment) are fully covered by Tasks 1–9. §4 (sync log/push/pull), the rest of §5 (`entities` table, `/sync/*`, attachment endpoints), and §6 (client changes) are explicitly out of scope for this phase — they are Phase B/C/D, per the Global Constraints section above.

**2. Placeholder scan:** no TBD/TODO; every step has complete, runnable code. The only intentionally-generic values are the deploy-time secrets and domain name in Task 9 (`<your-repo-url>`, `<your-domain>`), which cannot be known ahead of time and are called out as such rather than hidden behind vague prose.

**3. Type consistency:** `AccessTokenPayload { userId: string }` (Task 5) is used identically in `middleware.ts` (Task 8) and in the routes (Task 7). `User`/`RefreshToken` (Task 2) are used identically in `users-repository.ts` and `refresh-tokens-repository.ts`. The `Database` type alias pattern (`type Database = typeof defaultDb`) matches the existing UniTask client repository convention (`BaseSQLiteDatabase<...>` default-parameter pattern), applied here to Drizzle's Postgres client instead.
