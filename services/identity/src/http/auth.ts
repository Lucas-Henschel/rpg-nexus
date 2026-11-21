import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { InvalidAccessToken } from "../domain/errors.js";
import type { IdentityService } from "../services/identity.js";
import { LoginBody, RefreshBody, RegisterBody } from "./schemas.js";

export function bearerToken(header: string | undefined): string {
  const [scheme, token, extra] = header?.trim().split(/\s+/) ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) throw new InvalidAccessToken();
  return token;
}

export function authRoutes(service: IdentityService): FastifyPluginAsyncZod {
  return async (app) => {
    app.post("/auth/register", { schema: { body: RegisterBody } }, async (request, reply) => {
      return reply.status(201).send(await service.register(request.body));
    });

    app.post("/auth/login", { schema: { body: LoginBody } }, async (request) => {
      return service.login(request.body.identifier, request.body.password);
    });

    app.post("/auth/refresh", { schema: { body: RefreshBody } }, async (request) => {
      return service.refresh(request.body.refreshToken);
    });

    app.post("/auth/logout", { schema: { body: RefreshBody } }, async (request, reply) => {
      await service.logout(request.body.refreshToken);
      return reply.status(204).send();
    });

    app.get("/auth/me", async (request) => {
      return service.me(bearerToken(request.headers.authorization));
    });
  };
}
