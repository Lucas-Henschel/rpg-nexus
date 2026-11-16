package br.furb.rpg.inventory.ports;

import br.furb.rpg.inventory.domain.Acquisition;
import br.furb.rpg.inventory.domain.ValidationResult;

public interface SagaPort {
    boolean start(String operationId, String campaignId, String characterId, String itemId);
    Acquisition find(String operationId);
    void receive(ValidationResult result);
    void expireDue();
}
