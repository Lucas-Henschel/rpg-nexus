package br.furb.rpg.inventory.domain;

import java.time.Instant;

public record Acquisition(String operationId, String campaignId, String characterId,
                          String itemId, Status status, long version, Instant deadlineAt) {
    public enum Status { VALIDATING_CHARACTER, VALIDATING_EXTERNAL, COMPLETED, COMPENSATED, REJECTED, EXPIRED }
}
