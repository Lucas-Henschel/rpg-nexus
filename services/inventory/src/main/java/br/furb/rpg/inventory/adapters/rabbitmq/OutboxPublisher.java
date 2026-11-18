package br.furb.rpg.inventory.adapters.rabbitmq;

import br.furb.rpg.inventory.ports.OutboxPort;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
class OutboxPublisher {
    private final OutboxPort outbox;
    private final RabbitTemplate rabbit;
    OutboxPublisher(OutboxPort outbox, RabbitTemplate rabbit) { this.outbox=outbox; this.rabbit=rabbit; }

    @Scheduled(fixedDelay=2000)
    void publish() {
        for(var row:outbox.pendingEvents()) {
            try {
                rabbit.invoke(ops -> {
                    ops.convertAndSend("rpg.events",row.route(),row.envelope(),m -> {
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
