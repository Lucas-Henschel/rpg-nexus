import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Env } from "../config.js";
import { InvalidAccessToken, InvalidRefreshToken } from "../domain/errors.js";
import type { User } from "../domain/user.js";

export interface AccessClaims {
  userId: string;
  username: string;
  email: string;
  globalRole: "USER";
}

export interface TokenService {
  signAccess(user: User): Promise<string>;
  verifyAccess(token: string): Promise<AccessClaims>;
  newRefreshToken(sessionId?: string): { sessionId: string; token: string; tokenHash: string };
  parseRefreshToken(token: string): { sessionId: string; tokenHash: string };
  matchesRefreshToken(token: string, expectedHash: string): boolean;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

export function createTokenService(env: Env): TokenService {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = (value: string) => createHmac("sha256", env.JWT_SECRET).update(value).digest("base64url");

  return {
    async signAccess(user) {
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
        sub: user.userId,
        username: user.username,
        email: user.email,
        globalRole: user.globalRole,
        iss: env.JWT_ISSUER,
        aud: env.JWT_AUDIENCE,
        iat: now,
        exp: now + env.ACCESS_TOKEN_TTL_SECONDS,
      })}`;
      return `${unsigned}.${signature(unsigned)}`;
    },

    async verifyAccess(token) {
      try {
        const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
        if (!headerPart || !payloadPart || !signaturePart || extra) throw new InvalidAccessToken();
        const unsigned = `${headerPart}.${payloadPart}`;
        const actual = Buffer.from(signaturePart);
        const expected = Buffer.from(signature(unsigned));
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new InvalidAccessToken();

        const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as Record<string, unknown>;
        const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<string, unknown>;
        const now = Math.floor(Date.now() / 1000);
        if (
          header.alg !== "HS256" ||
          header.typ !== "JWT" ||
          payload.iss !== env.JWT_ISSUER ||
          payload.aud !== env.JWT_AUDIENCE ||
          typeof payload.exp !== "number" ||
          payload.exp <= now ||
          typeof payload.sub !== "string" ||
          typeof payload.username !== "string" ||
          typeof payload.email !== "string" ||
          payload.globalRole !== "USER"
        ) {
          throw new InvalidAccessToken();
        }

        return {
          userId: payload.sub,
          username: payload.username,
          email: payload.email,
          globalRole: payload.globalRole,
        };
      } catch {
        throw new InvalidAccessToken();
      }
    },

    newRefreshToken(existingSessionId) {
      const sessionId = existingSessionId ?? randomUUID();
      const token = `${sessionId}.${randomBytes(32).toString("base64url")}`;
      return { sessionId, token, tokenHash: hashToken(token) };
    },

    parseRefreshToken(token) {
      const separator = token.indexOf(".");
      if (separator < 1 || separator === token.length - 1) throw new InvalidRefreshToken();

      return { sessionId: token.slice(0, separator), tokenHash: hashToken(token) };
    },

    matchesRefreshToken(token, expectedHash) {
      const actual = Buffer.from(hashToken(token));
      const expected = Buffer.from(expectedHash);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    },
  };
}
