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
    @Bean Declarables inventoryTopology(@Value("${inventory.exchange}") String exchangeName) {
        var exchange = new TopicExchange(exchangeName, true, false);
        var replies = QueueBuilder.durable("inventory.saga-replies.v1")
            .deadLetterExchange("").deadLetterRoutingKey("inventory.saga-replies.v1.dlq").build();
        var campaignMembers = QueueBuilder.durable("inventory.campaign-members.v1")
            .deadLetterExchange("").deadLetterRoutingKey("inventory.campaign-members.v1.dlq").build();
        var dead = QueueBuilder.durable("inventory.saga-replies.v1.dlq").build();
        var membersDead = QueueBuilder.durable("inventory.campaign-members.v1.dlq").build();
        return new Declarables(exchange, replies, campaignMembers, dead, membersDead,
            BindingBuilder.bind(replies).to(exchange).with("money.debited.v1"),
            BindingBuilder.bind(replies).to(exchange).with("money.debit-rejected.v1"),
            BindingBuilder.bind(replies).to(exchange).with("money.refunded.v1"),
            BindingBuilder.bind(campaignMembers).to(exchange).with("campaign.created.v1"),
            BindingBuilder.bind(campaignMembers).to(exchange).with("campaign.member.joined.v1"),
            BindingBuilder.bind(campaignMembers).to(exchange).with("campaign.member.removed.v1"));
    }
    @Bean RabbitTemplate publisher(CachingConnectionFactory factory) {
        var template = new RabbitTemplate(factory);
        template.setMandatory(true);
        return template;
    }
}
