package br.furb.rpg.inventory.adapters.rabbitmq;

import br.furb.rpg.inventory.ports.OutboxPort;
import br.furb.rpg.inventory.tracing.TraceContext;
import io.opentelemetry.context.Scope;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

@Component
@ConditionalOnProperty(name="inventory.run-schedulers", havingValue="true", matchIfMissing=true)
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
            // Continua o trace de quem gravou o evento: o agente do OpenTelemetry cria o span de
            // publicação como filho desse contexto (sem um segundo span manual).
            try (Scope scope=TraceContext.extract(row.traceparent()).makeCurrent()) {
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
            } catch(Exception e) { /* pending event remains durable for the next pass */ }
        }
    }
}
