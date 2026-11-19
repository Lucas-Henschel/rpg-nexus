/**
 * Sessão do S4 guardada no navegador. Entrega o access token às chamadas dos outros serviços e o
 * renova sozinho: antes de expirar, ou quando um serviço responde 401.
 *
 * - Uma renovação por vez: chamadas simultâneas (e o efeito duplicado do StrictMode) esperam a mesma.
 * - Outra aba pode ter renovado antes: o refresh token antigo já não vale, então usa o que ela gravou.
 * - A sessão só é apagada quando o S4 recusa o refresh token (401), nunca por falha de rede.
 */
import { ApiError, request, type ApiResponse } from "../../shared/http";
import { refreshSession, type AuthSession, type AuthTokens, type AuthUser } from "./api";

const STORAGE_KEY = "rpg-nexus.auth";
/** Renova um pouco antes de expirar, para a chamada não sair com um token vencendo no caminho. */
const RENEW_MARGIN_MS = 30_000;

export interface StoredSession extends AuthSession {
  /** Quando o access token expira, em ms desde 1970. */
  expiresAt: number;
}

export function readSession(): StoredSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    return stored ? (JSON.parse(stored) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(user: AuthUser, tokens: AuthTokens): void {
  const session: StoredSession = { user, tokens, expiresAt: Date.now() + tokens.expiresIn * 1000 };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* armazenamento indisponível: a sessão vale só enquanto a página estiver aberta */
  }
}

/** Atualiza só os dados do usuário, mantendo os tokens e a validade gravados. */
export function saveUser(user: AuthUser): void {
  const saved = readSession();

  if (saved) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, user }));
    } catch {
      /* armazenamento indisponível */
    }
  }
}

/** Avisos de sessão encerrada (refresh recusado), para o AuthProvider voltar ao login. */
const listeners = new Set<() => void>();

export function onSessionEnded(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nada a apagar */
  }
}

function endSession(): void {
  clearSession();
  listeners.forEach((listener) => listener());
}

export const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

let renewing: Promise<StoredSession> | null = null;

/** Troca o refresh token por tokens novos; uma vez só, mesmo com várias chamadas ao mesmo tempo. */
export function renewSession(): Promise<StoredSession> {
  renewing ??= (async () => {
    const saved = readSession();

    if (!saved) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sessão encerrada. Entre de novo.");
    }

    try {
      saveSession(saved.user, await refreshSession(saved.tokens.refreshToken));
    } catch (error) {
      const latest = readSession();

      // Outra aba renovou primeiro e gravou tokens novos: segue com eles.
      if (isUnauthorized(error) && latest && latest.tokens.refreshToken !== saved.tokens.refreshToken) {
        return latest;
      }

      if (isUnauthorized(error)) {
        endSession();
      }

      throw error;
    }

    return readSession()!;
  })().finally(() => {
    renewing = null;
  });

  return renewing;
}

/** Access token válido, renovando antes se ele estiver para expirar. */
export async function accessToken(): Promise<string> {
  const saved = readSession();

  if (!saved) {
    throw new ApiError(401, "UNAUTHENTICATED", "Sessão encerrada. Entre de novo.");
  }

  if (saved.expiresAt - RENEW_MARGIN_MS > Date.now()) {
    return saved.tokens.accessToken;
  }

  return (await renewSession()).tokens.accessToken;
}

/** Como `request`, mas com o access token. Num 401, renova uma vez e repete a chamada. */
export async function authorizedRequest<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  const call = (token: string) =>
    request<T>(baseUrl, path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });

  try {
    return await call(await accessToken());
  } catch (error) {
    if (!isUnauthorized(error)) {
      throw error;
    }

    return call((await renewSession()).tokens.accessToken);
  }
}
