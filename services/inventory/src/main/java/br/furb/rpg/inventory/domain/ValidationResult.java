package br.furb.rpg.inventory.domain;

public record ValidationResult(String messageId, String operationId, String payloadOperationId, String type, int version,
                               String campaignId, String userId, String characterId, String itemId, long amount) {}
