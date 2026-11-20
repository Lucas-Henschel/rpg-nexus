package br.furb.rpg.inventory.adapters.rabbitmq;

import br.furb.rpg.inventory.ports.CommercePort;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.util.Set;

/** Mantém somente os dados mínimos necessários para autorizar operações comerciais. */
@Component
class CampaignProjectionConsumer {
    private final CommercePort commerce;
    private final ObjectMapper json;
    private final RabbitTemplate rabbit;
    private final int maxRetries;
    CampaignProjectionConsumer(CommercePort commerce,ObjectMapper json,RabbitTemplate rabbit,
                               @Value("${inventory.max-retries}") int maxRetries) {
        this.commerce=commerce;this.json=json;this.rabbit=rabbit;this.maxRetries=maxRetries;
    }

    @RabbitListener(queues="inventory.campaign-members.v1")
    void consume(Message message,Channel channel) throws Exception {
        long tag=message.getMessageProperties().getDeliveryTag();
        try {
            var envelope=json.readTree(message.getBody());
            var payload=envelope.path("payload");
            String type=envelope.path("type").asText();
            if(!Set.of("rpg.campaign.created.v1","rpg.campaign.member.joined.v1",
                    "rpg.campaign.member.removed.v1","rpg.campaign.member.character-chosen.v1").contains(type))
                throw new IllegalArgumentException("unsupported campaign event");
            String userId=payload.path("userId").asText();
            String role=type.equals("rpg.campaign.created.v1")?"OWNER":payload.path("role").asText("PLAYER");
            if(userId.isBlank() && type.equals("rpg.campaign.created.v1")) userId=payload.path("ownerId").asText();
            commerce.projectCampaignEvent(envelope.path("messageId").asText(),type,
                payload.path("campaignId").asText(),userId,role,payload.path("characterId").asText(""));
            channel.basicAck(tag,false);
        } catch(Exception failure) {
            Integer previous=(Integer)message.getMessageProperties().getHeaders().getOrDefault("x-inventory-attempt",0);
            int attempt=previous+1;
            String route=attempt>=maxRetries?"campaign-failed":message.getMessageProperties().getReceivedRoutingKey();
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
