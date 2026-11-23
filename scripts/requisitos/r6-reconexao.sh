#!/usr/bin/env bash
# R6 — Reconexão (cenário F6: broker fora do ar).
#
# Para o RabbitMQ por 30 segundos. Enquanto ele está fora, os serviços continuam respondendo HTTP, marcam a
# mensageria como fora no /ready, e o que precisa ser publicado fica guardado na outbox de cada serviço.
# Quando o broker volta, todos reconectam sozinhos (sem reiniciar nada), as outboxes drenam e o que foi
# pedido durante a queda termina normalmente: nenhuma mensagem perdida.
#
#   bash scripts/requisitos/r6-reconexao.sh          (PAUSA=1 para parar entre as etapas)
#   FORA=30 bash scripts/requisitos/r6-reconexao.sh  (segundos com o broker parado)

source "$(dirname "$0")/lib.sh"

FORA="${FORA:-30}"


# prontidao  → código HTTP do /ready de cada serviço (S3: /actuator/health, que inclui o RabbitMQ)
prontidao() {
  local s1 s2 s3 s4
  s1="$(codigo_http "$S1_URL/ready")"
  s2="$(codigo_http "$S2_URL/ready")"
  s3="$(codigo_http "$S3_URL/actuator/health")"
  s4="$(codigo_http "$S4_URL/ready")"
  printf 'S1=%s S2=%s S3=%s S4=%s' "$s1" "$s2" "$s3" "$s4"
}

titulo "R6 — Reconexão (F6: RabbitMQ fora do ar por ${FORA}s)"
preparar_cenario
# Daqui em diante, se o script for interrompido, o RabbitMQ não fica parado.
trap 'docker compose start rabbitmq >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
ITEM="$(criar_item "Mapa antigo" 3 5)"
reconexoes_antes="$(curl -s "$S2_URL/internal/messaging" | json_num reconnects)"
info "prontidão antes: $(prontidao)"
pausa

passo "Parando o RabbitMQ"
cmd "docker compose stop rabbitmq"
dc stop rabbitmq
parou=$(date +%s)
sleep 5
estado="$(prontidao)"
info "prontidão com o broker fora: $estado"
confere "os serviços continuam respondendo e mostram a mensageria fora (503)" \
  [ "$(conta 503 "$estado")" -ge 3 ]
pausa

passo "Trabalhando durante a queda"
comprar "$ITEM"
info "compra: HTTP $HTTP_CODE — operação $OPERACAO"
confere "a compra é aceita mesmo com o broker fora (202)" [ "$HTTP_CODE" = "202" ]

api POST "$S1_URL/campaigns" '{"name":"Criada com o broker fora"}'
CAMPANHA_NOVA="$(json_str campaignId "$BODY")"
info "campanha criada no S1: HTTP $HTTP_CODE ($CAMPANHA_NOVA)"
confere "o S1 aceita criar campanha (o evento fica na outbox)" [ "$HTTP_CODE" = "201" ]

sleep 3
info "estado da compra: $(status_compra "$OPERACAO") (parada: o pedido ao S2 está na outbox do S3)"
restante=$(( FORA - ( $(date +%s) - parou ) ))
if [ "$restante" -gt 0 ]; then
  info "esperando ${restante}s para completar ${FORA}s de broker fora…"
  sleep "$restante"
fi
pausa

passo "Ligando o RabbitMQ de novo (sem reiniciar nenhum serviço)"
cmd "docker compose start rabbitmq"
dc start rabbitmq
volta=$(date +%s)
for _ in $(seq 120); do
  estado="$(prontidao)"
  [ "$estado" = "S1=200 S2=200 S3=200 S4=200" ] && break
  sleep 1
done
info "prontidão: $estado (em $(( $(date +%s) - volta ))s)"
confere "todos os serviços reconectaram sozinhos" [ "$estado" = "S1=200 S2=200 S3=200 S4=200" ]
pausa

passo "Conferindo que nada foi perdido"
final="$(espera_fim_compra "$OPERACAO" 90)"
confere "a compra feita durante a queda terminou (COMPLETED)" [ "$final" = "COMPLETED" ]

# O evento CampaignCreated/MemberJoined saiu da outbox do S1 e chegou ao S2: ele aceita ficha nessa campanha.
for _ in $(seq 60); do
  api POST "$S2_URL/characters" "{\"campaignId\":\"$CAMPANHA_NOVA\",\"name\":\"Depois da queda\",\"hp\":{\"current\":5,\"max\":5}}"
  [ "$HTTP_CODE" = "201" ] && break
  sleep 1
done
confere "o evento da campanha criada durante a queda chegou ao S2" [ "$HTTP_CODE" = "201" ]

reconexoes_depois="$(curl -s "$S2_URL/internal/messaging" | json_num reconnects)"
info "reconexões registradas pelo S2: $reconexoes_antes → $reconexoes_depois"
confere "o S2 registrou a reconexão" [ "${reconexoes_depois:-0}" -gt "${reconexoes_antes:-0}" ]
api GET "$S2_URL/internal/outbox"
info "outbox do S2: $BODY"

resultado_final "R6"
