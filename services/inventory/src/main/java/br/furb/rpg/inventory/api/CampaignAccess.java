package br.furb.rpg.inventory.api;

import br.furb.rpg.inventory.ports.CommercePort;
import org.springframework.stereotype.Component;

/**
 * Autorização pela cópia local de participantes (eventos do S1), sem chamada HTTP ao S1.
 * Consistência eventual: logo depois de entrar na campanha ou escolher o personagem,
 * o evento pode levar um instante para chegar e a resposta ser 403.
 */
@Component
class CampaignAccess {
    private final CommercePort commerce;
    CampaignAccess(CommercePort commerce) { this.commerce=commerce; }

    boolean member(String campaignId,String userId) {
        return commerce.findMembership(campaignId,userId)!=null;
    }
    boolean owner(String campaignId,String userId) {
        var membership=commerce.findMembership(campaignId,userId);
        return membership!=null && "OWNER".equals(membership.role());
    }
    boolean chosenCharacter(String campaignId,String userId,String characterId) {
        var membership=commerce.findMembership(campaignId,userId);
        return membership!=null && characterId.equals(membership.characterId());
    }
}
