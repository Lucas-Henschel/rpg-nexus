package br.furb.rpg.inventory.adapters.dynamodb;

import br.furb.rpg.inventory.ports.CatalogPort;
import br.furb.rpg.inventory.ports.OutboxPort;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

@Component
public class DynamoStore implements CatalogPort, OutboxPort {
    private final DynamoDbClient db;
    final String prefix;
    public DynamoStore(DynamoDbClient db, @Value("${inventory.table-prefix}") String prefix) { this.db=db; this.prefix=prefix; }
    public String table(String name) { return prefix+name; }
    public static AttributeValue s(String value) { return AttributeValue.builder().s(value).build(); }
    public static AttributeValue n(long value) { return AttributeValue.builder().n(Long.toString(value)).build(); }
    public static String str(Map<String,AttributeValue> row, String key) { return row.get(key).s(); }
    public static long num(Map<String,AttributeValue> row, String key) { return Long.parseLong(row.get(key).n()); }
    public Map<String,AttributeValue> get(String table, String key) {
        return db.getItem(r -> r.tableName(table(table)).key(Map.of("id",s(key))).consistentRead(true)).item();
    }
    public void put(String table, Map<String,AttributeValue> row, String condition) {
        db.putItem(r -> r.tableName(table(table)).item(row).conditionExpression(condition));
    }
    public void transact(List<TransactWriteItem> writes) {
        db.transactWriteItems(r -> r.transactItems(writes));
    }
    public TransactWriteItem insert(String table, Map<String,AttributeValue> row) {
        return TransactWriteItem.builder().put(Put.builder().tableName(table(table)).item(row)
            .conditionExpression("attribute_not_exists(id)").build()).build();
    }
    public TransactWriteItem updateSaga(Map<String,AttributeValue> saga, String status, Instant deadline) {
        var values = new HashMap<String,AttributeValue>();
        values.put(":old", n(num(saga,"version")));
        values.put(":new", n(num(saga,"version")+1));
        values.put(":status", s(status));
        values.put(":deadline", s(deadline.toString()));
        return TransactWriteItem.builder().update(Update.builder().tableName(table("acquisition_sagas"))
            .key(Map.of("id",s(str(saga,"id"))))
            .updateExpression("SET #st=:status, version=:new, deadlineAt=:deadline")
            .conditionExpression("version=:old")
            .expressionAttributeNames(Map.of("#st","status"))
            .expressionAttributeValues(values).build()).build();
    }
    public List<Map<String,AttributeValue>> scan(String table, String filter, Map<String,AttributeValue> values) {
        var rows = new ArrayList<Map<String,AttributeValue>>();
        Map<String,AttributeValue> last = null;
        do {
            final var start = last;
            var result = db.scan(r -> { r.tableName(table(table));
                if(filter!=null && !filter.isBlank()) r.filterExpression(filter);
                if(values!=null && !values.isEmpty()) r.expressionAttributeValues(values);
                if(filter!=null && filter.contains("#st")) r.expressionAttributeNames(Map.of("#st","status"));
                if (start!=null && !start.isEmpty()) r.exclusiveStartKey(start); });
            rows.addAll(result.items()); last=result.lastEvaluatedKey();
        } while (last!=null && !last.isEmpty());
        return rows;
    }
    public boolean conditionalFailure(Exception e) {
        return e instanceof ConditionalCheckFailedException || e instanceof TransactionCanceledException;
    }
    @Override public void saveItem(String itemId, String name) {
        db.putItem(r -> r.tableName(table("items")).item(Map.of("id",s(itemId),"name",s(name))));
    }
    @Override public List<Item> listItems() {
        return scan("items",null,Map.of()).stream()
            .map(row -> new Item(str(row,"id"),str(row,"name"))).toList();
    }
    @Override public List<Stock> listStocks(String campaignId) {
        return scan("stocks","campaignId = :campaign",Map.of(":campaign",s(campaignId))).stream()
            .map(row -> new Stock(campaignId,str(row,"itemId"),num(row,"available"))).toList();
    }
    @Override public CreateStock createStock(String campaignId, String itemId, int available) {
        if(get("items",itemId).isEmpty()) return CreateStock.ITEM_NOT_FOUND;
        var row=Map.of("id",s(campaignId+"#"+itemId),"campaignId",s(campaignId),
            "itemId",s(itemId),"available",n(available));
        try { put("stocks",row,"attribute_not_exists(id)"); return CreateStock.CREATED; }
        catch(ConditionalCheckFailedException e) { return CreateStock.ALREADY_EXISTS; }
    }
    @Override public Stock findStock(String campaignId, String itemId) {
        var row=get("stocks",campaignId+"#"+itemId);
        return row.isEmpty()?null:new Stock(campaignId,itemId,num(row,"available"));
    }
    @Override public List<InventoryEntry> findInventory(String characterId) {
        return scan("inventory","characterId = :c",Map.of(":c",s(characterId))).stream()
            .map(r -> new InventoryEntry(str(r,"id"),str(r,"campaignId"),str(r,"itemId"),num(r,"quantity"))).toList();
    }
    @Override public List<PendingEvent> pendingEvents() {
        return scan("inventory_outbox","#st = :pending",Map.of(":pending",s("PENDING"))).stream()
            .map(r -> new PendingEvent(str(r,"id"),str(r,"route"),str(r,"envelope"))).toList();
    }
    @Override public void markPublished(String id) {
        db.updateItem(r -> r.tableName(table("inventory_outbox"))
            .key(Map.of("id",s(id))).updateExpression("SET #st = :published")
            .conditionExpression("#st = :pending")
            .expressionAttributeNames(Map.of("#st","status"))
            .expressionAttributeValues(Map.of(":published",s("PUBLISHED"),":pending",s("PENDING"))));
    }
}
