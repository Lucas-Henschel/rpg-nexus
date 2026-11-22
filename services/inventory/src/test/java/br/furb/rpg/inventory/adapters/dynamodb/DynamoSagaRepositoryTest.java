package br.furb.rpg.inventory.adapters.dynamodb;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import br.furb.rpg.inventory.domain.Acquisition.Status;
import br.furb.rpg.inventory.domain.ValidationResult;
import br.furb.rpg.inventory.ports.SagaPort.StartResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;

/**
 * Saga de compra contra um DynamoDB real (em memória): estados, estoque, inbox e eventos da outbox.
 * Ordem: reserva estoque -> mochila (S2) -> validação externa (identity-validator) -> débito (S2) -> entrega.
 */
class DynamoSagaRepositoryTest {
    static final String CAMPAIGN="camp-1", USER="user-1", CHARACTER="char-1";
    static final long PRICE=10, STOCK=5;
    private final ObjectMapper json=new ObjectMapper();
    private DynamoDbClient client;
    private DynamoStore store;
    private DynamoSagaRepository saga;
    private String itemId;

    @BeforeEach void setUp() {
        client=InMemoryDynamo.start();
        store=new DynamoStore(client,InMemoryDynamo.PREFIX);
        saga=new DynamoSagaRepository(store,json,60);
        store.saveShop(CAMPAIGN,"Loja",true);
        itemId=store.createShopItem(CAMPAIGN,"Poção","",PRICE,STOCK).itemId();
    }
    @AfterEach void tearDown() { client.close(); }

    // ---------- apoio ----------

    /** Eventos ainda não publicados (e os marca como publicados, para o próximo passo ver só os novos). */
    List<JsonNode> drainOutbox() {
        var events=new ArrayList<JsonNode>();
        for(var pending:store.pendingEvents()) {
            try { events.add(json.readTree(pending.envelope())); } catch(Exception e) { throw new IllegalStateException(e); }
            store.markPublished(pending.id());
        }
        return events;
    }
    List<String> types(List<JsonNode> events) { return events.stream().map(e -> e.path("type").asText()).toList(); }
    JsonNode only(List<JsonNode> events,String type) {
        return events.stream().filter(e -> e.path("type").asText().equals(type)).findFirst().orElseThrow();
    }
    String start() {
        var id=UUID.randomUUID().toString();
        assertThat(saga.start(id,CAMPAIGN,USER,CHARACTER,itemId)).isEqualTo(StartResult.STARTED);
        return id;
    }
    void reply(String operationId,String type) { reply(operationId,type,UUID.randomUUID().toString(),""); }
    void reply(String operationId,String type,String messageId,String reason) {
        saga.receive(new ValidationResult(messageId,operationId,operationId,type,1,CAMPAIGN,USER,CHARACTER,itemId,PRICE,reason));
    }
    long available() { return store.findShopItem(CAMPAIGN,itemId).available(); }
    long reserved() { return store.findShopItem(CAMPAIGN,itemId).reserved(); }
    Status status(String operationId) { return saga.find(operationId).status(); }
    List<String> steps(String operationId) { return saga.history(operationId).stream().map(h -> h.status()).toList(); }

    // ---------- início ----------

    @Test @DisplayName("início: reserva 1 unidade e pede ao S2 a validação do personagem (mochila)")
    void startReservesStockAndAsksCharacterValidation() {
        var op=start();
        assertThat(status(op)).isEqualTo(Status.VALIDATING_CHARACTER);
        assertThat(available()).isEqualTo(STOCK-1);
        assertThat(reserved()).isEqualTo(1);
        var events=drainOutbox();
        assertThat(types(events)).containsExactly("rpg.character.validation-requested.v1");
        var payload=events.get(0).path("payload");
        assertThat(payload.path("operationId").asText()).isEqualTo(op);
        assertThat(payload.path("characterId").asText()).isEqualTo(CHARACTER);
        assertThat(payload.path("quantity").asInt()).isEqualTo(1);
        assertThat(payload.path("deadlineAt").asText()).isNotBlank();
    }

    @Test @DisplayName("início: mesma chave e mesmos dados é idempotente; dados diferentes é conflito")
    void startIsIdempotent() {
        var op=start();
        assertThat(saga.start(op,CAMPAIGN,USER,CHARACTER,itemId)).isEqualTo(StartResult.IDEMPOTENT);
        assertThat(saga.start(op,CAMPAIGN,USER,"outro-personagem",itemId)).isEqualTo(StartResult.CONFLICT);
        assertThat(available()).isEqualTo(STOCK-1);
        assertThat(drainOutbox()).hasSize(1);
    }

    @Test @DisplayName("início: sem estoque responde OUT_OF_STOCK e não pede nada ao S2")
    void startWithoutStock() {
        var soldOut=store.createShopItem(CAMPAIGN,"Rara","",PRICE,0).itemId();
        assertThat(saga.start(UUID.randomUUID().toString(),CAMPAIGN,USER,CHARACTER,soldOut)).isEqualTo(StartResult.OUT_OF_STOCK);
        assertThat(drainOutbox()).isEmpty();
    }

    // ---------- caminho feliz ----------

    @Test @DisplayName("compra completa: mochila -> validação externa -> débito -> item entregue")
    void happyPath() {
        var op=start(); drainOutbox();

        reply(op,"rpg.character.validated.v1");
        assertThat(status(op)).isEqualTo(Status.VALIDATING_EXTERNAL);
        assertThat(types(drainOutbox())).containsExactly("rpg.external.validation-requested.v1");

        reply(op,"rpg.external.validation-succeeded.v1");
        assertThat(status(op)).isEqualTo(Status.WAITING_MONEY);
        var debit=only(drainOutbox(),"rpg.money.debit-requested.v1").path("payload");
        assertThat(debit.path("amount").asLong()).isEqualTo(PRICE);
        assertThat(debit.path("userId").asText()).isEqualTo(USER);

        reply(op,"rpg.money.debited.v1");
        assertThat(status(op)).isEqualTo(Status.COMPLETED);
        assertThat(types(drainOutbox())).containsExactlyInAnyOrder("rpg.item.acquired.v1","rpg.shop.item-purchased.v1");
        assertThat(available()).isEqualTo(STOCK-1);
        assertThat(reserved()).isZero();
        assertThat(store.findInventory(CHARACTER)).singleElement()
            .satisfies(entry -> assertThat(entry.itemId()).isEqualTo(itemId));
        assertThat(steps(op)).containsExactly("STARTED","VALIDATING_EXTERNAL","WAITING_MONEY","COMPLETED");
    }

    // ---------- mochila (S2) ----------

    @Test @DisplayName("mochila cheia: CharacterRejected devolve o estoque, termina REJECTED e avisa com CHARACTER_REJECTED")
    void characterRejected() {
        var op=start(); drainOutbox();
        reply(op,"rpg.character.rejected.v1",UUID.randomUUID().toString(),"CAPACITY_EXCEEDED");
        assertThat(status(op)).isEqualTo(Status.REJECTED);
        assertThat(available()).isEqualTo(STOCK);
        assertThat(reserved()).isZero();
        var events=drainOutbox();
        assertThat(types(events)).containsExactly("rpg.acquisition.cancelled.v1");
        assertThat(events.get(0).path("payload").path("reason").asText()).isEqualTo("CHARACTER_REJECTED");
        assertThat(store.findInventory(CHARACTER)).isEmpty();
    }

    @Test @DisplayName("validação externa e dinheiro não andam antes de o S2 aprovar o personagem")
    void nothingBeforeCharacterApproval() {
        var op=start(); drainOutbox();
        reply(op,"rpg.external.validation-succeeded.v1");
        reply(op,"rpg.money.debited.v1");
        assertThat(status(op)).isEqualTo(Status.VALIDATING_CHARACTER);
        assertThat(drainOutbox()).isEmpty();
    }

    // ---------- validador externo fora do ar (o teste da tela) ----------

    @Test @DisplayName("validador volta DENTRO do prazo: a resposta que estava na fila continua a compra até a entrega")
    void validatorBackWithinDeadline() {
        var op=start(); drainOutbox();
        reply(op,"rpg.character.validated.v1"); drainOutbox();
        // validador desligado: ninguém responde; o verificador de prazo roda e não encerra nada
        saga.expireDue();
        assertThat(status(op)).isEqualTo(Status.VALIDATING_EXTERNAL);
        // validador volta e responde
        reply(op,"rpg.external.validation-succeeded.v1");
        reply(op,"rpg.money.debited.v1");
        assertThat(status(op)).isEqualTo(Status.COMPLETED);
        assertThat(available()).isEqualTo(STOCK-1);
    }

    @Test @DisplayName("validador fora DEPOIS do prazo: a compra expira, devolve o estoque e avisa o S2 (DEADLINE_EXPIRED)")
    void validatorDownPastDeadline() {
        var expiring=new DynamoSagaRepository(store,json,0); // prazo de 0 s: já vence
        saga=expiring;
        var op=start(); drainOutbox();
        reply(op,"rpg.character.validated.v1"); // chega tarde: a Saga já venceu
        saga.expireDue();
        assertThat(status(op)).isEqualTo(Status.EXPIRED);
        assertThat(available()).isEqualTo(STOCK);
        assertThat(reserved()).isZero();
        var cancelled=only(drainOutbox(),"rpg.acquisition.cancelled.v1");
        assertThat(cancelled.path("payload").path("reason").asText()).isEqualTo("DEADLINE_EXPIRED");
    }

    @Test @DisplayName("resposta atrasada do validador depois de expirar é ignorada: nada é cobrado nem entregue")
    void lateValidatorReplyIsIgnored() {
        saga=new DynamoSagaRepository(store,json,0);
        var op=start();
        saga.expireDue();
        assertThat(status(op)).isEqualTo(Status.EXPIRED);
        drainOutbox();
        reply(op,"rpg.character.validated.v1");
        reply(op,"rpg.external.validation-succeeded.v1");
        assertThat(status(op)).isEqualTo(Status.EXPIRED);
        assertThat(drainOutbox()).isEmpty();
        assertThat(available()).isEqualTo(STOCK);
        assertThat(store.findInventory(CHARACTER)).isEmpty();
    }

    @Test @DisplayName("expiração cobre os três passos de espera")
    void expirationCoversEveryWaitingStep() {
        saga=new DynamoSagaRepository(store,json,0);
        var waitingCharacter=start();
        saga.expireDue();
        assertThat(status(waitingCharacter)).isEqualTo(Status.EXPIRED);
        assertThat(available()).isEqualTo(STOCK);
    }

    @Test @DisplayName("débito que chega depois de a compra ser encerrada gera pedido de reembolso")
    void lateDebitIsRefunded() {
        var op=start();
        reply(op,"rpg.character.validated.v1");
        reply(op,"rpg.external.validation-succeeded.v1");
        reply(op,"rpg.money.debit-rejected.v1",UUID.randomUUID().toString(),"INSUFFICIENT_FUNDS");
        assertThat(status(op)).isEqualTo(Status.COMPENSATED);
        drainOutbox();
        reply(op,"rpg.money.debited.v1"); // débito atrasado de outra tentativa
        assertThat(types(drainOutbox())).containsExactly("rpg.money.refund-requested.v1");
        assertThat(status(op)).isEqualTo(Status.COMPENSATED);
        assertThat(store.findInventory(CHARACTER)).isEmpty();
    }

    // ---------- compensações ----------

    @Test @DisplayName("validação externa recusada: devolve o estoque e termina COMPENSATED")
    void externalFailureCompensates() {
        var op=start();
        reply(op,"rpg.character.validated.v1"); drainOutbox();
        reply(op,"rpg.external.validation-failed.v1");
        assertThat(status(op)).isEqualTo(Status.COMPENSATED);
        assertThat(available()).isEqualTo(STOCK);
        assertThat(only(drainOutbox(),"rpg.acquisition.cancelled.v1").path("payload").path("reason").asText())
            .isEqualTo("EXTERNAL_VALIDATION_FAILED");
    }

    @Test @DisplayName("saldo insuficiente: devolve o estoque e termina COMPENSATED com PAYMENT_REJECTED")
    void paymentRejectedCompensates() {
        var op=start();
        reply(op,"rpg.character.validated.v1");
        reply(op,"rpg.external.validation-succeeded.v1"); drainOutbox();
        reply(op,"rpg.money.debit-rejected.v1",UUID.randomUUID().toString(),"INSUFFICIENT_FUNDS");
        assertThat(status(op)).isEqualTo(Status.COMPENSATED);
        assertThat(available()).isEqualTo(STOCK);
        assertThat(only(drainOutbox(),"rpg.acquisition.cancelled.v1").path("payload").path("reason").asText())
            .isEqualTo("PAYMENT_REJECTED");
    }

    // ---------- idempotência e validação ----------

    @Test @DisplayName("mesma mensagem duas vezes (reentrega) não repete o efeito")
    void duplicateReplyIsIgnored() {
        var op=start(); drainOutbox();
        var messageId=UUID.randomUUID().toString();
        reply(op,"rpg.character.validated.v1",messageId,"");
        reply(op,"rpg.character.validated.v1",messageId,"");
        assertThat(types(drainOutbox())).containsExactly("rpg.external.validation-requested.v1");
        assertThat(status(op)).isEqualTo(Status.VALIDATING_EXTERNAL);
    }

    @Test @DisplayName("resposta de outro personagem ou de operação desconhecida é recusada (vai para retry/DLQ)")
    void mismatchedReplyIsRefused() {
        var op=start();
        assertThatThrownBy(() -> saga.receive(new ValidationResult(UUID.randomUUID().toString(),op,op,
            "rpg.character.validated.v1",1,CAMPAIGN,USER,"outro",itemId,PRICE,"")))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> reply("nao-existe","rpg.character.validated.v1"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThat(status(op)).isEqualTo(Status.VALIDATING_CHARACTER);
    }
}
