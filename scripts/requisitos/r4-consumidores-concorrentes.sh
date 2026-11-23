#!/usr/bin/env bash
# R4 — Consumidores concorrentes (cenário F8: escala horizontal).
#
# Sobe 3 réplicas do characters-worker, que somadas ao characters (API, que também consome) são 4
# consumidores na MESMA fila. Publica 300 pedidos de validação distintos e mostra que a carga foi dividida
# entre as réplicas, cada pedido decidido uma única vez, e que a mochila nunca passou do limite.
#
#   bash scripts/requisitos/r4-consumidores-concorrentes.sh          (PAUSA=1 para parar entre as etapas)
#   MENSAGENS=300 REPLICAS=3 bash scripts/requisitos/r4-consumidores-concorrentes.sh
#
# Ordenação: com consumidores concorrentes, a ordem entre mensagens diferentes não é garantida. O S2 não
# depende dela: cada operação é independente, e mensagens fora de ordem (cancelamento antes do pedido)
# viram lápide. Débito e reembolso de uma mesma compra ficam na mesma fila, na ordem em que o S3 publicou.

source "$(dirname "$0")/lib.sh"

MENSAGENS="${MENSAGENS:-300}"
REPLICAS="${REPLICAS:-3}"
FILA=characters.validation-requested.v1

titulo "R4 — Consumidores concorrentes (F8: $REPLICAS réplicas, $MENSAGENS mensagens)"
MOCHILA=50 preparar_cenario
pausa

passo "Subindo $REPLICAS réplicas do characters-worker"
cmd "docker compose up --detach --no-recreate --scale characters-worker=$REPLICAS characters-worker"
dc up --detach --no-recreate --scale "characters-worker=$REPLICAS" characters-worker
for _ in $(seq 60); do
  rodando="$(docker compose ps --status running --quiet characters-worker | grep -c . || true)"
  [ "$rodando" = "$REPLICAS" ] && break
  sleep 1
done
info "réplicas rodando: $rodando"
confere "$REPLICAS réplicas no ar" [ "$rodando" = "$REPLICAS" ]
# Espera as réplicas novas se conectarem: REPLICAS workers + a API (characters), que também consome.
for _ in $(seq 30); do
  consumidores="$(curl -s -u "$RABBIT_USER:$RABBIT_PASS" "$RABBIT_API/queues/%2F/$FILA" | json_num consumers)"
  [ "${consumidores:-0}" -ge "$((REPLICAS + 1))" ] && break
  sleep 1
done
info "consumidores na fila $FILA: $consumidores (as $REPLICAS réplicas + o characters, que também consome)"
pausa

passo "Publicando $MENSAGENS pedidos de validação distintos"
inicio="$(agora_utc)"
cmd "docker compose exec characters python -m scripts.publish_event flood --character-id <id> --campaign-id <id> --count $MENSAGENS"
publicar flood --character-id "$PERSONAGEM" --campaign-id "$CAMPANHA" --count "$MENSAGENS" | sed 's/^/  /'
espera_logs_s2 "$inicio" "$MENSAGENS" 180 '"msg": "validation.decided"' "\"characterId\": \"$PERSONAGEM\"" \
  || aviso "nem todas as mensagens foram decididas em 3 minutos"
sleep 2   # margem para alguma decisão a mais, se houvesse
pausa

passo "Como a carga foi dividida"
decisoes="$(logs_s2 "$inicio" \
  | grep -F '"msg": "validation.decided"' | grep -F "\"characterId\": \"$PERSONAGEM\"" || true)"
total="$(printf '%s\n' "$decisoes" | grep -c . || true)"
echo "  mensagens por instância (hostname do contêiner):"
printf '%s\n' "$decisoes" | grep -o '"instance": "[^"]*"' | sort | uniq -c | sed 's/"instance": //; s/^/    /'
instancias="$(printf '%s\n' "$decisoes" | grep -o '"instance": "[^"]*"' | sort -u | grep -c . || true)"
echo "  resultado das decisões:"
printf '%s\n' "$decisoes" | grep -o '"outcome": "[^"]*"' | sort | uniq -c | sed 's/"outcome": //; s/^/    /'
operacoes_unicas="$(printf '%s\n' "$decisoes" | grep -o '"operationId": "[^"]*"' | sort -u | grep -c . || true)"

confere "todas as $MENSAGENS mensagens foram decididas" [ "$total" = "$MENSAGENS" ]
confere "cada operação foi decidida uma única vez (sem efeito duplicado)" [ "$operacoes_unicas" = "$total" ]
confere "a carga foi dividida entre mais de um consumidor" [ "$instancias" -gt 1 ]

api GET "$S2_URL/characters/$PERSONAGEM"
usados="$(json_num slotsUsed "$BODY")"; limite="$(json_num maxItems "$BODY")"
aprovadas="$(conta '"outcome": "APPROVED"' "$decisoes")"
info "mochila: $usados de $limite espaços; aprovações: $aprovadas"
confere "a mochila nunca passou do limite" [ "$usados" -le "$limite" ]
confere "o número de aprovações bate com os espaços usados" [ "$aprovadas" = "$usados" ]
pausa

passo "Voltando para 1 réplica"
cmd "docker compose up --detach --no-recreate --scale characters-worker=1 characters-worker"
dc up --detach --no-recreate --scale characters-worker=1 characters-worker
ok "characters-worker com 1 réplica"

resultado_final "R4"
