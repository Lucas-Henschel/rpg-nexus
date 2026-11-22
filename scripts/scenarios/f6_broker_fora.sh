#!/usr/bin/env bash
# F6 — Broker fora do ar: para o RabbitMQ por 30 segundos. Durante a queda, uma compra (S3) e uma
# campanha nova (S1) geram eventos que só podem ficar na outbox de cada serviço.
# Esperado: os serviços continuam no ar, reconectam sozinhos quando o broker volta (nenhum reinício),
# a outbox drena e nenhuma mensagem se perde: a compra conclui e a campanha nova chega aos outros.
CENARIO="F6 Broker fora do ar"
source "$(dirname "$0")/lib.sh"

QUEDA=${QUEDA_SEGUNDOS:-30}

restaura() {
  dc up -d --wait --no-recreate rabbitmq >/dev/null 2>&1 && info "RabbitMQ no ar"
}

titulo "$CENARIO"
passo "Preparando campanha, loja e personagem"
cria_mundo 30 5 100 10
FOTO="$TMPD/dlqs"; foto_dlqs "$FOTO"
foto_conteineres | grep -v rabbitmq > "$TMPD/conteineres-antes"

passo "Provocando a falha: docker compose stop rabbitmq (por ${QUEDA} s)"
dc stop rabbitmq >/dev/null 2>&1 || aborta "não consegui parar o RabbitMQ"
INICIO=$SECONDS
info "RabbitMQ parado"

passo "Com o broker fora, os serviços continuam respondendo"
for nome in S1 S2 S3 S4; do
  url="${!nome}/health"
  info "$nome /health: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url")"
done
compra
info "compra no S3: $STATUS (operationId ${OPID:-nenhum})"
confere "o S3 aceita a compra mesmo sem broker" 202 "$STATUS"
http POST "$S1/campaigns" '{"name":"Criada com o broker fora"}'
CID2=$(printf '%s' "$BODY" | json 'd["campaignId"]')
info "campanha nova no S1: $STATUS ($CID2)"
confere "o S1 cria a campanha mesmo sem broker" 201 "$STATUS"
SAGA=$(saga_status "$OPID")
info "Saga parada em $SAGA: o pedido de validação está na outbox do S3"

restante=$((QUEDA - (SECONDS - INICIO)))
[ $restante -gt 0 ] && { info "esperando mais ${restante} s com o broker fora..."; sleep $restante; }

passo "Religando o RabbitMQ (docker compose start rabbitmq)"
dc start rabbitmq >/dev/null 2>&1
dc up -d --wait --no-recreate rabbitmq >/dev/null 2>&1 || aborta "o RabbitMQ não voltou"
info "RabbitMQ de volta depois de $((SECONDS - INICIO)) s"

passo "A compra feita durante a queda continua sozinha"
espera_saga "$OPID" 90
historico_saga "$OPID"

passo "A campanha criada durante a queda chega ao S4 e ao S3 (outbox do S1 drenada)"
S4_OK=nao
for i in $(seq 60); do
  http GET "$S4/campaigns/$CID2/history"
  [ "$(printf '%s' "$BODY" | json "any(e.get('type') == 'CAMPAIGN_CREATED' for e in d['items'])")" = true ] && { S4_OK=sim; break; }
  sleep 1
done
http PUT "$S3/shops/$CID2" '{"name":"Loja","active":true}'
S3_CODIGO=$STATUS

passo "Consumidores religados em cada fila"
SEM_CONSUMIDOR=$(rabbitmqctl list_queues name consumers | awk '$1 !~ /\.(retry|dlq)$/ { print "  " $1 ": " $2 " consumidor(es)" > "/dev/stderr"; if ($2 == 0) n++ } END { print n + 0 }')

passo "Estado final"
sleep 2
mostra_estado
confere "estado da Saga" COMPLETED "$SAGA"
confere "saldo" 70 "$(saldo)"
confere "inventário" 1 "$(inventario)"
confere "CAMPAIGN_CREATED no histórico do S4" sim "$S4_OK"
confere "o S3 conhece a campanha nova (PUT /shops)" 200 "$S3_CODIGO"
confere "filas sem consumidor" 0 "$SEM_CONSUMIDOR"
foto_conteineres | grep -v rabbitmq > "$TMPD/conteineres-depois"
confere "contêineres reiniciados (nenhum reinício manual nem automático)" 0 \
  "$(diff "$TMPD/conteineres-antes" "$TMPD/conteineres-depois" | grep -c '^>')"
dlqs_novas "$FOTO"
confere "mensagens novas em DLQ" 0 "$DLQ_NOVAS"

resultado
