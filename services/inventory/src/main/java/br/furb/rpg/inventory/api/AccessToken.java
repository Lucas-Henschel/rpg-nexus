package br.furb.rpg.inventory.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class AccessToken {
    private final ObjectMapper json;
    private final String secret, issuer, audience;

    AccessToken(ObjectMapper json, @Value("${JWT_SECRET:}") String secret,
                @Value("${JWT_ISSUER:rpg-nexus-identity}") String issuer,
                @Value("${JWT_AUDIENCE:rpg-nexus-services}") String audience) {
        this.json=json; this.secret=secret; this.issuer=issuer; this.audience=audience;
    }

    String userId(String authorization) {
        if(authorization==null || !authorization.startsWith("Bearer ") || secret.isBlank()) return null;
        try {
            var parts=authorization.substring(7).split("\\.", -1);
            if(parts.length!=3 || parts[0].isBlank() || parts[1].isBlank() || parts[2].isBlank()) return null;
            var decoder=Base64.getUrlDecoder();
            var header=json.readTree(decoder.decode(parts[0]));
            if(!"HS256".equals(header.path("alg").asText())) return null;
            var mac=Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
            var signature=mac.doFinal((parts[0]+"."+parts[1]).getBytes(StandardCharsets.UTF_8));
            if(!MessageDigest.isEqual(signature,decoder.decode(parts[2]))) return null;
            var claims=json.readTree(decoder.decode(parts[1]));
            if(!issuer.equals(claims.path("iss").asText()) || !audience.equals(claims.path("aud").asText())
                || !claims.path("exp").isNumber() || claims.path("exp").asLong()<=Instant.now().getEpochSecond()) return null;
            var id=claims.path("sub").asText();
            return id.isBlank()?null:id;
        } catch(Exception invalid) { return null; }
    }
}
