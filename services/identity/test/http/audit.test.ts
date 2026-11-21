import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/http/app.js";
import { fakeHistory, fakeIdentity } from "../fakes.js";

const registration = { username: "AuditUser", email: "audit-user@example.test", password: "audit-password-123" };

function auditApp() {
  const { deps, identity } = fakeIdentity();
  const app = buildApp({
    env: deps.env,
    identity,
    history: fakeHistory(),
    pingDatabase: async () => {},
    logger: false,
  });
  return { app, deps };
}

describe("auditoria de identidade", () => {
  it("registra todas as ações de autenticação sem guardar credenciais ou tokens", async () => {
    const { app, deps } = auditApp();

    const registered = await app.inject({ method: "POST", url: "/auth/register", payload: registration });
    const registeredBody = registered.json();
    const accessToken = registeredBody.tokens.accessToken as string;
    const initialRefreshToken = registeredBody.tokens.refreshToken as string;

    await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { identifier: registration.username, password: registration.password },
    });
    await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { identifier: registration.email, password: "wrong-password" },
    });

    for (let attempt = 0; attempt < deps.env.LOGIN_MAX_ATTEMPTS; attempt += 1) {
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { identifier: "locked-user@example.test", password: "wrong-password" },
      });
    }
    await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { identifier: "locked-user@example.test", password: "wrong-password" },
    });

    const refreshed = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: initialRefreshToken },
    });
    const nextRefreshToken = refreshed.json().refreshToken as string;
    await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: initialRefreshToken } });
    await app.inject({ method: "POST", url: "/auth/logout", payload: { refreshToken: nextRefreshToken } });

    const user = [...deps.usersById.values()][0]!;
    deps.usersById.set(user.userId, { ...user, active: false });
    await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { identifier: registration.username, password: registration.password },
    });

    const actions = new Set(deps.auditEvents.map((event) => event.action));
    expect(actions).toEqual(
      new Set([
        "USER_REGISTERED",
        "LOGIN_SUCCEEDED",
        "LOGIN_FAILED",
        "LOGIN_LOCKED",
        "LOGIN_REJECTED_INACTIVE_USER",
        "SESSION_REFRESHED",
        "SESSION_REFRESH_REJECTED",
        "SESSION_LOGGED_OUT",
      ]),
    );

    const serializedAudit = JSON.stringify(deps.auditEvents);
    for (const secret of [
      registration.email,
      registration.password,
      "wrong-password",
      accessToken,
      initialRefreshToken,
      nextRefreshToken,
    ]) {
      expect(serializedAudit).not.toContain(secret);
    }

    const allowedFields = new Set([
      "auditId",
      "action",
      "occurredAt",
      "outcome",
      "userId",
      "identifierHash",
      "sessionId",
      "reason",
    ]);
    for (const event of deps.auditEvents) {
      expect(Object.keys(event).every((key) => allowedFields.has(key))).toBe(true);
    }

    const failedLogin = deps.auditEvents.find((event) => event.action === "LOGIN_FAILED");
    expect(failedLogin?.identifierHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
