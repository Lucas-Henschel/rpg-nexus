// Exige o access token do S4 nas rotas do plugin em que é registrado; /health e /ready ficam de fora.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Unauthenticated } from "../domain/errors.js";
import type { AuthUser } from "../domain/user.js";
import type { TokenVerifier } from "../security/tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Quem fez a requisição. Só existe nas rotas que exigem login. */
    user?: AuthUser;
  }
}

function bearerToken(header: string | undefined): string {
  const [scheme, token, extra] = header?.trim().split(/\s+/) ?? [];

  if (scheme?.toLowerCase() !== "bearer" || !token || extra) {
    throw new Unauthenticated();
  }

  return token;
}

export function requireLogin(app: FastifyInstance, verify: TokenVerifier): void {
  // onRequest: recusa antes de ler o corpo.
  app.addHook("onRequest", async (request) => {
    request.user = verify(bearerToken(request.headers.authorization));
  });
}

/** O usuário da requisição; só vale em rota protegida por requireLogin. */
export function userOf(request: FastifyRequest): AuthUser {
  if (!request.user) {
    throw new Unauthenticated();
  }

  return request.user;
}
