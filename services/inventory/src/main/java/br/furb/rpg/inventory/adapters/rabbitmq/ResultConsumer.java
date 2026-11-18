package br.furb.rpg.inventory.adapters.rabbitmq;

import br.furb.rpg.inventory.ports.SagaPort;
import br.furb.rpg.inventory.domain.ValidationResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class ResultConsumer {
    private final SagaPort saga;
    private final ObjectMapper json;
    private final RabbitTemplate rabbit;
    private final int maxRetries;
    private final String retryQueue;
    private final long retryBaseDelayMs;
    ResultConsumer(SagaPort saga,ObjectMapper json,RabbitTemplate rabbit,@Value("${inventory.max-retries}") int maxRetries,
                   @Value("${inventory.retry-queue}") String retryQueue,@Value("${inventory.retry-base-delay-ms}") long retryBaseDelayMs) {
        this.saga=saga;this.json=json;this.rabbit=rabbit;this.maxRetries=maxRetries;
        this.retryQueue=retryQueue;this.retryBaseDelayMs=retryBaseDelayMs;
    }
    @RabbitListener(queues="${inventory.queue}")
    void consume(Message message,Channel channel) throws Exception {
        long tag=message.getMessageProperties().getDeliveryTag();
        try {
            var envelope=json.readTree(message.getBody());
            var payload=envelope.path("payload");
            saga.receive(new ValidationResult(envelope.path("messageId").asText(),
                envelope.path("correlationId").asText(),payload.path("operationId").asText(),envelope.path("type").asText(),
                envelope.path("version").asInt(),payload.path("campaignId").asText(),
                payload.path("characterId").asText(),payload.path("itemId").asText()));
            channel.basicAck(tag,false);
        } catch(Exception failure) {
            Integer previous=(Integer)message.getMessageProperties().getHeaders().getOrDefault("x-inventory-attempt",0);
            int attempt=previous+1;
            // Sem requeue: a fila manda a mensagem para a .dlq (dead-letter definido no Terraform).
            if(attempt>=maxRetries) { channel.basicNack(tag,false,false); return; }
            // A fila .retry segura a cópia pelo tempo de expiration e a devolve para a fila principal.
            String delay=String.valueOf(retryBaseDelayMs<<(attempt-1));
            try {
                Message copy=MessageBuilder.fromMessage(message).setHeader("x-inventory-attempt",attempt)
                    .setExpiration(delay).setDeliveryMode(MessageDeliveryMode.PERSISTENT).build();
                rabbit.invoke(ops -> { ops.send("",retryQueue,copy);ops.waitForConfirmsOrDie(5000);return null; });
                channel.basicAck(tag,false);
            } catch(Exception publishFailure) { channel.basicNack(tag,false,true); }
        }
    }
}
