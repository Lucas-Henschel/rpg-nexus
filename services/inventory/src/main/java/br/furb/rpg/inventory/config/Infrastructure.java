package br.furb.rpg.inventory.config;

import java.net.URI;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;

@Configuration
class Infrastructure {
    @Bean DynamoDbClient dynamo(@Value("${DYNAMODB_ENDPOINT:}") String endpoint,
                                 @Value("${AWS_REGION:us-east-1}") String region) {
        var builder = DynamoDbClient.builder().region(Region.of(region))
            .credentialsProvider(DefaultCredentialsProvider.create());
        if (!endpoint.isBlank()) builder.endpointOverride(URI.create(endpoint));
        return builder.build();
    }
    /** Os nomes das filas vêm do ambiente (RABBITMQ_QUEUE e RABBITMQ_MEMBERS_QUEUE); a .dlq segue o nome de cada uma. */
    @Bean Declarables inventoryTopology(@Value("${inventory.exchange}") String exchangeName,
                                        @Value("${inventory.queue}") String repliesQueue,
                                        @Value("${inventory.members-queue}") String membersQueue) {
        var exchange = new TopicExchange(exchangeName, true, false);
        var replies = QueueBuilder.durable(repliesQueue)
            .deadLetterExchange("").deadLetterRoutingKey(repliesQueue + ".dlq").build();
        var campaignMembers = QueueBuilder.durable(membersQueue)
            .deadLetterExchange("").deadLetterRoutingKey(membersQueue + ".dlq").build();
        var dead = QueueBuilder.durable(repliesQueue + ".dlq").build();
        var membersDead = QueueBuilder.durable(membersQueue + ".dlq").build();
        return new Declarables(exchange, replies, campaignMembers, dead, membersDead,
            BindingBuilder.bind(replies).to(exchange).with("external.validation.succeeded.v1"),
            BindingBuilder.bind(replies).to(exchange).with("external.validation.failed.v1"),
            BindingBuilder.bind(replies).to(exchange).with("money.debited.v1"),
            BindingBuilder.bind(replies).to(exchange).with("money.debit-rejected.v1"),
            BindingBuilder.bind(replies).to(exchange).with("money.refunded.v1"),
            BindingBuilder.bind(campaignMembers).to(exchange).with("campaign.created.v1"),
            BindingBuilder.bind(campaignMembers).to(exchange).with("campaign.member.joined.v1"),
            BindingBuilder.bind(campaignMembers).to(exchange).with("campaign.member.character-chosen.v1"),
            BindingBuilder.bind(campaignMembers).to(exchange).with("campaign.member.removed.v1"));
    }
    @Bean RabbitTemplate publisher(CachingConnectionFactory factory) {
        var template = new RabbitTemplate(factory);
        template.setMandatory(true);
        return template;
    }
}
