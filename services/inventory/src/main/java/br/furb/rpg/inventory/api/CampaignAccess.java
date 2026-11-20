package br.furb.rpg.inventory.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
class CampaignAccess {
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final ObjectMapper json;
    private final String base;
    CampaignAccess(ObjectMapper json,@Value("${CAMPAIGNS_URL:http://localhost:3001}") String base) {
        this.json=json;this.base=base;
    }
    boolean member(String campaignId,String authorization) { return campaign(campaignId,authorization)!=null; }
    boolean owner(String campaignId,String userId,String authorization) {
        var campaign=campaign(campaignId,authorization);
        return campaign!=null && userId.equals(campaign.path("ownerId").asText());
    }
    boolean chosenCharacter(String campaignId,String userId,String characterId,String authorization) {
        var campaign=campaign(campaignId,authorization);
        if(campaign==null) return false;
        for(var member:campaign.path("members")) {
            if(userId.equals(member.path("userId").asText()) && characterId.equals(member.path("characterId").asText())) return true;
        }
        return false;
    }
    private com.fasterxml.jackson.databind.JsonNode campaign(String campaignId,String authorization) {
        try {
            var request=HttpRequest.newBuilder(URI.create(base+"/campaigns/"+URLEncoder.encode(campaignId,StandardCharsets.UTF_8)))
                .header("Authorization",authorization).timeout(Duration.ofSeconds(5)).GET().build();
            var response=http.send(request,HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()==401 || response.statusCode()==403 || response.statusCode()==404) return null;
            if(response.statusCode()!=200) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"campaign service unavailable");
            return json.readTree(response.body());
        } catch(ResponseStatusException failure) { throw failure; }
        catch(Exception failure) {
            if(failure instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"campaign service unavailable",failure);
        }
    }
}
