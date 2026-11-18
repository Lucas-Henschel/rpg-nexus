package br.furb.rpg.inventory.api;

import br.furb.rpg.inventory.application.InventoryService;
import br.furb.rpg.inventory.ports.CatalogPort;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
class InventoryApi {
    private final InventoryService service;
    InventoryApi(InventoryService service) { this.service=service; }
    record Item(@NotBlank String itemId, @NotBlank String name) {}
    record Stock(@NotBlank String campaignId, @NotBlank String itemId, int available) {}
    record Acquisition(@NotBlank String campaignId, @NotBlank String characterId, @NotBlank String itemId) {}
    @GetMapping("/health") Map<String,String> health() { return Map.of("status","UP"); }
    @PostMapping("/items") ResponseEntity<?> item(@Valid @RequestBody Item item) {
        service.catalog().saveItem(item.itemId(),item.name());
        return ResponseEntity.status(201).body(item);
    }
    @GetMapping("/items") Object items() { return service.catalog().listItems(); }
    @GetMapping("/stocks") Object stocks(@RequestParam String campaignId) {
        return service.catalog().listStocks(campaignId);
    }
    @PostMapping("/stocks") ResponseEntity<?> stock(@Valid @RequestBody Stock stock) {
        if(stock.available()<0) return ResponseEntity.badRequest().body(Map.of("error","available must be nonnegative"));
        var result=service.catalog().createStock(stock.campaignId(),stock.itemId(),stock.available());
        if(result==CatalogPort.CreateStock.ITEM_NOT_FOUND) return ResponseEntity.badRequest().body(Map.of("error","item not found"));
        if(result==CatalogPort.CreateStock.ALREADY_EXISTS) return ResponseEntity.status(409).body(Map.of("error","stock already exists"));
        return ResponseEntity.status(201).body(stock);
    }
    @GetMapping("/stocks/{campaignId}/{itemId}") ResponseEntity<?> stock(@PathVariable String campaignId,@PathVariable String itemId) {
        var stock=service.catalog().findStock(campaignId,itemId);
        return stock==null?ResponseEntity.notFound().build():ResponseEntity.ok(stock);
    }
    @GetMapping("/inventory/{characterId}") Object inventory(@PathVariable String characterId) {
        return service.catalog().findInventory(characterId);
    }
    @PostMapping("/acquisitions") ResponseEntity<?> acquire(@RequestHeader("Idempotency-Key") String key,
                                                        @Valid @RequestBody Acquisition request) {
        if(key.isBlank()) return ResponseEntity.badRequest().body(Map.of("error","Idempotency-Key required"));
        var result=service.acquire(key,request.campaignId(),request.characterId(),request.itemId());
        if(result.conflict()) return ResponseEntity.status(409).body(Map.of("error","Idempotency-Key reused with different body"));
        return ResponseEntity.accepted().body(Map.of("operationId",result.operationId(),"statusUrl","/acquisitions/"+result.operationId()));
    }
    @GetMapping("/acquisitions/{operationId}") ResponseEntity<?> status(@PathVariable String operationId) {
        var acquisition=service.acquisition(operationId);
        if(acquisition==null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(Map.of("operationId",operationId,"status",acquisition.status().name(),
            "campaignId",acquisition.campaignId(),"characterId",acquisition.characterId(),
            "itemId",acquisition.itemId(),"deadlineAt",acquisition.deadlineAt().toString()));
    }
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    ResponseEntity<?> malformed() { return ResponseEntity.badRequest().body(Map.of("error","invalid JSON")); }
}
