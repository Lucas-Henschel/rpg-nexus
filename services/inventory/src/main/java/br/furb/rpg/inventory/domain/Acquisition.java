package br.furb.rpg.inventory.domain;

import java.time.Instant;

public record Acquisition(String operationId, String campaignId, String userId, String characterId,
                          String itemId, long price, Status status, long version, Instant deadlineAt) {
    public enum Status { WAITING_MONEY, COMPLETED, COMPENSATED, REJECTED, EXPIRED }
}
