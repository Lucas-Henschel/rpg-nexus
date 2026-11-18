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
