package br.furb.rpg.inventory.adapters.rabbitmq;

import br.furb.rpg.inventory.ports.OutboxPort;
import br.furb.rpg.inventory.tracing.TraceContext;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.context.Scope;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
class OutboxPublisher {
    private final OutboxPort outbox;
    private final RabbitTemplate rabbit;
    private final String exchange;
    OutboxPublisher(OutboxPort outbox, RabbitTemplate rabbit, @Value("${inventory.exchange}") String exchange) {
        this.outbox=outbox; this.rabbit=rabbit; this.exchange=exchange;
    }

    @Scheduled(fixedDelay=2000)
    void publish() {
        for(var row:outbox.pendingEvents()) {
            var span=GlobalOpenTelemetry.getTracer("rpg-nexus.inventory")
                .spanBuilder(row.route()+" publish")
                .setParent(TraceContext.extract(row.traceparent()))
                .setSpanKind(SpanKind.PRODUCER)
                .setAttribute("messaging.system","rabbitmq")
                .setAttribute("messaging.operation","publish")
                .setAttribute("messaging.destination.name",row.route())
                .startSpan();
            try (Scope scope=span.makeCurrent()) {
                rabbit.invoke(ops -> {
                    ops.convertAndSend(exchange,row.route(),row.envelope(),m -> {
                        String traceparent=TraceContext.currentTraceparent();
                        if(traceparent!=null) m.getMessageProperties().setHeader("traceparent",traceparent);
                        m.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);return m;
                    });
                    ops.waitForConfirmsOrDie(5000);
                    return null;
                });
                outbox.markPublished(row.id());
            } catch(Exception e) {
                span.recordException(e);
                span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR);
                /* pending event remains durable for the next pass */
            } finally { span.end(); }
        }
    }
}
