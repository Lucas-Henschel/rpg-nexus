import { FastifyOtelInstrumentation } from "@fastify/otel";

const UNTRACED_PATHS = ["/health", "/ready"];

export const fastifyOtel = new FastifyOtelInstrumentation({
  ignorePaths: ({ url }) => UNTRACED_PATHS.includes(url),
  instrumentHooks: false,
  instrumentHandler: false,
  requestHook: (span, request) =>
    span.updateName(
      `${request.method} ${request.routeOptions.url ?? request.url}`,
    ),
});
