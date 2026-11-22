package br.furb.rpg.inventory.tracing;

import static org.assertj.core.api.Assertions.assertThat;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class TraceContextTest {
    private static final SpanContext REQUEST = SpanContext.create("0af7651916cd43dd8448eb211c80319c",
        "b7ad6b7169203331", TraceFlags.getSampled(), TraceState.getDefault());

    @Test @DisplayName("sem trace em andamento (varredura periódica), roda sob um pai não amostrado")
    void untracedWhenRoot() {
        SpanContext seen = TraceContext.untracedIfRoot(() -> Span.current().getSpanContext());
        assertThat(seen.isValid()).isTrue();
        assertThat(seen.isSampled()).isFalse();
    }

    @Test @DisplayName("dentro de uma requisição, mantém o trace dela")
    void keepsCurrentTrace() {
        try (var scope = Context.root().with(Span.wrap(REQUEST)).makeCurrent()) {
            SpanContext seen = TraceContext.untracedIfRoot(() -> Span.current().getSpanContext());
            assertThat(seen).isEqualTo(REQUEST);
        }
    }
}
