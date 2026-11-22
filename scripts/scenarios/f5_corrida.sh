#!/usr/bin/env bash
# F5 — Corrida pelo recurso: 100 pedidos de compra simultâneos para um item com 10 unidades.
# Esperado: exatamente 10 compras concluídas; as outras 90 recusadas na entrada (409, sem estoque) ou
# compensadas. O estoque termina em 0, nunca negativo, e o saldo cai exatamente 10 vezes o preço.
CENARIO="F5 Corrida pelo recurso"
source "$(dirname "$0")/lib.sh"

PEDIDOS=${PEDIDOS:-100}
UNIDADES=10
PRECO=5

titulo "$CENARIO"
passo "Preparando loja com $UNIDADES unidades e personagem com saldo e espaço de sobra"
cria_mundo $PRECO $UNIDADES 1000 200

passo "Provocando a falha: $PEDIDOS pedidos de compra ao mesmo tempo"
CORPO="{\"campaignId\":\"$CID\",\"characterId\":\"$CHID\",\"itemId\":\"$IID\"}"
for i in $(seq "$PEDIDOS"); do
  curl -sS -o "$TMPD/r$i" -w '%{http_code}' --max-time 30 -X POST "$S3/acquisitions" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: $(novo_uuid)" --data-binary "$CORPO" > "$TMPD/s$i" 2>/dev/null &
done
wait
ACEITOS=$(grep -lx 202 "$TMPD"/s* | wc -l | tr -d ' ')
SEM_ESTOQUE=$(grep -lx 409 "$TMPD"/s* | wc -l | tr -d ' ')
OUTROS=$((PEDIDOS - ACEITOS - SEM_ESTOQUE))
info "202 Accepted: $ACEITOS | 409 sem estoque: $SEM_ESTOQUE | outros: $OUTROS"

passo "Esperando as Sagas aceitas terminarem"
: > "$TMPD/finais"
for i in $(seq "$PEDIDOS"); do
  [ "$(cat "$TMPD/s$i")" = 202 ] || continue
  op=$(json 'd["operationId"]' < "$TMPD/r$i")
  espera_saga "$op" 90
  echo "$SAGA" >> "$TMPD/finais"
done
sort "$TMPD/finais" | uniq -c | sed 's/^ */  /'
CONCLUIDAS=$(grep -c '^COMPLETED$' "$TMPD/finais")

passo "Estado final"
sleep 2
mostra_estado
confere "compras concluídas" $UNIDADES "$CONCLUIDAS"
confere "recusadas (409) ou compensadas" $((PEDIDOS - UNIDADES)) $((SEM_ESTOQUE + $(grep -vc '^COMPLETED$' "$TMPD/finais")))
confere "respostas fora de 202/409" 0 "$OUTROS"
confere "estoque final" 0 "$(estoque)"
confere "inventário do personagem" $UNIDADES "$(inventario)"
confere "saldo (1000 - $UNIDADES x $PRECO)" $((1000 - UNIDADES * PRECO)) "$(saldo)"

resultado
