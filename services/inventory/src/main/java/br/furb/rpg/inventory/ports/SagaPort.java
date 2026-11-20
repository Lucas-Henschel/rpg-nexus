package br.furb.rpg.inventory.ports;

import br.furb.rpg.inventory.domain.Acquisition;
import br.furb.rpg.inventory.domain.ValidationResult;
import java.time.Instant;
import java.util.List;

public interface SagaPort {
    enum StartResult { STARTED, IDEMPOTENT, CONFLICT, FORBIDDEN, SHOP_ITEM_NOT_FOUND, OUT_OF_STOCK }
    record HistoryEntry(String status, Instant occurredAt) {}
    StartResult start(String operationId, String campaignId, String userId, String characterId, String itemId);
    Acquisition find(String operationId);
    List<HistoryEntry> history(String operationId);
    void receive(ValidationResult result);
    void expireDue();
}
