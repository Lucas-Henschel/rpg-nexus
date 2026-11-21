import { createHash, randomUUID } from "node:crypto";
import type { Env } from "../config.js";
import type { AuditAction, AuditRepository } from "../domain/audit.js";
import {
  InvalidAccessToken,
  InvalidCredentials,
  InvalidRefreshToken,
  LoginTemporarilyLocked,
  UserInactive,
} from "../domain/errors.js";
import type { Session } from "../domain/session.js";
import { toPublicUser, type User } from "../domain/user.js";
import type { LoginAttemptRepository } from "../repositories/login-attempt-repository.js";
import type { SessionRepository } from "../repositories/session-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import type { PasswordHasher } from "../security/passwords.js";
import type { TokenService } from "../security/tokens.js";

export interface IdentityDependencies {
  env: Env;
  users: UserRepository;
  sessions: SessionRepository;
  loginAttempts: LoginAttemptRepository;
  passwords: PasswordHasher;
  tokens: TokenService;
  audit: AuditRepository;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

export type Clock = () => Date;
const systemClock: Clock = () => new Date();

export function createIdentityService(deps: IdentityDependencies, clock: Clock = systemClock) {
  async function audit(
    action: AuditAction,
    outcome: "SUCCESS" | "FAILURE",
    details: { userId?: string; identifierHash?: string; sessionId?: string; reason?: string } = {},
  ) {
    await deps.audit.record({ auditId: randomUUID(), action, outcome, occurredAt: clock().toISOString(), ...details });
  }

  async function issueTokens(user: User, now: Date) {
    const refresh = deps.tokens.newRefreshToken();
    const timestamp = now.toISOString();
    const session: Session = {
      sessionId: refresh.sessionId,
      userId: user.userId,
      tokenHash: refresh.tokenHash,
      expiresAt: Math.floor(now.getTime() / 1000) + deps.env.REFRESH_TOKEN_TTL_SECONDS,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await deps.sessions.create(session);

    return {
      accessToken: await deps.tokens.signAccess(user),
      refreshToken: refresh.token,
      tokenType: "Bearer" as const,
      expiresIn: deps.env.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async function requireActiveUser(userId: string): Promise<User> {
    const user = await deps.users.findById(userId);
    if (!user) throw new InvalidAccessToken();
    if (!user.active) throw new UserInactive(user.userId);
    return user;
  }

  return {
    async register(input: RegisterInput) {
      const now = clock();
      const timestamp = now.toISOString();
      const user: User = {
        userId: randomUUID(),
        username: input.username.trim(),
        normalizedUsername: input.username.trim().toLowerCase(),
        email: input.email.trim().toLowerCase(),
        normalizedEmail: input.email.trim().toLowerCase(),
        passwordHash: await deps.passwords.hash(input.password),
        globalRole: "USER",
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await deps.users.create(user);
      await audit("USER_REGISTERED", "SUCCESS", { userId: user.userId });
      return { user: toPublicUser(user), tokens: await issueTokens(user, now) };
    },

    async login(identifier: string, password: string) {
      const normalized = identifier.trim().toLowerCase();
      const now = clock();
      const nowSeconds = Math.floor(now.getTime() / 1000);
      const identifierHash = createHash("sha256").update(normalized).digest("hex");
      const retryAfter = await deps.loginAttempts.lockedFor(normalized, nowSeconds);
      if (retryAfter > 0) {
        await audit("LOGIN_LOCKED", "FAILURE", { identifierHash, reason: "TEMPORARY_LOCK_ACTIVE" });
        throw new LoginTemporarilyLocked(retryAfter);
      }

      const user = await deps.users.findByIdentifier(normalized);
      if (!user || !(await deps.passwords.verify(password, user.passwordHash))) {
        const lockedFor = await deps.loginAttempts.recordFailure(normalized, nowSeconds);
        if (lockedFor > 0) {
          await audit("LOGIN_LOCKED", "FAILURE", { identifierHash, reason: "ATTEMPT_LIMIT_REACHED" });
          throw new LoginTemporarilyLocked(lockedFor);
        }
        await audit("LOGIN_FAILED", "FAILURE", { identifierHash, reason: "INVALID_CREDENTIALS" });
        throw new InvalidCredentials();
      }

      await deps.loginAttempts.clear(normalized, nowSeconds);
      if (!user.active) {
        await audit("LOGIN_REJECTED_INACTIVE_USER", "FAILURE", { userId: user.userId, identifierHash });
        throw new UserInactive(user.userId);
      }
      await audit("LOGIN_SUCCEEDED", "SUCCESS", { userId: user.userId });
      return { user: toPublicUser(user), tokens: await issueTokens(user, now) };
    },

    async refresh(refreshToken: string) {
      const parsed = deps.tokens.parseRefreshToken(refreshToken);
      const current = await deps.sessions.find(parsed.sessionId);
      const now = clock();

      if (
        !current ||
        current.revokedAt ||
        current.expiresAt <= Math.floor(now.getTime() / 1000) ||
        !deps.tokens.matchesRefreshToken(refreshToken, current.tokenHash)
      ) {
        await audit("SESSION_REFRESH_REJECTED", "FAILURE", { sessionId: parsed.sessionId, reason: "INVALID_OR_EXPIRED" });
        throw new InvalidRefreshToken();
      }

      const user = await requireActiveUser(current.userId);
      const next = deps.tokens.newRefreshToken(current.sessionId);
      await deps.sessions.rotate(current.sessionId, current.tokenHash, {
        tokenHash: next.tokenHash,
        expiresAt: Math.floor(now.getTime() / 1000) + deps.env.REFRESH_TOKEN_TTL_SECONDS,
        updatedAt: now.toISOString(),
      });
      await audit("SESSION_REFRESHED", "SUCCESS", { userId: user.userId, sessionId: current.sessionId });

      return {
        accessToken: await deps.tokens.signAccess(user),
        refreshToken: next.token,
        tokenType: "Bearer" as const,
        expiresIn: deps.env.ACCESS_TOKEN_TTL_SECONDS,
      };
    },

    async logout(refreshToken: string) {
      let parsed: { sessionId: string; tokenHash: string };
      try {
        parsed = deps.tokens.parseRefreshToken(refreshToken);
      } catch {
        return;
      }
      await deps.sessions.revoke(parsed.sessionId, parsed.tokenHash, clock().toISOString());
      await audit("SESSION_LOGGED_OUT", "SUCCESS", { sessionId: parsed.sessionId });
    },

    async me(accessToken: string) {
      const claims = await deps.tokens.verifyAccess(accessToken);
      return toPublicUser(await requireActiveUser(claims.userId));
    },
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
