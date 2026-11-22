import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace";
import { fastifyOtel } from "./http.js";

let sdk: NodeSDK | undefined;

function jaegerProcessor(): SpanProcessor {
  return new BatchSpanProcessor({ exporter: new OTLPTraceExporter() });
}

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

export async function stopTracing(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}
