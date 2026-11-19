import { loadEnv } from "../src/config.js";
import { InvalidRefreshToken, UserAlreadyExists } from "../src/domain/errors.js";
import type { Session } from "../src/domain/session.js";
import type { User } from "../src/domain/user.js";
import type { SessionRepository } from "../src/repositories/session-repository.js";
import type { UserRepository } from "../src/repositories/user-repository.js";
import type { PasswordHasher } from "../src/security/passwords.js";
import { createTokenService } from "../src/security/tokens.js";
import { createIdentityService } from "../src/services/identity.js";

export function fakeDependencies() {
  const env = loadEnv({});
  const usersById = new Map<string, User>();
  const identities = new Map<string, string>();
  const sessionItems = new Map<string, Session>();

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

  return { env, users, sessions, passwords, tokens: createTokenService(env), usersById, sessionItems };
}

export function fakeIdentity() {
  const deps = fakeDependencies();
  return { deps, identity: createIdentityService(deps) };
}
