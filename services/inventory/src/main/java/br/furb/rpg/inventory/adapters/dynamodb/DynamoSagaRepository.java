package br.furb.rpg.inventory.adapters.dynamodb;

import br.furb.rpg.inventory.domain.Acquisition;
import br.furb.rpg.inventory.domain.SagaTransition;
import br.furb.rpg.inventory.domain.ValidationResult;
import br.furb.rpg.inventory.ports.SagaPort.StartResult;
import br.furb.rpg.inventory.tracing.TraceContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.dynamodb.model.*;

@Service
public class DynamoSagaRepository implements br.furb.rpg.inventory.ports.SagaPort {
    private final DynamoStore store;
    private final ObjectMapper json;
    private final long timeout;
    public DynamoSagaRepository(DynamoStore store, ObjectMapper json, @Value("${inventory.saga-timeout-seconds}") long timeout) {
        this.store=store; this.json=json; this.timeout=timeout;
    }

    String encode(Object object) { try { return json.writeValueAsString(object); } catch(Exception e) { throw new IllegalStateException(e); } }
    Map<String,Object> payload(Map<String,AttributeValue> row) {
        return Map.of("operationId",DynamoStore.str(row,"id"),"campaignId",DynamoStore.str(row,"campaignId"),
            "userId",DynamoStore.str(row,"userId"),"characterId",DynamoStore.str(row,"characterId"),
            "itemId",DynamoStore.str(row,"itemId"),"quantity",1,"amount",DynamoStore.num(row,"price"));
    }
    /** ItemAcquired and ShopItemPurchased also carry the item name (contract: at most 120 characters). */
    Map<String,Object> deliveredPayload(Map<String,AttributeValue> row) {
        var result=new HashMap<String,Object>(payload(row));
        var name=DynamoStore.optional(row,"itemName").strip();
        if(!name.isEmpty()) result.put("itemName",name.length()>120?name.substring(0,120):name);
        return result;
    }
    Map<String,Object> validationPayload(Map<String,AttributeValue> row) {
        var result=new HashMap<String,Object>(payload(row));
        result.put("deadlineAt",DynamoStore.str(row,"deadlineAt"));
        return result;
    }
    TransactWriteItem event(String operationId, String type, String route, Map<String,Object> payload) {
        var envelope=Map.of("messageId",UUID.randomUUID().toString(),"correlationId",operationId,
            "type",type,"version",1,"occurredAt",Instant.now().toString(),"payload",payload);
        var item=new HashMap<String,AttributeValue>();
        item.put("id",DynamoStore.s(UUID.randomUUID().toString()));
        item.put("status",DynamoStore.s("PENDING"));
        item.put("route",DynamoStore.s(route));
        item.put("envelope",DynamoStore.s(encode(envelope)));
        var traceparent=TraceContext.currentTraceparent();
        if(traceparent!=null) item.put("traceparent",DynamoStore.s(traceparent));
        return store.insert("inventory_outbox",item);
    }
    @Override public StartResult start(String id,String campaign,String user,String character,String item) {
        var existing=store.get("acquisition_sagas",id);
        if(!existing.isEmpty()) return matches(existing,campaign,user,character,item)?StartResult.IDEMPOTENT:StartResult.CONFLICT;
        var shopItem=store.findShopItem(campaign,item);
        var shop=store.findShop(campaign);
        if(shopItem==null || shop==null || !shop.active()) return StartResult.SHOP_ITEM_NOT_FOUND;
        var now=Instant.now();
        var row=new HashMap<String,AttributeValue>(Map.of("id",DynamoStore.s(id),"campaignId",DynamoStore.s(campaign),"userId",DynamoStore.s(user),
            "characterId",DynamoStore.s(character),"itemId",DynamoStore.s(item),"price",DynamoStore.n(shopItem.price()),
            "status",DynamoStore.s("VALIDATING_CHARACTER"),"version",DynamoStore.n(0),
            "deadlineAt",DynamoStore.s(now.plusSeconds(timeout).toString()),"createdAt",DynamoStore.s(now.toString())));
        row.put("itemName",DynamoStore.s(shopItem.name()));
        var stock=TransactWriteItem.builder().update(Update.builder().tableName(store.table("stocks"))
            .key(Map.of("id",DynamoStore.s(campaign+"#"+item)))
            .updateExpression("SET available = available - :one, reserved = if_not_exists(reserved, :zero) + :one")
            .conditionExpression("attribute_exists(id) AND available >= :one")
            .expressionAttributeValues(Map.of(":one",DynamoStore.n(1),":zero",DynamoStore.n(0))).build()).build();
        for(int attempt=0;attempt<12;attempt++) {
            try {
                store.transact(List.of(stock,store.insert("acquisition_sagas",row),
                    transition(row,"STARTED"),
                    event(id,"rpg.character.validation-requested.v1","character.validation.requested.v1",validationPayload(row))));
                return StartResult.STARTED;
            } catch(TransactionCanceledException e) {
                existing=store.get("acquisition_sagas",id);
                if(!existing.isEmpty()) return matches(existing,campaign,user,character,item)?StartResult.IDEMPOTENT:StartResult.CONFLICT;
                boolean outOfStock=e.cancellationReasons()!=null && !e.cancellationReasons().isEmpty()
                    && "ConditionalCheckFailed".equals(e.cancellationReasons().get(0).code());
                if(outOfStock) {
                    var rejected=new HashMap<>(row); rejected.put("status",DynamoStore.s("REJECTED"));
                    try { store.put("acquisition_sagas",rejected,"attribute_not_exists(id)"); }
                    catch(ConditionalCheckFailedException duplicate) {
                        existing=store.get("acquisition_sagas",id);
                        return !existing.isEmpty() && matches(existing,campaign,user,character,item)
                            ? StartResult.IDEMPOTENT : StartResult.CONFLICT;
                    }
                    return StartResult.OUT_OF_STOCK;
                }
                if(attempt==11) throw e;
                try { Thread.sleep(10L*(attempt+1)); }
                catch(InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IllegalStateException(interrupted); }
            }
        }
        throw new IllegalStateException("reservation retries exhausted");
    }
    boolean matches(Map<String,AttributeValue> r,String c,String u,String p,String i) {
        return DynamoStore.str(r,"campaignId").equals(c)&&DynamoStore.str(r,"userId").equals(u)
            &&DynamoStore.str(r,"characterId").equals(p)&&DynamoStore.str(r,"itemId").equals(i);
    }
    Acquisition map(Map<String,AttributeValue> row) {
        return new Acquisition(DynamoStore.str(row,"id"),DynamoStore.str(row,"campaignId"),DynamoStore.str(row,"userId"),
            DynamoStore.str(row,"characterId"),DynamoStore.str(row,"itemId"),DynamoStore.num(row,"price"),
            Acquisition.Status.valueOf(DynamoStore.str(row,"status")),DynamoStore.num(row,"version"),
            Instant.parse(DynamoStore.str(row,"deadlineAt")));
    }
    @Override public Acquisition find(String id) {
        var row=store.get("acquisition_sagas",id);
        return row.isEmpty()?null:map(row);
    }
    @Override public List<br.furb.rpg.inventory.ports.SagaPort.HistoryEntry> history(String id) {
        return store.scan("saga_history","operationId = :operation",Map.of(":operation",DynamoStore.s(id))).stream()
            .map(row -> new br.furb.rpg.inventory.ports.SagaPort.HistoryEntry(DynamoStore.str(row,"status"),
                Instant.parse(DynamoStore.str(row,"occurredAt"))))
            .sorted(Comparator.comparing(br.furb.rpg.inventory.ports.SagaPort.HistoryEntry::occurredAt)).toList();
    }
    @Override public void receive(ValidationResult result) {
        String messageId=result.messageId();
        String id=result.operationId();
        String type=result.type();
        if(result.version()!=1 || messageId.isBlank() || id.isBlank() || !Set.of(
            "rpg.character.validated.v1","rpg.character.rejected.v1",
            "rpg.external.validation-succeeded.v1","rpg.external.validation-failed.v1",
            "rpg.money.debited.v1","rpg.money.debit-rejected.v1","rpg.money.refunded.v1").contains(type))
            throw new IllegalArgumentException("invalid envelope");
        var row=store.get("acquisition_sagas",id);
        if(row.isEmpty()) throw new IllegalArgumentException("unknown operation");
        boolean moneyEvent=type.startsWith("rpg.money.");
        if(!id.equals(result.payloadOperationId()) ||
            !DynamoStore.str(row,"campaignId").equals(result.campaignId()) ||
            !DynamoStore.str(row,"characterId").equals(result.characterId()) ||
            !DynamoStore.str(row,"itemId").equals(result.itemId()) ||
            (moneyEvent && (!DynamoStore.str(row,"userId").equals(result.userId()) ||
                DynamoStore.num(row,"price")!=result.amount())))
            throw new IllegalArgumentException("result does not match acquisition");
        var inbox=store.insert("inventory_inbox",Map.of("id",DynamoStore.s(messageId),"operationId",DynamoStore.s(id),
            "type",DynamoStore.s(type),"receivedAt",DynamoStore.s(Instant.now().toString())));
        var writes=new ArrayList<TransactWriteItem>(); writes.add(inbox);
        var decision=SagaTransition.decide(map(row),type,Instant.now());
        switch(decision.effect()) {
            case RELEASE_STOCK -> compensate(row,decision.next().name(),false,
                type.equals("rpg.character.rejected.v1") ? "CHARACTER_REJECTED" :
                type.equals("rpg.external.validation-failed.v1") ?
                    ("DEADLINE_EXPIRED".equals(result.reason()) ? "DEADLINE_EXPIRED" : "EXTERNAL_VALIDATION_FAILED") :
                type.equals("rpg.money.debit-rejected.v1") ? "PAYMENT_REJECTED" : "DEADLINE_EXPIRED", writes);
            case RELEASE_STOCK_AND_REFUND -> compensate(row,decision.next().name(),true,"DEADLINE_EXPIRED",writes);
            case REQUEST_EXTERNAL -> {
                writes.add(store.updateSaga(row,decision.next().name(),Instant.parse(DynamoStore.str(row,"deadlineAt"))));
                writes.add(transition(row,"VALIDATING_EXTERNAL"));
                writes.add(event(id,"rpg.external.validation-requested.v1","external.validation.requested.v1",validationPayload(row)));
            }
            case REQUEST_MONEY -> {
                writes.add(store.updateSaga(row,decision.next().name(),Instant.parse(DynamoStore.str(row,"deadlineAt"))));
                writes.add(transition(row,"WAITING_MONEY"));
                writes.add(event(id,"rpg.money.debit-requested.v1","money.debit.requested.v1",validationPayload(row)));
            }
            case DELIVER_ITEM -> {
                writes.add(store.insert("inventory",Map.of("id",DynamoStore.s(id),"characterId",row.get("characterId"),
                    "campaignId",row.get("campaignId"),"itemId",row.get("itemId"),"quantity",DynamoStore.n(1),
                    "itemName",row.get("itemName"),"price",row.get("price"))));
                writes.add(store.updateSaga(row,decision.next().name(),Instant.parse(DynamoStore.str(row,"deadlineAt"))));
                writes.add(confirmReservation(row));
                writes.add(transition(row,"COMPLETED"));
                writes.add(event(id,"rpg.item.acquired.v1","item.acquired.v1",deliveredPayload(row)));
                writes.add(event(id,"rpg.shop.item-purchased.v1","shop.item.purchased.v1",deliveredPayload(row)));
            }
            case REFUND_MONEY -> writes.add(event(id,"rpg.money.refund-requested.v1","money.refund.requested.v1",payload(row)));
            case NONE -> { }
        }
        // A late or out-of-order result is recorded in the inbox but cannot change a terminal state.
        try { store.transact(writes); }
        catch(TransactionCanceledException e) {
            if(!store.get("inventory_inbox",messageId).isEmpty()) return;
            throw e; // another replica changed the version: broker retry re-evaluates the state
        }
    }
    void compensate(Map<String,AttributeValue> row,String terminal,boolean refund,String reason,List<TransactWriteItem> writes) {
        writes.add(TransactWriteItem.builder().update(Update.builder().tableName(store.table("stocks"))
            .key(Map.of("id",DynamoStore.s(DynamoStore.str(row,"campaignId")+"#"+DynamoStore.str(row,"itemId"))))
            .updateExpression("SET available = available + :one, reserved = reserved - :one")
            .expressionAttributeValues(Map.of(":one",DynamoStore.n(1))).build()).build());
        writes.add(store.updateSaga(row,terminal,Instant.parse(DynamoStore.str(row,"deadlineAt"))));
        writes.add(transition(row,terminal));
        var cancelledPayload=new HashMap<String,Object>(payload(row));
        cancelledPayload.put("reason",reason);
        writes.add(event(DynamoStore.str(row,"id"),"rpg.acquisition.cancelled.v1","acquisition.cancelled.v1",cancelledPayload));
        if(refund) writes.add(event(DynamoStore.str(row,"id"),"rpg.money.refund-requested.v1","money.refund.requested.v1",payload(row)));
    }
    TransactWriteItem confirmReservation(Map<String,AttributeValue> row) {
        return TransactWriteItem.builder().update(Update.builder().tableName(store.table("stocks"))
            .key(Map.of("id",DynamoStore.s(DynamoStore.str(row,"campaignId")+"#"+DynamoStore.str(row,"itemId"))))
            .updateExpression("SET reserved = reserved - :one").conditionExpression("reserved >= :one")
            .expressionAttributeValues(Map.of(":one",DynamoStore.n(1))).build()).build();
    }
    TransactWriteItem transition(Map<String,AttributeValue> row,String status) {
        return store.insert("saga_history",Map.of("id",DynamoStore.s(UUID.randomUUID().toString()),
            "operationId",row.get("id"),"status",DynamoStore.s(status),"occurredAt",DynamoStore.s(Instant.now().toString())));
    }
    void expire(Map<String,AttributeValue> row) {
        var writes=new ArrayList<TransactWriteItem>(); compensate(row,"EXPIRED",false,"DEADLINE_EXPIRED",writes);
        try { store.transact(writes); }
        catch(TransactionCanceledException e) { /* a concurrent result won the version check; next scan sees its state */ }
    }
    @Override public void expireDue() {
        for(String status:List.of("VALIDATING_CHARACTER","VALIDATING_EXTERNAL","WAITING_MONEY")) {
            for(var row:store.scan("acquisition_sagas","#st = :waiting",
                Map.of(":waiting",DynamoStore.s(status)))) {
                if(!Instant.parse(DynamoStore.str(row,"deadlineAt")).isAfter(Instant.now())) expire(row);
            }
        }
    }
}
