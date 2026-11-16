// Liga e desliga o tracing (OpenTelemetry), no mesmo formato do S2 (W3C Trace Context).
//
// Os spans vão para o Jaeger pelo endpoint OTLP de OTEL_EXPORTER_OTLP_ENDPOINT, lido pelo
// exportador. Com TRACING_ENABLED=false (padrão fora do Docker), startTracing não é chamado:
// os spans criados pelo código não vão para lugar nenhum e tudo funciona igual.
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace";
import { fastifyOtel } from "./http.js";

let sdk: NodeSDK | undefined;

/** Junta os spans em lotes e manda para o Jaeger. */
function jaegerProcessor(): SpanProcessor {
  return new BatchSpanProcessor({ exporter: new OTLPTraceExporter() });
}

/** Liga o tracing. Os testes passam um processador que guarda os spans em memória. */
export function startTracing(
  serviceName: string,
  processor: SpanProcessor = jaegerProcessor(),
): void {
  sdk = new NodeSDK({
    serviceName,
    spanProcessors: [processor],
    instrumentations: [fastifyOtel],
  });

  sdk.start();
}

/** Manda o que ainda está em memória e desliga. */
export async function stopTracing(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}
