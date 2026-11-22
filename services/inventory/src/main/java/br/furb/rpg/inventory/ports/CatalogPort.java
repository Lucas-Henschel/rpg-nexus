package br.furb.rpg.inventory.ports;

import java.util.List;

/** Leitura dos itens já entregues aos personagens pela Saga de compra. */
public interface CatalogPort {
    record InventoryEntry(String operationId, String campaignId, String itemId, long quantity) {}
    List<InventoryEntry> findInventory(String characterId);
}
