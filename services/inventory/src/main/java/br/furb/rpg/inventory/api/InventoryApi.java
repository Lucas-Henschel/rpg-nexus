package br.furb.rpg.inventory.api;

import br.furb.rpg.inventory.application.InventoryService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
class InventoryApi {
    private final InventoryService service;
    private final AccessToken tokens;
    private final CampaignAccess campaigns;
    InventoryApi(InventoryService service,AccessToken tokens,CampaignAccess campaigns) {
        this.service=service;this.tokens=tokens;this.campaigns=campaigns;
    }
    record Acquisition(@NotBlank String campaignId, @NotBlank String characterId, @NotBlank String itemId) {}
    record Shop(@NotBlank String name, boolean active) {}
    record ShopItem(@NotBlank String name, String description,
                    @PositiveOrZero long price, @PositiveOrZero long available) {}
    @GetMapping("/health") Map<String,String> health() { return Map.of("status","UP"); }
    /** Itens entregues ao personagem; mostra só os das campanhas de que quem chamou participa. */
    @GetMapping("/inventory/{characterId}") ResponseEntity<?> inventory(@PathVariable String characterId,
            @RequestHeader(value="Authorization",required=false) String authorization) {
        var userId=tokens.userId(authorization);
        if(userId==null) return unauthorized();
        var entries=service.catalog().findInventory(characterId);
        var allowed=new HashMap<String,Boolean>();
        return ResponseEntity.ok(entries.stream()
            .filter(entry -> allowed.computeIfAbsent(entry.campaignId(),id -> campaigns.member(id,userId)))
            .toList());
    }
    @GetMapping("/shops/{campaignId}") ResponseEntity<?> shop(@PathVariable String campaignId,
            @RequestHeader(value="Authorization",required=false) String authorization) {
        var userId=tokens.userId(authorization);
        if(userId==null) return unauthorized();
        if(!campaigns.member(campaignId,userId)) return notMember(campaignId);
        var shop=service.commerce().findShop(campaignId);
        return shop==null?ResponseEntity.notFound().build():ResponseEntity.ok(shop);
    }
    @PutMapping("/shops/{campaignId}") ResponseEntity<?> saveShop(@PathVariable String campaignId,
            @RequestHeader(value="Authorization",required=false) String authorization,@Valid @RequestBody Shop request) {
        var userId=tokens.userId(authorization);
        if(userId==null) return unauthorized();
        if(!campaigns.owner(campaignId,userId)) return ownerRequired(campaignId,userId);
        return ResponseEntity.ok(service.commerce().saveShop(campaignId,request.name(),request.active()));
    }
    @GetMapping("/shops/{campaignId}/items") ResponseEntity<?> shopItems(@PathVariable String campaignId,
            @RequestHeader(value="Authorization",required=false) String authorization) {
        var userId=tokens.userId(authorization);
        if(userId==null) return unauthorized();
        if(!campaigns.member(campaignId,userId)) return notMember(campaignId);
        return ResponseEntity.ok(service.commerce().listShopItems(campaignId));
    }
    @PostMapping("/shops/{campaignId}/items") ResponseEntity<?> createShopItem(
            @PathVariable String campaignId,@RequestHeader(value="Authorization",required=false) String authorization,
            @Valid @RequestBody ShopItem request) {
        var userId=tokens.userId(authorization);
        if(userId==null) return unauthorized();
        if(!campaigns.owner(campaignId,userId)) return ownerRequired(campaignId,userId);
        if(service.commerce().findShop(campaignId)==null) return ResponseEntity.badRequest().body(Map.of("error","shop not found"));
        return ResponseEntity.status(201).body(service.commerce().createShopItem(campaignId,request.name(),
            request.description()==null?"":request.description(),request.price(),request.available()));
    }
    @PutMapping("/shops/{campaignId}/items/{itemId}") ResponseEntity<?> saveShopItem(
            @PathVariable String campaignId,@PathVariable String itemId,@RequestHeader(value="Authorization",required=false) String authorization,
            @Valid @RequestBody ShopItem request) {
        var userId=tokens.userId(authorization);
        if(userId==null) return unauthorized();
        if(!campaigns.owner(campaignId,userId)) return ownerRequired(campaignId,userId);
        if(service.commerce().findShop(campaignId)==null) return ResponseEntity.badRequest().body(Map.of("error","shop not found"));
        if(service.commerce().findShopItem(campaignId,itemId)==null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(service.commerce().saveShopItem(campaignId,itemId,request.name(),
            request.description()==null?"":request.description(),request.price(),request.available()));
    }
    @DeleteMapping("/shops/{campaignId}/items/{itemId}") ResponseEntity<?> removeShopItem(
            @PathVariable String campaignId,@PathVariable String itemId,@RequestHeader(value="Authorization",required=false) String authorization) {
        var userId=tokens.userId(authorization);
        if(userId==null) return unauthorized();
        if(!campaigns.owner(campaignId,userId)) return ownerRequired(campaignId,userId);
        return service.commerce().removeShopItem(campaignId,itemId)?ResponseEntity.noContent().build():ResponseEntity.notFound().build();
    }
    @PostMapping("/acquisitions") ResponseEntity<?> acquire(@RequestHeader("Idempotency-Key") String key,
                                                        @RequestHeader(value="Authorization",required=false) String authorization,
                                                        @Valid @RequestBody Acquisition request) {
        var userId=tokens.userId(authorization);
        if(userId==null) return unauthorized();
        if(key.isBlank()) return ResponseEntity.badRequest().body(Map.of("error","Idempotency-Key required"));
        if(!campaigns.chosenCharacter(request.campaignId(),userId,request.characterId()))
            return ResponseEntity.status(403).body(Map.of("error","selected campaign character required"));
        var result=service.acquire(key,request.campaignId(),userId,request.characterId(),request.itemId());
        switch(result.result()) {
            case CONFLICT -> { return ResponseEntity.status(409).body(Map.of("error","Idempotency-Key reused with different body")); }
            case SHOP_ITEM_NOT_FOUND -> { return ResponseEntity.notFound().build(); }
            case OUT_OF_STOCK -> { return ResponseEntity.status(409).body(Map.of("error","out of stock")); }
            default -> { }
        }
        return ResponseEntity.accepted().body(Map.of("operationId",result.operationId(),"statusUrl","/acquisitions/"+result.operationId()));
    }
    @GetMapping("/acquisitions/{operationId}") ResponseEntity<?> status(@PathVariable String operationId,
            @RequestHeader(value="Authorization",required=false) String authorization) {
        var userId=tokens.userId(authorization);
        if(userId==null) return unauthorized();
        var acquisition=service.acquisition(operationId);
        if(acquisition==null) return ResponseEntity.notFound().build();
        if(!acquisition.userId().equals(userId) && !campaigns.owner(acquisition.campaignId(),userId)) return ResponseEntity.status(403).build();
        return ResponseEntity.ok(Map.of("operationId",operationId,"status",acquisition.status().name(),
            "campaignId",acquisition.campaignId(),"characterId",acquisition.characterId(),
            "itemId",acquisition.itemId(),"price",acquisition.price(),"deadlineAt",acquisition.deadlineAt().toString()));
    }
    @GetMapping("/acquisitions/{operationId}/history") ResponseEntity<?> history(@PathVariable String operationId,
            @RequestHeader(value="Authorization",required=false) String authorization) {
        var userId=tokens.userId(authorization);
        if(userId==null) return unauthorized();
        var acquisition=service.acquisition(operationId);
        if(acquisition==null) return ResponseEntity.notFound().build();
        if(!acquisition.userId().equals(userId) && !campaigns.owner(acquisition.campaignId(),userId)) return ResponseEntity.status(403).build();
        return ResponseEntity.ok(service.history(operationId));
    }
    /**
     * 403 de quem ainda não aparece na cópia local de participantes. Logo depois de criar ou entrar na
     * campanha, o evento do S1 pode não ter chegado (consistência eventual): o código igual ao do S2
     * permite ao front esperar e tentar de novo em vez de mostrar erro.
     */
    private ResponseEntity<?> notMember(String campaignId) {
        return ResponseEntity.status(403).body(Map.of("error",Map.of(
            "code","NOT_CAMPAIGN_MEMBER",
            "message","você não participa desta campanha. Se acabou de entrar nela, tente de novo em alguns segundos.",
            "details",Map.of("campaignId",campaignId))));
    }
    /** Quem ainda não aparece como participante recebe NOT_CAMPAIGN_MEMBER; participante que não é dono, o erro de dono. */
    private ResponseEntity<?> ownerRequired(String campaignId,String userId) {
        if(!campaigns.member(campaignId,userId)) return notMember(campaignId);
        return ResponseEntity.status(403).body(Map.of("error","campaign owner required"));
    }
    private ResponseEntity<?> unauthorized() { return ResponseEntity.status(401).body(Map.of("error","authentication required")); }
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    ResponseEntity<?> malformed() { return ResponseEntity.badRequest().body(Map.of("error","invalid JSON")); }
    @ExceptionHandler(software.amazon.awssdk.services.dynamodb.model.TransactionCanceledException.class)
    ResponseEntity<?> reserved() { return ResponseEntity.status(409).body(Map.of("error","item has a pending purchase")); }
}
