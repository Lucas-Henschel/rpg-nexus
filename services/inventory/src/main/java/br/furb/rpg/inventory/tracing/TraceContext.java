package br.furb.rpg.inventory.tracing;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapGetter;
import java.util.Map;

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
}
