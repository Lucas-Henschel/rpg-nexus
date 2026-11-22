package br.furb.rpg.inventory.adapters.dynamodb;

import java.util.List;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;
import software.amazon.dynamodb.services.local.embedded.DynamoDBEmbedded;

/** DynamoDB em memória (DynamoDB Local) com as tabelas do S3, como o Terraform cria: chave "id" (String). */
final class InMemoryDynamo {
    static final String PREFIX="test_";
    static final List<String> TABLES=List.of("stocks","inventory","acquisition_sagas","inventory_inbox",
        "inventory_outbox","shops","shop_items","campaign_members","saga_history");
    private InMemoryDynamo() {}

    static DynamoDbClient start() {
        var client=DynamoDBEmbedded.create().dynamoDbClient();
        for(var table:TABLES) {
            client.createTable(r -> r.tableName(PREFIX+table).billingMode(BillingMode.PAY_PER_REQUEST)
                .keySchema(KeySchemaElement.builder().attributeName("id").keyType(KeyType.HASH).build())
                .attributeDefinitions(AttributeDefinition.builder().attributeName("id").attributeType(ScalarAttributeType.S).build()));
        }
        return client;
    }
}
