package br.furb.rpg.inventory.adapters.dynamodb;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

/** Cópia local de participantes (eventos do S1) que autoriza a loja. A ordem de chegada não pode importar. */
class CampaignProjectionTest {
    static final String CAMPAIGN="camp-1", OWNER="dono", PLAYER="jogador";
    static final String CREATED="rpg.campaign.created.v1", JOINED="rpg.campaign.member.joined.v1",
        CHOSEN="rpg.campaign.member.character-chosen.v1", REMOVED="rpg.campaign.member.removed.v1";
    private DynamoDbClient client;
    private DynamoStore store;

    @BeforeEach void setUp() { client=InMemoryDynamo.start(); store=new DynamoStore(client,InMemoryDynamo.PREFIX); }
    @AfterEach void tearDown() { client.close(); }

    void event(String type,String userId,String role,String characterId,long at) {
        event(UUID.randomUUID().toString(),type,userId,role,characterId,at);
    }
    void event(String messageId,String type,String userId,String role,String characterId,long at) {
        store.projectCampaignEvent(messageId,type,CAMPAIGN,userId,role,characterId,at);
    }
    boolean member(String userId) { return store.findMembership(CAMPAIGN,userId)!=null; }
    String role(String userId) { return store.findMembership(CAMPAIGN,userId).role(); }
    String character(String userId) { return store.findMembership(CAMPAIGN,userId).characterId(); }

    @Test @DisplayName("criar a campanha torna o criador dono")
    void createdMakesOwner() {
        event(CREATED,OWNER,"OWNER","",100);
        assertThat(member(OWNER)).isTrue();
        assertThat(role(OWNER)).isEqualTo("OWNER");
        assertThat(member(PLAYER)).isFalse();
    }

    @Test @DisplayName("entrar e escolher personagem: jogador participa com o personagem")
    void joinedAndChosen() {
        event(JOINED,PLAYER,"PLAYER","",100);
        event(CHOSEN,PLAYER,"PLAYER","char-1",200);
        assertThat(role(PLAYER)).isEqualTo("PLAYER");
        assertThat(character(PLAYER)).isEqualTo("char-1");
    }

    @Test @DisplayName("bug antigo: dono que escolhe personagem continua OWNER")
    void ownerKeepsRoleAfterChoosingCharacter() {
        event(CREATED,OWNER,"OWNER","",100);
        event(CHOSEN,OWNER,"PLAYER","npc-1",200);
        assertThat(role(OWNER)).isEqualTo("OWNER");
        assertThat(character(OWNER)).isEqualTo("npc-1");
    }

    @Test @DisplayName("bug antigo: 'joined' atrasado não apaga o personagem escolhido")
    void lateJoinedKeepsCharacter() {
        event(JOINED,PLAYER,"PLAYER","",100);
        event(CHOSEN,PLAYER,"PLAYER","char-1",200);
        event(JOINED,PLAYER,"PLAYER","",100); // reentrega com outro messageId
        assertThat(character(PLAYER)).isEqualTo("char-1");
    }

    @Test @DisplayName("personagem escolhido chega antes do 'joined': só participa quando o 'joined' chega")
    void chosenBeforeJoined() {
        event(CHOSEN,PLAYER,"PLAYER","char-1",200);
        assertThat(member(PLAYER)).isFalse();
        event(JOINED,PLAYER,"PLAYER","",100);
        assertThat(member(PLAYER)).isTrue();
        assertThat(character(PLAYER)).isEqualTo("char-1");
    }

    @Test @DisplayName("trocar de personagem: vale o mais recente, mesmo chegando fora de ordem")
    void latestCharacterWins() {
        event(JOINED,PLAYER,"PLAYER","",100);
        event(CHOSEN,PLAYER,"PLAYER","char-novo",300);
        event(CHOSEN,PLAYER,"PLAYER","char-velho",200);
        assertThat(character(PLAYER)).isEqualTo("char-novo");
    }

    @Test @DisplayName("bug antigo: sair da campanha remove o acesso")
    void removedLosesAccess() {
        event(JOINED,PLAYER,"PLAYER","",100);
        event(CHOSEN,PLAYER,"PLAYER","char-1",200);
        event(REMOVED,PLAYER,"","",300);
        assertThat(member(PLAYER)).isFalse();
    }

    @Test @DisplayName("eventos antigos depois da saída não devolvem o acesso")
    void staleEventsAfterRemovalAreIgnored() {
        event(JOINED,PLAYER,"PLAYER","",100);
        event(REMOVED,PLAYER,"","",300);
        event(JOINED,PLAYER,"PLAYER","",100);
        event(CHOSEN,PLAYER,"PLAYER","char-1",200);
        assertThat(member(PLAYER)).isFalse();
    }

    @Test @DisplayName("entrar de novo depois de sair volta a participar, sem o personagem antigo")
    void rejoinAfterRemoval() {
        event(JOINED,PLAYER,"PLAYER","",100);
        event(CHOSEN,PLAYER,"PLAYER","char-1",200);
        event(REMOVED,PLAYER,"","",300);
        event(JOINED,PLAYER,"PLAYER","",400);
        assertThat(member(PLAYER)).isTrue();
        assertThat(character(PLAYER)).isEmpty();
    }

    @Test @DisplayName("mesma mensagem duas vezes não muda nada (inbox)")
    void duplicateMessageIsIgnored() {
        var messageId=UUID.randomUUID().toString();
        event(messageId,JOINED,PLAYER,"PLAYER","",100);
        event(REMOVED,PLAYER,"","",300);
        event(messageId,JOINED,PLAYER,"PLAYER","",500); // mesma mensagem, mesmo que com instante maior
        assertThat(member(PLAYER)).isFalse();
    }

    @Test @DisplayName("linha antiga, gravada antes desta mudança (sem 'active'), continua valendo")
    void legacyRowCountsAsMember() {
        client.putItem(r -> r.tableName(InMemoryDynamo.PREFIX+"campaign_members").item(Map.of(
            "id",AttributeValue.fromS(CAMPAIGN+"#"+PLAYER),"campaignId",AttributeValue.fromS(CAMPAIGN),
            "userId",AttributeValue.fromS(PLAYER),"role",AttributeValue.fromS("PLAYER"),
            "characterId",AttributeValue.fromS("char-1"))));
        assertThat(member(PLAYER)).isTrue();
        assertThat(character(PLAYER)).isEqualTo("char-1");
    }
}
