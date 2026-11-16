package br.furb.rpg.inventory.application;

import br.furb.rpg.inventory.domain.Acquisition;
import br.furb.rpg.inventory.ports.CatalogPort;
import br.furb.rpg.inventory.ports.SagaPort;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class InventoryService {
    private final CatalogPort catalog;
    private final SagaPort saga;
    public InventoryService(CatalogPort catalog, SagaPort saga) { this.catalog=catalog; this.saga=saga; }
    public CatalogPort catalog() { return catalog; }
    public record Start(String operationId, boolean conflict) {}
    public Start acquire(String key, String campaignId, String characterId, String itemId) {
        String id=UUID.nameUUIDFromBytes(("inventory:v1:"+key).getBytes(StandardCharsets.UTF_8)).toString();
        return new Start(id,saga.start(id,campaignId,characterId,itemId));
    }
    public Acquisition acquisition(String operationId) { return saga.find(operationId); }
}
