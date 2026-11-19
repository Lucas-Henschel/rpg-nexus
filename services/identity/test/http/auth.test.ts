import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/http/app.js";
import { fakeIdentity } from "../fakes.js";

function testApp() {
  const { deps, identity } = fakeIdentity();
  return buildApp({ env: deps.env, identity, pingDatabase: async () => {}, logger: false });
}

const registration = { username: "Morgana", email: "morgana@example.com", password: "senha-segura-123" };

describe("POST /auth/register", () => {
  it("cria USER, inicia sessão e nunca devolve o hash da senha", async () => {
    const response = await testApp().inject({ method: "POST", url: "/auth/register", payload: registration });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.user).toMatchObject({
      userId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      username: "Morgana",
      email: "morgana@example.com",
      globalRole: "USER",
      active: true,
    });
    expect(body.tokens).toMatchObject({ tokenType: "Bearer", expiresIn: 900 });
    expect(body.tokens.accessToken.split(".")).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("senha-segura-123");
  });

  it("garante unicidade case-insensitive de e-mail e username", async () => {
    const app = testApp();
    await app.inject({ method: "POST", url: "/auth/register", payload: registration });
    const duplicate = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...registration, username: "outra", email: "MORGANA@example.com" },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: "USER_ALREADY_EXISTS" } });
  });

  it("rejeita senha curta com 422", async () => {
    const response = await testApp().inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...registration, password: "123" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", details: [{ field: "password" }] } });
  });
});

describe("CORS local", () => {
  it.each(["http://localhost:5173", "http://127.0.0.1:5173"])(
    "autoriza o front-end em %s",
    async (origin) => {
      const response = await testApp().inject({
        method: "OPTIONS",
        url: "/auth/login",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
    },
  );
});

describe("sessão", () => {
  it("faz login por e-mail ou username e não revela qual credencial falhou", async () => {
    const app = testApp();
    await app.inject({ method: "POST", url: "/auth/register", payload: registration });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { identifier: "morgana", password: registration.password },
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { identifier: registration.email, password: "senha-incorreta" },
    });

    expect(login.statusCode).toBe(200);
    expect(login.json().user.username).toBe("Morgana");
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
  });

  it("GET /auth/me exige token válido", async () => {
    const app = testApp();
    const registered = await app.inject({ method: "POST", url: "/auth/register", payload: registration });
    const accessToken = registered.json().tokens.accessToken;

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${accessToken}` } });
    const anonymous = await app.inject({ method: "GET", url: "/auth/me" });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ username: "Morgana", email: registration.email });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: { code: "INVALID_ACCESS_TOKEN" } });
  });

  it("rotaciona refresh token e invalida o anterior", async () => {
    const app = testApp();
    const registered = await app.inject({ method: "POST", url: "/auth/register", payload: registration });
    const first = registered.json().tokens.refreshToken;
    const refreshed = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: first } });
    const replay = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: first } });

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().refreshToken).not.toBe(first);
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toMatchObject({ error: { code: "INVALID_REFRESH_TOKEN" } });
  });

  it("logout revoga a sessão e continua idempotente", async () => {
    const app = testApp();
    const registered = await app.inject({ method: "POST", url: "/auth/register", payload: registration });
    const refreshToken = registered.json().tokens.refreshToken;

    const logout = await app.inject({ method: "POST", url: "/auth/logout", payload: { refreshToken } });
    const repeated = await app.inject({ method: "POST", url: "/auth/logout", payload: { refreshToken } });
    const refresh = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });

    expect(logout.statusCode).toBe(204);
    expect(repeated.statusCode).toBe(204);
    expect(refresh.statusCode).toBe(401);
  });
});
