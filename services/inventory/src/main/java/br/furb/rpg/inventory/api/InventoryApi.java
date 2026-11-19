package br.furb.rpg.inventory.api;

import br.furb.rpg.inventory.application.InventoryService;
import br.furb.rpg.inventory.ports.CatalogPort;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
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
    record Shop(@NotBlank String name, boolean active) {}
    record ShopItem(@NotBlank String itemId, @NotBlank String name, String description,
                    @PositiveOrZero long price, @PositiveOrZero long available) {}
    @GetMapping("/health") Map<String,String> health() { return Map.of("status","UP"); }
    @PostMapping("/items") ResponseEntity<?> item(@Valid @RequestBody Item item) {
        service.catalog().saveItem(item.itemId(),item.name());
        return ResponseEntity.status(201).body(item);
    }
    @GetMapping("/items") Object items() { return service.catalog().listItems(); }
    @GetMapping("/stocks") Object stocks(@RequestParam String campaignId) {
        return service.catalog().listStocks(campaignId);
    }
    @PostMapping("/stocks") ResponseEntity<?> stock(@RequestHeader("X-User-Id") String userId,
                                                     @Valid @RequestBody Stock stock) {
        if(!owner(stock.campaignId(),userId)) return ResponseEntity.status(403).body(Map.of("error","campaign owner required"));
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
    @GetMapping("/shops/{campaignId}") ResponseEntity<?> shop(@PathVariable String campaignId) {
        var shop=service.commerce().findShop(campaignId);
        return shop==null?ResponseEntity.notFound().build():ResponseEntity.ok(shop);
    }
    @PutMapping("/shops/{campaignId}") ResponseEntity<?> saveShop(@PathVariable String campaignId,
            @RequestHeader("X-User-Id") String userId,@Valid @RequestBody Shop request) {
        if(!owner(campaignId,userId)) return ResponseEntity.status(403).body(Map.of("error","campaign owner required"));
        return ResponseEntity.ok(service.commerce().saveShop(campaignId,request.name(),request.active()));
    }
    @GetMapping("/shops/{campaignId}/items") Object shopItems(@PathVariable String campaignId) {
        return service.commerce().listShopItems(campaignId);
    }
    @PutMapping("/shops/{campaignId}/items/{itemId}") ResponseEntity<?> saveShopItem(
            @PathVariable String campaignId,@PathVariable String itemId,@RequestHeader("X-User-Id") String userId,
            @Valid @RequestBody ShopItem request) {
        if(!owner(campaignId,userId)) return ResponseEntity.status(403).body(Map.of("error","campaign owner required"));
        if(!itemId.equals(request.itemId())) return ResponseEntity.badRequest().body(Map.of("error","itemId does not match path"));
        if(service.commerce().findShop(campaignId)==null) return ResponseEntity.badRequest().body(Map.of("error","shop not found"));
        return ResponseEntity.ok(service.commerce().saveShopItem(campaignId,itemId,request.name(),
            request.description()==null?"":request.description(),request.price(),request.available()));
    }
    @DeleteMapping("/shops/{campaignId}/items/{itemId}") ResponseEntity<?> removeShopItem(
            @PathVariable String campaignId,@PathVariable String itemId,@RequestHeader("X-User-Id") String userId) {
        if(!owner(campaignId,userId)) return ResponseEntity.status(403).body(Map.of("error","campaign owner required"));
        return service.commerce().removeShopItem(campaignId,itemId)?ResponseEntity.noContent().build():ResponseEntity.notFound().build();
    }
    @PostMapping("/acquisitions") ResponseEntity<?> acquire(@RequestHeader("Idempotency-Key") String key,
                                                        @RequestHeader("X-User-Id") String userId,
                                                        @Valid @RequestBody Acquisition request) {
        if(key.isBlank()) return ResponseEntity.badRequest().body(Map.of("error","Idempotency-Key required"));
        var result=service.acquire(key,request.campaignId(),userId,request.characterId(),request.itemId());
        switch(result.result()) {
            case CONFLICT -> { return ResponseEntity.status(409).body(Map.of("error","Idempotency-Key reused with different body")); }
            case FORBIDDEN -> { return ResponseEntity.status(403).body(Map.of("error","active campaign membership required")); }
            case SHOP_ITEM_NOT_FOUND -> { return ResponseEntity.notFound().build(); }
            case OUT_OF_STOCK -> { return ResponseEntity.status(409).body(Map.of("error","out of stock")); }
            default -> { }
        }
        return ResponseEntity.accepted().body(Map.of("operationId",result.operationId(),"statusUrl","/acquisitions/"+result.operationId()));
    }
    @GetMapping("/acquisitions/{operationId}") ResponseEntity<?> status(@PathVariable String operationId) {
        var acquisition=service.acquisition(operationId);
        if(acquisition==null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(Map.of("operationId",operationId,"status",acquisition.status().name(),
            "campaignId",acquisition.campaignId(),"characterId",acquisition.characterId(),
            "itemId",acquisition.itemId(),"price",acquisition.price(),"deadlineAt",acquisition.deadlineAt().toString()));
    }
    @GetMapping("/acquisitions/{operationId}/history") ResponseEntity<?> history(@PathVariable String operationId) {
        if(service.acquisition(operationId)==null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(service.history(operationId));
    }
    private boolean owner(String campaignId,String userId) {
        var member=service.commerce().findMembership(campaignId,userId);
        return member!=null && member.role().equals("OWNER");
    }
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    ResponseEntity<?> malformed() { return ResponseEntity.badRequest().body(Map.of("error","invalid JSON")); }
}
