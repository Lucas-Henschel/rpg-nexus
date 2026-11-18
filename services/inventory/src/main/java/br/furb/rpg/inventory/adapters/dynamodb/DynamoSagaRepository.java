package br.furb.rpg.inventory.adapters.dynamodb;

import br.furb.rpg.inventory.domain.Acquisition;
import br.furb.rpg.inventory.domain.SagaTransition;
import br.furb.rpg.inventory.domain.ValidationResult;
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
            "characterId",DynamoStore.str(row,"characterId"),"itemId",DynamoStore.str(row,"itemId"),"quantity",1);
    }
    Map<String,Object> validationPayload(Map<String,AttributeValue> row) {
        var result=new HashMap<String,Object>(payload(row));
        result.put("deadlineAt",DynamoStore.str(row,"deadlineAt"));
        return result;
    }
    TransactWriteItem event(String operationId, String type, String route, Map<String,Object> payload) {
        var envelope=Map.of("messageId",UUID.randomUUID().toString(),"correlationId",operationId,
            "type",type,"version",1,"occurredAt",Instant.now().toString(),"payload",payload);
        return store.insert("inventory_outbox",Map.of("id",DynamoStore.s(UUID.randomUUID().toString()),
            "status",DynamoStore.s("PENDING"),"route",DynamoStore.s(route),"envelope",DynamoStore.s(encode(envelope))));
    }
    @Override public boolean start(String id,String campaign,String character,String item) {
        var existing=store.get("acquisition_sagas",id);
        if(!existing.isEmpty()) return !matches(existing,campaign,character,item);
        var now=Instant.now();
        var row=Map.of("id",DynamoStore.s(id),"campaignId",DynamoStore.s(campaign),"characterId",DynamoStore.s(character),
            "itemId",DynamoStore.s(item),"status",DynamoStore.s("VALIDATING_CHARACTER"),"version",DynamoStore.n(0),
            "deadlineAt",DynamoStore.s(now.plusSeconds(timeout).toString()));
        var stock=TransactWriteItem.builder().update(Update.builder().tableName(store.table("stocks"))
            .key(Map.of("id",DynamoStore.s(campaign+"#"+item)))
            .updateExpression("SET available = available - :one")
            .conditionExpression("attribute_exists(id) AND available >= :one")
            .expressionAttributeValues(Map.of(":one",DynamoStore.n(1))).build()).build();
        for(int attempt=0;attempt<12;attempt++) {
            try {
                store.transact(List.of(stock,store.insert("acquisition_sagas",row),
                    event(id,"rpg.character.validation-requested.v1","character.validation.requested.v1",validationPayload(row))));
                return false;
            } catch(TransactionCanceledException e) {
                existing=store.get("acquisition_sagas",id);
                if(!existing.isEmpty()) return !matches(existing,campaign,character,item);
                boolean outOfStock=e.cancellationReasons()!=null && !e.cancellationReasons().isEmpty()
                    && "ConditionalCheckFailed".equals(e.cancellationReasons().get(0).code());
                if(outOfStock) {
                    var rejected=new HashMap<>(row); rejected.put("status",DynamoStore.s("REJECTED"));
                    try { store.put("acquisition_sagas",rejected,"attribute_not_exists(id)"); }
                    catch(ConditionalCheckFailedException duplicate) {
                        existing=store.get("acquisition_sagas",id);
                        return (existing.isEmpty() || !matches(existing,campaign,character,item));
                    }
                    return false;
                }
                if(attempt==11) throw e;
                try { Thread.sleep(10L*(attempt+1)); }
                catch(InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IllegalStateException(interrupted); }
            }
        }
        throw new IllegalStateException("reservation retries exhausted");
    }
    boolean matches(Map<String,AttributeValue> r,String c,String p,String i) {
        return DynamoStore.str(r,"campaignId").equals(c)&&DynamoStore.str(r,"characterId").equals(p)&&DynamoStore.str(r,"itemId").equals(i);
    }
    Acquisition map(Map<String,AttributeValue> row) {
        return new Acquisition(DynamoStore.str(row,"id"),DynamoStore.str(row,"campaignId"),
            DynamoStore.str(row,"characterId"),DynamoStore.str(row,"itemId"),
            Acquisition.Status.valueOf(DynamoStore.str(row,"status")),DynamoStore.num(row,"version"),
            Instant.parse(DynamoStore.str(row,"deadlineAt")));
    }
    @Override public Acquisition find(String id) {
        var row=store.get("acquisition_sagas",id);
        return row.isEmpty()?null:map(row);
    }
    @Override public void receive(ValidationResult result) {
        String messageId=result.messageId();
        String id=result.operationId();
        String type=result.type();
        if(result.version()!=1 || messageId.isBlank() || id.isBlank() || !Set.of(
            "rpg.character.validated.v1","rpg.character.rejected.v1",
            "rpg.external.validation.succeeded.v1","rpg.external.validation.failed.v1").contains(type))
            throw new IllegalArgumentException("invalid envelope");
        var row=store.get("acquisition_sagas",id);
        if(row.isEmpty()) throw new IllegalArgumentException("unknown operation");
        if(!id.equals(result.payloadOperationId()) ||
            !DynamoStore.str(row,"campaignId").equals(result.campaignId()) ||
            !DynamoStore.str(row,"characterId").equals(result.characterId()) ||
            !DynamoStore.str(row,"itemId").equals(result.itemId()))
            throw new IllegalArgumentException("result does not match acquisition");
        var inbox=store.insert("inventory_inbox",Map.of("id",DynamoStore.s(messageId),"operationId",DynamoStore.s(id),
            "type",DynamoStore.s(type),"receivedAt",DynamoStore.s(Instant.now().toString())));
        var writes=new ArrayList<TransactWriteItem>(); writes.add(inbox);
        var decision=SagaTransition.decide(map(row),type,Instant.now());
        switch(decision.effect()) {
            case RELEASE_STOCK -> compensate(row,decision.next().name(),writes);
            case REQUEST_EXTERNAL -> {
                writes.add(store.updateSaga(row,decision.next().name(),Instant.parse(DynamoStore.str(row,"deadlineAt"))));
                writes.add(event(id,"rpg.external.validation-requested.v1","external.validation.requested.v1",payload(row)));
            }
            case DELIVER_ITEM -> {
                writes.add(store.insert("inventory",Map.of("id",DynamoStore.s(id),"characterId",row.get("characterId"),
                    "campaignId",row.get("campaignId"),"itemId",row.get("itemId"),"quantity",DynamoStore.n(1))));
                writes.add(store.updateSaga(row,decision.next().name(),Instant.parse(DynamoStore.str(row,"deadlineAt"))));
                writes.add(event(id,"rpg.item.acquired.v1","item.acquired.v1",payload(row)));
            }
            case NONE -> { }
        }
        // A late or out-of-order result is recorded in the inbox but cannot change a terminal state.
        try { store.transact(writes); }
        catch(TransactionCanceledException e) {
            if(!store.get("inventory_inbox",messageId).isEmpty()) return;
            throw e; // another replica changed the version: broker retry re-evaluates the state
        }
    }
    void compensate(Map<String,AttributeValue> row,String terminal,List<TransactWriteItem> writes) {
        writes.add(TransactWriteItem.builder().update(Update.builder().tableName(store.table("stocks"))
            .key(Map.of("id",DynamoStore.s(DynamoStore.str(row,"campaignId")+"#"+DynamoStore.str(row,"itemId"))))
            .updateExpression("SET available = available + :one")
            .expressionAttributeValues(Map.of(":one",DynamoStore.n(1))).build()).build());
        writes.add(store.updateSaga(row,terminal,Instant.parse(DynamoStore.str(row,"deadlineAt"))));
        writes.add(event(DynamoStore.str(row,"id"),"rpg.acquisition.cancelled.v1","acquisition.cancelled.v1",payload(row)));
    }
    void expire(Map<String,AttributeValue> row) {
        var writes=new ArrayList<TransactWriteItem>(); compensate(row,"EXPIRED",writes);
        try { store.transact(writes); }
        catch(TransactionCanceledException e) { /* a concurrent result won the version check; next scan sees its state */ }
    }
    @Override public void expireDue() {
        for(var row:store.scan("acquisition_sagas","#st = :character OR #st = :external",
            Map.of(":character",DynamoStore.s("VALIDATING_CHARACTER"),":external",DynamoStore.s("VALIDATING_EXTERNAL")))) {
            if(!Instant.parse(DynamoStore.str(row,"deadlineAt")).isAfter(Instant.now())) expire(row);
        }
    }
}
