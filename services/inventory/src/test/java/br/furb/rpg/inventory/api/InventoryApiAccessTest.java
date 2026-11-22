package br.furb.rpg.inventory.api;

import static org.assertj.core.api.Assertions.assertThat;

import br.furb.rpg.inventory.application.InventoryService;
import br.furb.rpg.inventory.ports.CatalogPort;
import br.furb.rpg.inventory.ports.CommercePort;
import br.furb.rpg.inventory.ports.CommercePort.Membership;
import br.furb.rpg.inventory.ports.SagaPort;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * O 403 de quem ainda não está na cópia local de participantes traz o código NOT_CAMPAIGN_MEMBER,
 * para o front saber que é passageiro (evento do S1 a caminho) e tentar de novo.
 */
class InventoryApiAccessTest {
    private static final String SECRET="segredo-de-teste";
    private final Map<String,Membership> rows=Map.of(
        "c1#dono",new Membership("c1","dono","OWNER",null),
        "c1#jogador",new Membership("c1","jogador","PLAYER",null));
    private final CommercePort commerce=(CommercePort)Proxy.newProxyInstance(getClass().getClassLoader(),
        new Class<?>[] {CommercePort.class}, (proxy,method,args) -> switch(method.getName()) {
            case "findMembership" -> rows.get(args[0]+"#"+args[1]);
            case "findShop" -> null;
            default -> throw new UnsupportedOperationException(method.getName());
        });
    private final InventoryApi api=new InventoryApi(
        new InventoryService(unused(CatalogPort.class),commerce,unused(SagaPort.class)),
        new AccessToken(new ObjectMapper(),SECRET,"rpg-nexus-identity","rpg-nexus-services"),
        new CampaignAccess(commerce));

    @Test @DisplayName("quem ainda não aparece como participante recebe NOT_CAMPAIGN_MEMBER ao ver a loja")
    void shopNotMember() {
        var response=api.shop("c1",bearer("recem-chegado"));
        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(code(response.getBody())).isEqualTo("NOT_CAMPAIGN_MEMBER");
        assertThat(code(api.shopItems("c1",bearer("recem-chegado")).getBody())).isEqualTo("NOT_CAMPAIGN_MEMBER");
    }

    @Test @DisplayName("ao editar a loja, quem não aparece como participante recebe NOT_CAMPAIGN_MEMBER")
    void saveShopNotMember() {
        var response=api.saveShop("c1",bearer("recem-chegado"),new InventoryApi.Shop("Loja",true));
        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(code(response.getBody())).isEqualTo("NOT_CAMPAIGN_MEMBER");
    }

    @Test @DisplayName("participante que não é dono continua recebendo o erro de dono")
    void saveShopNotOwner() {
        var response=api.saveShop("c1",bearer("jogador"),new InventoryApi.Shop("Loja",true));
        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).isEqualTo(Map.of("error","campaign owner required"));
    }

    @Test @DisplayName("participante sem loja criada recebe 404, não 403")
    void memberWithoutShop() {
        assertThat(api.shop("c1",bearer("jogador")).getStatusCode().value()).isEqualTo(404);
    }

    private static Object code(Object body) {
        return ((Map<?,?>)((Map<?,?>)body).get("error")).get("code");
    }

    @SuppressWarnings("unchecked")
    private static <T> T unused(Class<T> type) {
        return (T)Proxy.newProxyInstance(InventoryApiAccessTest.class.getClassLoader(),new Class<?>[] {type},
            (proxy,method,args) -> { throw new UnsupportedOperationException(method.getName()); });
    }

    private static String bearer(String userId) {
        try {
            var encoder=Base64.getUrlEncoder().withoutPadding();
            var header=encoder.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
            var claims=encoder.encodeToString(("{\"sub\":\""+userId+"\",\"iss\":\"rpg-nexus-identity\","
                +"\"aud\":\"rpg-nexus-services\",\"exp\":"+(Instant.now().getEpochSecond()+300)+"}").getBytes(StandardCharsets.UTF_8));
            var mac=Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
            var signature=encoder.encodeToString(mac.doFinal((header+"."+claims).getBytes(StandardCharsets.UTF_8)));
            return "Bearer "+header+"."+claims+"."+signature;
        } catch(Exception error) {
            throw new IllegalStateException(error);
        }
    }
}
