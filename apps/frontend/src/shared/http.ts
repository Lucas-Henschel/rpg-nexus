/** Cliente HTTP mínimo, compartilhado por todos os adaptadores de serviço. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiResponse<T> {
  data: T;
  etag: string | null;
  status: number;
}

export async function request<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  let response: Response;
  try {
    response = await fetch(baseUrl + path, init);
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      `Sem resposta de ${baseUrl}. Confira se o serviço está no ar.`,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    // Formato de erro combinado entre os serviços: {"error": {"code", "message", "details"}}
    const error = (
      body as { error?: string | { code?: string; message?: string; details?: unknown } } | null
    )?.error;
    throw new ApiError(
      response.status,
      typeof error === "object" ? error?.code ?? "HTTP_ERROR" : "HTTP_ERROR",
      typeof error === "string" ? error : error?.message ?? `O serviço respondeu ${response.status}.`,
      typeof error === "object" ? error?.details : undefined,
    );
  }

  return { data: body as T, etag: response.headers.get("ETag"), status: response.status };
}

export function jsonBody(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  };
}

/** Texto para mostrar a quem usa: a mensagem do serviço quando ela existe, senão o texto padrão. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** 412: a versão enviada no If-Match não é mais a atual. */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 412;
}

/**
 * 403 NOT_CAMPAIGN_MEMBER do S2 ou do S3 logo depois de criar ou entrar numa campanha: o S2 conhece os
 * participantes pelos eventos do S1 (consistência eventual), e o evento pode ainda não ter chegado.
 * Vale tentar de novo por alguns segundos antes de mostrar o erro.
 */
export function isMembershipPending(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === "NOT_CAMPAIGN_MEMBER";
}

/** Esperas entre as tentativas enquanto o S2 não recebe a entrada na campanha (~10 s no total). */
export const MEMBERSHIP_RETRY_DELAYS_MS = [500, 1000, 1500, 2000, 2500, 3000];

export const MEMBERSHIP_GIVE_UP_MESSAGE =
  "Sua entrada na campanha ainda não chegou a este serviço. Aguarde alguns segundos e tente de novo.";

/** Roda `action`; se der NOT_CAMPAIGN_MEMBER, espera e repete. Avisa a tela a cada nova tentativa. */
export async function retryWhileMembershipPending<T>(
  action: () => Promise<T>,
  onRetry?: (attempt: number) => void,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      const delay = MEMBERSHIP_RETRY_DELAYS_MS[attempt];

      if (!isMembershipPending(error) || delay === undefined) {
        throw error;
      }

      onRetry?.(attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
