package br.furb.rpg.inventory.domain;

public record ValidationResult(String messageId, String operationId, String payloadOperationId, String type, int version,
                               String campaignId, String characterId, String itemId) {}
