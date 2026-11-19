// Validação do access token emitido pelo S4 (HS256, segredo compartilhado). O S1 só lê quem é o
// usuário; quem pode o quê dentro da campanha é decidido aqui, pelos papéis OWNER e PLAYER.
import { createHmac, timingSafeEqual } from "node:crypto";
import { Unauthenticated } from "../domain/errors.js";
import type { AuthUser } from "../domain/user.js";

export interface TokenSettings {
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
}

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

export function createTokenVerifier({ JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE }: TokenSettings) {
  const sign = (value: string) => createHmac("sha256", JWT_SECRET).update(value).digest();

  /** O usuário do token. Lança Unauthenticated se a assinatura, o emissor, a audiência ou a validade falharem. */
  return function verifyAccess(token: string): AuthUser {
    const parts = token.split(".");
    const [header, payload, signature] = parts;

    if (parts.length !== 3 || !header || !payload || !signature) {
      throw new Unauthenticated();
    }

    const actual = Buffer.from(signature, "base64url");
    const expected = sign(`${header}.${payload}`);

    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Unauthenticated();
    }

    let head: Record<string, unknown>;
    let claims: Record<string, unknown>;

    try {
      head = decode(header);
      claims = decode(payload);
    } catch {
      throw new Unauthenticated();
    }

    const now = Math.floor(Date.now() / 1000);

    if (
      head.alg !== "HS256" ||
      claims.iss !== JWT_ISSUER ||
      claims.aud !== JWT_AUDIENCE ||
      typeof claims.exp !== "number" ||
      claims.exp <= now ||
      typeof claims.sub !== "string" ||
      typeof claims.username !== "string"
    ) {
      throw new Unauthenticated();
    }

    return { userId: claims.sub, username: claims.username };
  };
}

export type TokenVerifier = ReturnType<typeof createTokenVerifier>;
