package br.furb.rpg.inventory.adapters.rabbitmq;

import br.furb.rpg.inventory.ports.CommercePort;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import java.time.Instant;
import java.util.Set;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Cópia local de quem participa de cada campanha, feita com os eventos do S1.
 * É ela que autoriza a loja e as compras: o S3 não chama o S1 por HTTP.
 */
@Component
class CampaignProjectionConsumer {
    static final String QUEUE="inventory.campaign-members.v1";
    static final String RETRY_QUEUE=QUEUE+".retry";
    private static final Set<String> TYPES=Set.of("rpg.campaign.created.v1","rpg.campaign.member.joined.v1",
        "rpg.campaign.member.removed.v1","rpg.campaign.member.character-chosen.v1");
    private final CommercePort commerce;
    private final ObjectMapper json;
    private final RabbitTemplate rabbit;
    private final int maxRetries;
    private final long retryBaseDelayMs;
    CampaignProjectionConsumer(CommercePort commerce,ObjectMapper json,RabbitTemplate rabbit,
                               @Value("${inventory.max-retries}") int maxRetries,
                               @Value("${inventory.retry-base-delay-ms}") long retryBaseDelayMs) {
        this.commerce=commerce;this.json=json;this.rabbit=rabbit;
        this.maxRetries=maxRetries;this.retryBaseDelayMs=retryBaseDelayMs;
    }

    @RabbitListener(queues=QUEUE)
    void consume(Message message,Channel channel) throws Exception {
        long tag=message.getMessageProperties().getDeliveryTag();
        try {
            var envelope=json.readTree(message.getBody());
            var payload=envelope.path("payload");
            String type=envelope.path("type").asText();
            String messageId=envelope.path("messageId").asText();
            String campaignId=payload.path("campaignId").asText();
            if(!TYPES.contains(type) || messageId.isBlank() || campaignId.isBlank())
                throw new IllegalArgumentException("unsupported campaign event");
            boolean created=type.equals("rpg.campaign.created.v1");
            String userId=created?payload.path("ownerId").asText():payload.path("userId").asText();
            if(userId.isBlank()) throw new IllegalArgumentException("campaign event without userId");
            String role=created?"OWNER":payload.path("role").asText("PLAYER");
            long occurredAt=Instant.parse(envelope.path("occurredAt").asText()).toEpochMilli();
            commerce.projectCampaignEvent(messageId,type,campaignId,userId,role,
                payload.path("characterId").asText(""),occurredAt);
            channel.basicAck(tag,false);
        } catch(Exception failure) {
            Integer previous=(Integer)message.getMessageProperties().getHeaders().getOrDefault("x-inventory-attempt",0);
            int attempt=previous+1;
            // Sem requeue: a fila manda a mensagem para a .dlq (dead-letter definido no Terraform).
            if(attempt>=maxRetries) { channel.basicNack(tag,false,false); return; }
            // A fila .retry segura a cópia pelo tempo de expiration e a devolve só para esta fila.
            String delay=String.valueOf(retryBaseDelayMs<<(attempt-1));
            try {
                Message copy=MessageBuilder.fromMessage(message).setHeader("x-inventory-attempt",attempt)
                    .setExpiration(delay).setDeliveryMode(MessageDeliveryMode.PERSISTENT).build();
                rabbit.invoke(ops -> { ops.send("",RETRY_QUEUE,copy);ops.waitForConfirmsOrDie(5000);return null; });
                channel.basicAck(tag,false);
            } catch(Exception publishFailure) { channel.basicNack(tag,false,true); }
        }
    }
}
