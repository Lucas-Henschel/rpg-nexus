import { describe, expect, it } from "vitest";
import { Unauthenticated } from "../../src/domain/errors.js";
import { createTokenVerifier } from "../../src/security/tokens.js";
import { AUTH_ENV, accessToken } from "../tokens.js";

const verify = createTokenVerifier(AUTH_ENV);
const ANA = { userId: "u-ana", username: "ana" };

describe("verifyAccess", () => {
  it("token válido do S4 → userId e username", () => {
    expect(verify(accessToken(ANA))).toEqual(ANA);
  });

  it.each([
    ["assinado com outro segredo", accessToken(ANA, {}, "outro-segredo-com-mais-de-32-caracteres")],
    ["expirado", accessToken(ANA, { exp: Math.floor(Date.now() / 1000) - 1 })],
    ["de outro emissor", accessToken(ANA, { iss: "outro" })],
    ["para outra audiência", accessToken(ANA, { aud: "outra" })],
    ["sem sub", accessToken(ANA, { sub: undefined })],
    ["sem username", accessToken(ANA, { username: 42 })],
    ["malformado", "abc.def"],
    ["com partes demais", `${accessToken(ANA)}.extra`],
  ])("%s → Unauthenticated", (_, token) => {
    expect(() => verify(token)).toThrow(Unauthenticated);
  });

  it("alg diferente de HS256 → Unauthenticated", () => {
    const [, payload, signature] = accessToken(ANA).split(".");
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");

    expect(() => verify(`${header}.${payload}.${signature}`)).toThrow(Unauthenticated);
  });
});
