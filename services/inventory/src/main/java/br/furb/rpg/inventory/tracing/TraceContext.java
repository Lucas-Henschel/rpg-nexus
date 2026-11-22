package br.furb.rpg.inventory.tracing;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import io.opentelemetry.context.propagation.TextMapGetter;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/** Helpers for preserving W3C trace context across the durable outbox boundary. */
public final class TraceContext {
    private static final TextMapGetter<Map<String, String>> GETTER = new TextMapGetter<>() {
        @Override public Iterable<String> keys(Map<String, String> carrier) { return carrier.keySet(); }
        @Override public String get(Map<String, String> carrier, String key) { return carrier.get(key); }
    };

    private TraceContext() {}

    public static String currentTraceparent() {
        SpanContext context = Span.current().getSpanContext();
        if (!context.isValid()) return null;
        return "00-" + context.getTraceId() + "-" + context.getSpanId() + "-" + context.getTraceFlags().asHex();
    }

    public static Context extract(String traceparent) {
        if (traceparent == null || traceparent.isBlank()) return Context.root();
        return GlobalOpenTelemetry.getPropagators().getTextMapPropagator()
            .extract(Context.root(), Map.of("traceparent", traceparent), GETTER);
    }

    /**
     * Roda sem gerar trace quando não há um em andamento, como nas varreduras do ExpirationWorker e da
     * outbox a cada 2 s: o pai não amostrado faz o agente descartar os spans do DynamoDB. Dentro de uma
     * requisição ou mensagem, o trace atual continua valendo.
     */
    public static <T> T untracedIfRoot(Supplier<T> work) {
        if (Span.current().getSpanContext().isValid()) return work.get();
        var random = ThreadLocalRandom.current();
        var unsampled = SpanContext.create(
            String.format("%016x%016x", random.nextLong() | 1, random.nextLong()),
            String.format("%016x", random.nextLong() | 1),
            TraceFlags.getDefault(), TraceState.getDefault());
        try (Scope scope = Context.root().with(Span.wrap(unsampled)).makeCurrent()) {
            return work.get();
        }
    }
}
