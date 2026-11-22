import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const identityUrl = process.env.S4_URL ?? "http://127.0.0.1:3002";
const campaignsUrl = process.env.S1_URL ?? "http://127.0.0.1:3001";
const composeRoot = resolve(process.cwd(), "../..");
const aws = DynamoDBDocumentClient.from(new DynamoDBClient({
  endpoint: process.env.AWS_ENDPOINT_URL ?? "http://127.0.0.1:4566",
  region: process.env.AWS_REGION ?? "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
}));

async function api(url: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`${url}${path}`, options);
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: response.status, headers: response.headers, body };
}

const json = (value: unknown, token?: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(value),
});
const auth = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const pause = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  let value = await read();
  while (!ready(value) && Date.now() < deadline) {
    await pause(500);
    value = await read();
  }
  if (!ready(value)) throw new Error(`Timed out waiting for ${label}`);
  return value;
}

describe("Compose identity integration", () => {
  const created: string[] = [];
  afterAll(async () => aws.destroy());

  it("validates S4 auth, audit and history against Compose", async () => {
    const startedAt = new Date().toISOString();
    const tag = randomUUID().slice(0, 8);
    const ownerEmail = `codex-compose-${tag}@example.test`;
    const outsiderEmail = `codex-outsider-${tag}@example.test`;
    const ownerPassword = `Compose-${randomUUID()}-A9!`;
    const outsiderPassword = `Compose-${randomUUID()}-B8!`;
    const failedPassword = `wrong-${randomUUID()}-C7!`;
    const secrets: string[] = [ownerEmail, outsiderEmail, ownerPassword, outsiderPassword, failedPassword];
    const ownerUsername = `codex-${tag}`;
    const outsiderUsername = `outsider-${tag}`;

    const ownerRegistration = await api(identityUrl, "/auth/register", json({ username: ownerUsername, email: ownerEmail, password: ownerPassword }));
    expect(ownerRegistration.status).toBe(201);
    const ownerId = ownerRegistration.body.user.userId as string;
    const ownerAccess = ownerRegistration.body.tokens.accessToken as string;
    const ownerRefresh = ownerRegistration.body.tokens.refreshToken as string;
    secrets.push(ownerAccess, ownerRefresh);
    created.push(`owner=${ownerId}`);

    const ownerLogin = await api(identityUrl, "/auth/login", json({ identifier: ownerEmail, password: ownerPassword }));
    expect(ownerLogin.status).toBe(200);
    const loginAccess = ownerLogin.body.tokens.accessToken as string;
    secrets.push(loginAccess, ownerLogin.body.tokens.refreshToken as string);

    const failedLogin = await api(identityUrl, "/auth/login", json({ identifier: ownerUsername, password: failedPassword }));
    expect(failedLogin.status).toBe(401);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const lockAttempt = await api(identityUrl, "/auth/login", json({ identifier: ownerUsername, password: failedPassword }));
      if (lockAttempt.body?.tokens?.accessToken) secrets.push(lockAttempt.body.tokens.accessToken);
      expect([401, 429]).toContain(lockAttempt.status);
      if (lockAttempt.status === 429) break;
    }
    const locked = await api(identityUrl, "/auth/login", json({ identifier: ownerUsername, password: ownerPassword }));
    expect(locked.status).toBe(429);

    const rotated = await api(identityUrl, "/auth/refresh", json({ refreshToken: ownerRefresh }));
    expect(rotated.status).toBe(200);
    const newRefresh = rotated.body.refreshToken as string;
    const newAccess = rotated.body.accessToken as string;
    secrets.push(newRefresh, newAccess);
    const replay = await api(identityUrl, "/auth/refresh", json({ refreshToken: ownerRefresh }));
    expect(replay.status).toBe(401);
    const logout = await api(identityUrl, "/auth/logout", json({ refreshToken: newRefresh }));
    expect(logout.status).toBe(204);
    const refreshAfterLogout = await api(identityUrl, "/auth/refresh", json({ refreshToken: newRefresh }));
    expect(refreshAfterLogout.status).toBe(401);

    const outsiderRegistration = await api(identityUrl, "/auth/register", json({ username: outsiderUsername, email: outsiderEmail, password: outsiderPassword }));
    expect(outsiderRegistration.status).toBe(201);
    const outsiderId = outsiderRegistration.body.user.userId as string;
    const outsiderAccess = outsiderRegistration.body.tokens.accessToken as string;
    secrets.push(outsiderAccess, outsiderRegistration.body.tokens.refreshToken as string);
    created.push(`outsider=${outsiderId}`);

    const campaign = await api(campaignsUrl, "/campaigns", json({ name: `Codex integration ${tag}` }, ownerAccess));
    expect(campaign.status).toBe(201);
    const campaignId = campaign.body.campaignId as string;
    created.push(`campaign=${campaignId}`);

    const ownerHistory = await until(
      () => api(identityUrl, `/campaigns/${campaignId}/history`, auth(ownerAccess)),
      (result) => result.status === 200 && result.body.items?.some((item: any) => item.type === "MEMBER_JOINED"),
      "campaign history projection",
    );
    expect(ownerHistory.body.items.some((item: any) => item.type === "CAMPAIGN_CREATED")).toBe(true);
    expect((await api(identityUrl, `/campaigns/${campaignId}/history`)).status).toBe(401);
    expect((await api(identityUrl, `/campaigns/${campaignId}/history`, auth(outsiderAccess))).status).toBe(403);

    const audit = await aws.send(new ScanCommand({
      TableName: process.env.TABLE_AUDIT ?? "identity_audit",
      FilterExpression: "userId = :userId OR identifierHash = :identifierHash OR sessionId = :sessionId",
      ExpressionAttributeValues: {
        ":userId": ownerId,
        ":identifierHash": createHash("sha256").update(ownerUsername.toLowerCase()).digest("hex"),
        ":sessionId": ownerRefresh.split(".")[0],
      },
    }));
    const relatedAudit = (audit.Items ?? []).filter((item) => String(item.occurredAt) >= startedAt);
    const actions = new Set(relatedAudit.map((item) => item.action));
    for (const action of ["USER_REGISTERED", "LOGIN_SUCCEEDED", "LOGIN_FAILED", "LOGIN_LOCKED", "SESSION_REFRESHED", "SESSION_REFRESH_REJECTED", "SESSION_LOGGED_OUT"]) {
      expect(actions, `missing audit action ${action}`).toContain(action);
    }
    const serializedAudit = JSON.stringify(relatedAudit);
    for (const secret of secrets) expect(serializedAudit).not.toContain(secret);
    expect(serializedAudit).not.toContain(ownerPassword);
    expect(serializedAudit).not.toContain(ownerEmail);

    const logs = execFileSync("docker-compose", ["logs", "--since", "10m", "identity"], { cwd: composeRoot, encoding: "utf8" });
    for (const secret of secrets) expect(logs).not.toContain(secret);

    console.info(`Compose integration data created: tag=${tag}, ${created.join(", ")}`);
  }, 120_000);
});
