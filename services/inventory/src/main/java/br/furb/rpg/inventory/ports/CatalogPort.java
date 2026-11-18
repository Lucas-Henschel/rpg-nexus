package br.furb.rpg.inventory.ports;

import java.util.List;

public interface CatalogPort {
    record Item(String itemId, String name) {}
    record Stock(String campaignId, String itemId, long available) {}
    record InventoryEntry(String operationId, String campaignId, String itemId, long quantity) {}
    enum CreateStock { CREATED, ITEM_NOT_FOUND, ALREADY_EXISTS }
    void saveItem(String itemId, String name);
    List<Item> listItems();
    List<Stock> listStocks(String campaignId);
    CreateStock createStock(String campaignId, String itemId, int available);
    Stock findStock(String campaignId, String itemId);
    List<InventoryEntry> findInventory(String characterId);
}
