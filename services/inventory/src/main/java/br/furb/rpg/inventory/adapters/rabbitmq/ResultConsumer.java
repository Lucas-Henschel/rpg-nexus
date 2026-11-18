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
    ResultConsumer(SagaPort saga,ObjectMapper json,RabbitTemplate rabbit,@Value("${inventory.max-retries}") int maxRetries) {
        this.saga=saga;this.json=json;this.rabbit=rabbit;this.maxRetries=maxRetries;
    }
    @RabbitListener(queues="rpg.inventory.results.v1")
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
            String route=attempt>=maxRetries?"failed":message.getMessageProperties().getReceivedRoutingKey();
            String exchange=attempt>=maxRetries?"rpg.inventory.dlx":"rpg.events";
            try {
                Message copy=MessageBuilder.fromMessage(message).setHeader("x-inventory-attempt",attempt)
                    .setDeliveryMode(MessageDeliveryMode.PERSISTENT).build();
                rabbit.invoke(ops -> { ops.send(exchange,route,copy);ops.waitForConfirmsOrDie(5000);return null; });
                channel.basicAck(tag,false);
            } catch(Exception publishFailure) { channel.basicNack(tag,false,true); }
        }
    }
}
