import { identityUrl } from "../../shared/config";
import { jsonBody, request } from "../../shared/http";

export interface AuthUser {
  userId: string;
  username: string;
  email: string;
  globalRole: "USER";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export interface AuthSession {
  user: AuthUser;
  tokens: AuthTokens;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

export async function register(input: RegisterInput): Promise<AuthSession> {
  const response = await request<AuthSession>(identityUrl, "/auth/register", {
    ...jsonBody(input),
    method: "POST",
  });

  return response.data;
}

export async function login(identifier: string, password: string): Promise<AuthSession> {
  const response = await request<AuthSession>(identityUrl, "/auth/login", {
    ...jsonBody({ identifier, password }),
    method: "POST",
  });

  return response.data;
}

export async function currentUser(accessToken: string): Promise<AuthUser> {
  const response = await request<AuthUser>(identityUrl, "/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return response.data;
}

export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  const response = await request<AuthTokens>(identityUrl, "/auth/refresh", {
    ...jsonBody({ refreshToken }),
    method: "POST",
  });

  return response.data;
}

export async function endSession(refreshToken: string): Promise<void> {
  await request<null>(identityUrl, "/auth/logout", {
    ...jsonBody({ refreshToken }),
    method: "POST",
  });
}
