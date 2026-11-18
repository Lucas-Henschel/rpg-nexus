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
    @Bean Declarables inventoryTopology() {
        var exchange = new TopicExchange("rpg.events", true, false);
        var dlx = new DirectExchange("rpg.inventory.dlx", true, false);
        var queue = QueueBuilder.durable("rpg.inventory.results.v1").build();
        var dead = QueueBuilder.durable("rpg.inventory.results.dlq.v1").build();
        return new Declarables(exchange, dlx, queue, dead,
            BindingBuilder.bind(queue).to(exchange).with("character.validated.v1"),
            BindingBuilder.bind(queue).to(exchange).with("character.rejected.v1"),
            BindingBuilder.bind(queue).to(exchange).with("external.validation.succeeded.v1"),
            BindingBuilder.bind(queue).to(exchange).with("external.validation.failed.v1"),
            BindingBuilder.bind(dead).to(dlx).with("failed"));
    }
    @Bean RabbitTemplate publisher(CachingConnectionFactory factory) {
        var template = new RabbitTemplate(factory);
        template.setMandatory(true);
        return template;
    }
}
