package br.furb.rpg.inventory.api;

import static org.assertj.core.api.Assertions.assertThat;

import br.furb.rpg.inventory.ports.CommercePort;
import br.furb.rpg.inventory.ports.CommercePort.Membership;
import java.lang.reflect.Proxy;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Quem pode o quê na loja, a partir da cópia local de participantes (sem chamar o S1). */
class CampaignAccessTest {
    private final Map<String,Membership> rows=Map.of(
        "c1#dono",new Membership("c1","dono","OWNER","npc-1"),
        "c1#jogador",new Membership("c1","jogador","PLAYER","char-1"));
    private final CommercePort port=(CommercePort)Proxy.newProxyInstance(getClass().getClassLoader(),
        new Class<?>[] {CommercePort.class}, (proxy,method,args) -> {
            if(method.getName().equals("findMembership")) return rows.get(args[0]+"#"+args[1]);
            throw new UnsupportedOperationException(method.getName());
        });
    private final CampaignAccess access=new CampaignAccess(port);

    @Test @DisplayName("participante vê a loja; quem não participa, não")
    void member() {
        assertThat(access.member("c1","jogador")).isTrue();
        assertThat(access.member("c1","dono")).isTrue();
        assertThat(access.member("c1","estranho")).isFalse();
        assertThat(access.member("outra","jogador")).isFalse();
    }

    @Test @DisplayName("só o dono edita a loja")
    void owner() {
        assertThat(access.owner("c1","dono")).isTrue();
        assertThat(access.owner("c1","jogador")).isFalse();
        assertThat(access.owner("c1","estranho")).isFalse();
    }

    @Test @DisplayName("só compra com o personagem que escolheu na campanha")
    void chosenCharacter() {
        assertThat(access.chosenCharacter("c1","jogador","char-1")).isTrue();
        assertThat(access.chosenCharacter("c1","jogador","char-2")).isFalse();
        assertThat(access.chosenCharacter("c1","estranho","char-1")).isFalse();
    }
}
