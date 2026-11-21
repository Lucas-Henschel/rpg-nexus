import { loadEnv } from "../src/config.js";
import { InvalidRefreshToken, UserAlreadyExists } from "../src/domain/errors.js";
import type { Session } from "../src/domain/session.js";
import type { User } from "../src/domain/user.js";
import type { LoginAttemptRepository } from "../src/repositories/login-attempt-repository.js";
import type { SessionRepository } from "../src/repositories/session-repository.js";
import type { UserRepository } from "../src/repositories/user-repository.js";
import type { PasswordHasher } from "../src/security/passwords.js";
import { createTokenService } from "../src/security/tokens.js";
import { createIdentityService } from "../src/services/identity.js";
import type { HistoryService } from "../src/services/history.js";

export function fakeDependencies() {
  const env = loadEnv({});
  const usersById = new Map<string, User>();
  const identities = new Map<string, string>();
  const sessionItems = new Map<string, Session>();
  const loginFailures = new Map<string, { bucket: number; attempts: number; lockedUntil: number }>();
  const auditEvents: import("../src/domain/audit.js").AuditEvent[] = [];

  const users: UserRepository = {
    async create(user) {
      const email = `email#${user.normalizedEmail}`;
      const username = `username#${user.normalizedUsername}`;
      if (identities.has(email) || identities.has(username)) throw new UserAlreadyExists();
      usersById.set(user.userId, structuredClone(user));
      identities.set(email, user.userId);
      identities.set(username, user.userId);
    },
    async findById(userId) {
      return structuredClone(usersById.get(userId) ?? null);
    },
    async findByIdentifier(identifier) {
      const normalized = identifier.trim().toLowerCase();
      const key = `${normalized.includes("@") ? "email" : "username"}#${normalized}`;
      const userId = identities.get(key);
      return userId ? structuredClone(usersById.get(userId) ?? null) : null;
    },
  };

  const loginAttempts: LoginAttemptRepository = {
    async lockedFor(identifier, nowSeconds) {
      return Math.max((loginFailures.get(identifier)?.lockedUntil ?? 0) - nowSeconds, 0);
    },
    async recordFailure(identifier, nowSeconds) {
      const bucket = Math.floor(nowSeconds / env.LOGIN_ATTEMPT_WINDOW_SECONDS);
      const current = loginFailures.get(identifier);
      const attempts = current?.bucket === bucket ? current.attempts + 1 : 1;
      const lockedUntil = attempts >= env.LOGIN_MAX_ATTEMPTS ? nowSeconds + env.LOGIN_LOCK_SECONDS : 0;
      loginFailures.set(identifier, { bucket, attempts, lockedUntil });
      return Math.max(lockedUntil - nowSeconds, 0);
    },
    async clear(identifier) {
      loginFailures.delete(identifier);
    },
  };

  const sessions: SessionRepository = {
    async create(session) {
      sessionItems.set(session.sessionId, structuredClone(session));
    },
    async find(sessionId) {
      return structuredClone(sessionItems.get(sessionId) ?? null);
    },
    async rotate(sessionId, currentHash, next) {
      const session = sessionItems.get(sessionId);
      if (!session || session.revokedAt || session.tokenHash !== currentHash) throw new InvalidRefreshToken();
      sessionItems.set(sessionId, { ...session, ...next });
    },
    async revoke(sessionId, tokenHash, revokedAt) {
      const session = sessionItems.get(sessionId);
      if (session && !session.revokedAt && session.tokenHash === tokenHash) {
        sessionItems.set(sessionId, { ...session, revokedAt, updatedAt: revokedAt });
      }
    },
  };

  const passwords: PasswordHasher = {
    async hash(password) {
      return `hashed:${password}`;
    },
    async verify(password, encodedHash) {
      return encodedHash === `hashed:${password}`;
    },
  };

  return {
    env, users, sessions, loginAttempts, passwords, tokens: createTokenService(env),
    audit: { async record(event: import("../src/domain/audit.js").AuditEvent) { auditEvents.push(structuredClone(event)); } },
    auditEvents,
    usersById, sessionItems, loginFailures,
  };
}

export function fakeIdentity() {
  const deps = fakeDependencies();
  return { deps, identity: createIdentityService(deps) };
}

export function fakeHistory(): HistoryService {
  return {
    async record() { return "applied"; },
    async list() { return []; },
  };
}
