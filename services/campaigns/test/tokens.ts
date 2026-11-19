import { createHmac } from "node:crypto";

/** Segredo, emissor e audiência dos testes; os mesmos que o S4 usa no ambiente local. */
export const AUTH_ENV = {
  JWT_SECRET: "test-only-jwt-secret-with-32-characters",
  JWT_ISSUER: "rpg-nexus-identity",
  JWT_AUDIENCE: "rpg-nexus-services",
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Access token HS256 como o S4 emite. `overrides` troca campos do payload, para os casos inválidos. */
export function accessToken(
  user: { userId: string; username: string },
  overrides: Record<string, unknown> = {},
  secret = AUTH_ENV.JWT_SECRET,
): string {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: user.userId,
    username: user.username,
    email: `${user.username}@exemplo.com`,
    globalRole: "USER",
    iss: AUTH_ENV.JWT_ISSUER,
    aud: AUTH_ENV.JWT_AUDIENCE,
    iat: now,
    exp: now + 900,
    ...overrides,
  })}`;

  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}
