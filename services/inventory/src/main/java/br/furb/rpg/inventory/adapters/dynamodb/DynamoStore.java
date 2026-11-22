package br.furb.rpg.inventory.adapters.dynamodb;

import br.furb.rpg.inventory.ports.CatalogPort;
import br.furb.rpg.inventory.ports.CommercePort;
import br.furb.rpg.inventory.ports.OutboxPort;
import br.furb.rpg.inventory.tracing.TraceContext;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

@Component
public class DynamoStore implements CatalogPort, CommercePort, OutboxPort {
    private final DynamoDbClient db;
    final String prefix;
    public DynamoStore(DynamoDbClient db, @Value("${inventory.table-prefix}") String prefix) { this.db=db; this.prefix=prefix; }
    public String table(String name) { return prefix+name; }
    public static AttributeValue s(String value) { return AttributeValue.builder().s(value).build(); }
    public static AttributeValue n(long value) { return AttributeValue.builder().n(Long.toString(value)).build(); }
    public static String str(Map<String,AttributeValue> row, String key) { return row.get(key).s(); }
    public static long num(Map<String,AttributeValue> row, String key) { return Long.parseLong(row.get(key).n()); }
    public static String optional(Map<String,AttributeValue> row, String key) {
        var value=row.get(key); return value==null || value.s()==null ? "" : value.s();
    }
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
        // Varredura sem trace pai (ExpirationWorker e outbox, a cada 2 s) não vira trace no Jaeger.
        return TraceContext.untracedIfRoot(() -> scanAll(table,filter,values));
    }
    private List<Map<String,AttributeValue>> scanAll(String table, String filter, Map<String,AttributeValue> values) {
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
    @Override public List<InventoryEntry> findInventory(String characterId) {
        return scan("inventory","characterId = :c",Map.of(":c",s(characterId))).stream()
            .map(r -> new InventoryEntry(str(r,"id"),str(r,"campaignId"),str(r,"itemId"),num(r,"quantity"))).toList();
    }
    @Override public Shop findShop(String campaignId) {
        var row=get("shops",campaignId);
        return row.isEmpty()?null:new Shop(campaignId,str(row,"name"),row.get("active").bool());
    }
    @Override public Shop saveShop(String campaignId,String name,boolean active) {
        var row=Map.of("id",s(campaignId),"campaignId",s(campaignId),"name",s(name),
            "active",AttributeValue.builder().bool(active).build(),"updatedAt",s(Instant.now().toString()));
        db.putItem(r -> r.tableName(table("shops")).item(row));
        return new Shop(campaignId,name,active);
    }
    @Override public List<ShopItem> listShopItems(String campaignId) {
        return scan("shop_items","campaignId = :campaign",Map.of(":campaign",s(campaignId))).stream()
            .map(this::shopItem).toList();
    }
    private ShopItem shopItem(Map<String,AttributeValue> row) {
        var stock=get("stocks",str(row,"campaignId")+"#"+str(row,"itemId"));
        long available=stock.isEmpty()?0:num(stock,"available");
        long reserved=stock.isEmpty()||!stock.containsKey("reserved")?0:num(stock,"reserved");
        return new ShopItem(str(row,"campaignId"),str(row,"itemId"),str(row,"name"),
            optional(row,"description"),num(row,"price"),available,reserved);
    }
    @Override public ShopItem findShopItem(String campaignId,String itemId) {
        var row=get("shop_items",campaignId+"#"+itemId);
        return row.isEmpty()?null:shopItem(row);
    }
    @Override public ShopItem createShopItem(String campaignId,String name,String description,long price,long available) {
        for(int attempt=0;attempt<3;attempt++) {
            var itemId=UUID.randomUUID().toString();
            var item=Map.of("id",s(campaignId+"#"+itemId),"campaignId",s(campaignId),"itemId",s(itemId),
                "name",s(name),"description",s(description),"price",n(price));
            var stock=Map.of("id",s(campaignId+"#"+itemId),"campaignId",s(campaignId),"itemId",s(itemId),
                "available",n(available),"reserved",n(0));
            try {
                transact(List.of(insert("shop_items",item),insert("stocks",stock)));
                return new ShopItem(campaignId,itemId,name,description,price,available,0);
            } catch(TransactionCanceledException collision) {
                if(get("shop_items",campaignId+"#"+itemId).isEmpty() && get("stocks",campaignId+"#"+itemId).isEmpty()) throw collision;
            }
        }
        throw new IllegalStateException("unable to generate a unique item identifier");
    }
    @Override public ShopItem saveShopItem(String campaignId,String itemId,String name,String description,long price,long available) {
        var item=Map.of("id",s(campaignId+"#"+itemId),"campaignId",s(campaignId),"itemId",s(itemId),
            "name",s(name),"description",s(description),"price",n(price));
        var stock=Map.of("id",s(campaignId+"#"+itemId),"campaignId",s(campaignId),"itemId",s(itemId),
            "available",n(available),"reserved",n(0));
        db.transactWriteItems(r -> r.transactItems(
            TransactWriteItem.builder().put(Put.builder().tableName(table("shop_items")).item(item)
                .conditionExpression("attribute_exists(id)").build()).build(),
            TransactWriteItem.builder().put(Put.builder().tableName(table("stocks")).item(stock)
                .conditionExpression("attribute_exists(id) AND (attribute_not_exists(reserved) OR reserved = :zero)")
                .expressionAttributeValues(Map.of(":zero",n(0))).build()).build()));
        return new ShopItem(campaignId,itemId,name,description,price,available,0);
    }
    @Override public boolean removeShopItem(String campaignId,String itemId) {
        var key=Map.of("id",s(campaignId+"#"+itemId));
        if(get("shop_items",campaignId+"#"+itemId).isEmpty()) return false;
        db.transactWriteItems(r -> r.transactItems(
            TransactWriteItem.builder().delete(Delete.builder().tableName(table("shop_items")).key(key).build()).build(),
            TransactWriteItem.builder().delete(Delete.builder().tableName(table("stocks")).key(key)
                .conditionExpression("attribute_not_exists(reserved) OR reserved = :zero")
                .expressionAttributeValues(Map.of(":zero",n(0))).build()).build()));
        return true;
    }
    @Override public Membership findMembership(String campaignId,String userId) {
        var row=get("campaign_members",campaignId+"#"+userId);
        if(row.isEmpty()) return null;
        // Linhas antigas (antes do campo active) contam como participante ativo.
        var active=row.get("active");
        if(active!=null && Boolean.FALSE.equals(active.bool())) return null;
        // character-chosen chegou antes do joined: ainda não é participante.
        if(active==null && row.get("membershipAt")==null && row.get("characterAt")!=null) return null;
        return new Membership(campaignId,userId,optional(row,"role"),optional(row,"characterId"));
    }
    /**
     * Cópia local dos participantes, feita só com os eventos do S1.
     * Cada parte tem o seu instante: entrada/saída (membershipAt) e personagem (characterAt).
     * Um evento mais antigo que o gravado é ignorado, então a ordem de chegada não importa.
     */
    @Override public void projectCampaignEvent(String messageId,String type,String campaignId,String userId,
                                                String role,String characterId,long occurredAtMillis) {
        var inbox=insert("inventory_inbox",Map.of("id",s(messageId),"type",s(type),
            "receivedAt",s(Instant.now().toString())));
        var key=Map.of("id",s(campaignId+"#"+userId));
        var values=new HashMap<String,AttributeValue>();
        values.put(":campaign",s(campaignId)); values.put(":user",s(userId)); values.put(":at",n(occurredAtMillis));
        var names=new HashMap<String,String>();
        String update; String condition;
        switch(type) {
            case "rpg.campaign.created.v1","rpg.campaign.member.joined.v1" -> {
                values.put(":role",s(role)); values.put(":on",AttributeValue.builder().bool(true).build());
                names.put("#role","role");
                update="SET campaignId=:campaign, userId=:user, #role=:role, active=:on, membershipAt=:at";
                condition="attribute_not_exists(membershipAt) OR membershipAt <= :at";
            }
            case "rpg.campaign.member.removed.v1" -> {
                values.put(":off",AttributeValue.builder().bool(false).build()); values.put(":none",s(""));
                update="SET campaignId=:campaign, userId=:user, active=:off, membershipAt=:at, characterId=:none, characterAt=:at";
                condition="attribute_not_exists(membershipAt) OR membershipAt <= :at";
            }
            case "rpg.campaign.member.character-chosen.v1" -> {
                values.put(":character",s(characterId==null?"":characterId));
                update="SET campaignId=:campaign, userId=:user, characterId=:character, characterAt=:at";
                condition="(attribute_not_exists(characterAt) OR characterAt <= :at)"
                    +" AND (attribute_not_exists(membershipAt) OR membershipAt <= :at OR active = :on)";
                values.put(":on",AttributeValue.builder().bool(true).build());
            }
            default -> throw new IllegalArgumentException("unsupported campaign event "+type);
        }
        var builder=Update.builder().tableName(table("campaign_members")).key(key)
            .updateExpression(update).conditionExpression(condition).expressionAttributeValues(values);
        if(!names.isEmpty()) builder.expressionAttributeNames(names);
        var projection=TransactWriteItem.builder().update(builder.build()).build();
        try { transact(List.of(inbox,projection)); }
        catch(TransactionCanceledException e) {
            if(!get("inventory_inbox",messageId).isEmpty()) return; // reentrega: já aplicado
            var reasons=e.cancellationReasons();
            boolean stale=reasons!=null && reasons.size()>1 && "ConditionalCheckFailed".equals(reasons.get(1).code());
            if(!stale) throw e;
            // Evento mais antigo que o gravado: registra na inbox e não muda a cópia.
            try { transact(List.of(inbox)); }
            catch(TransactionCanceledException duplicate) { if(get("inventory_inbox",messageId).isEmpty()) throw duplicate; }
        }
    }
    @Override public List<PendingEvent> pendingEvents() {
        return scan("inventory_outbox","#st = :pending",Map.of(":pending",s("PENDING"))).stream()
            .map(r -> new PendingEvent(str(r,"id"),str(r,"route"),str(r,"envelope"),optional(r,"traceparent"))).toList();
    }
    @Override public void markPublished(String id) {
        db.updateItem(r -> r.tableName(table("inventory_outbox"))
            .key(Map.of("id",s(id))).updateExpression("SET #st = :published")
            .conditionExpression("#st = :pending")
            .expressionAttributeNames(Map.of("#st","status"))
            .expressionAttributeValues(Map.of(":published",s("PUBLISHED"),":pending",s("PENDING"))));
    }
}
