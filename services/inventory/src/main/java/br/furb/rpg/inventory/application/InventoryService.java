package br.furb.rpg.inventory.application;

import br.furb.rpg.inventory.domain.Acquisition;
import br.furb.rpg.inventory.ports.CatalogPort;
import br.furb.rpg.inventory.ports.CommercePort;
import br.furb.rpg.inventory.ports.SagaPort;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class InventoryService {
    private final CatalogPort catalog;
    private final CommercePort commerce;
    private final SagaPort saga;
    public InventoryService(CatalogPort catalog, CommercePort commerce, SagaPort saga) {
        this.catalog=catalog; this.commerce=commerce; this.saga=saga;
    }
    public CatalogPort catalog() { return catalog; }
    public CommercePort commerce() { return commerce; }
    public record Start(String operationId, SagaPort.StartResult result) {}
    public Start acquire(String key, String campaignId, String userId, String characterId, String itemId) {
        String id=UUID.nameUUIDFromBytes(("inventory:v1:"+key).getBytes(StandardCharsets.UTF_8)).toString();
        return new Start(id,saga.start(id,campaignId,userId,characterId,itemId));
    }
    public Acquisition acquisition(String operationId) { return saga.find(operationId); }
    public List<SagaPort.HistoryEntry> history(String operationId) { return saga.history(operationId); }
}
