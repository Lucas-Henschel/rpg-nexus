package br.furb.rpg.inventory.ports;

import java.util.List;

/** Loja e projeção local das permissões recebidas do serviço de Campanhas. */
public interface CommercePort {
    record Shop(String campaignId, String name, boolean active) {}
    record ShopItem(String campaignId, String itemId, String name, String description,
                    long price, long available, long reserved) {}
    record Membership(String campaignId, String userId, String role, String characterId) {}

    Shop findShop(String campaignId);
    Shop saveShop(String campaignId, String name, boolean active);
    List<ShopItem> listShopItems(String campaignId);
    ShopItem findShopItem(String campaignId, String itemId);
    ShopItem createShopItem(String campaignId, String name, String description, long price, long available);
    ShopItem saveShopItem(String campaignId, String itemId, String name, String description,
                          long price, long available);
    boolean removeShopItem(String campaignId, String itemId);
    Membership findMembership(String campaignId, String userId);
    /** Grava um evento do S1 na cópia local; eventos mais antigos que o já gravado são ignorados. */
    void projectCampaignEvent(String messageId, String type, String campaignId, String userId,
                              String role, String characterId, long occurredAtMillis);
}
