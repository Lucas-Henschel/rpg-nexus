// Spans das requisições HTTP, com o plugin oficial do Fastify. O app.ts o registra antes das rotas.
import { FastifyOtelInstrumentation } from "@fastify/otel";

const UNTRACED_PATHS = ["/health", "/ready"];

export const fastifyOtel = new FastifyOtelInstrumentation({
  ignorePaths: ({ url }) => UNTRACED_PATHS.includes(url),
  instrumentHooks: false,
  instrumentHandler: false,

  // O span se chama "request" por padrão; vira "POST /campaigns", "GET /campaigns/:campaignId"...
  requestHook: (span, request) => {
    const route = request.routeOptions.url ?? request.url;

    span.updateName(`${request.method} ${route}`);
  },
});
