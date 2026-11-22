#!/usr/bin/env bash
# R2 — Controle de concorrência (cenário F5: corrida pelo recurso).
#
# Cria na loja um item com 10 unidades e dispara 100 compras AO MESMO TEMPO. A reserva de estoque no S3 é
# uma escrita condicional no DynamoDB (available >= 1), então exatamente 10 compras são aceitas e as
# outras 90 são recusadas, sem venda dupla e sem estoque negativo.
#
#   bash scripts/requisitos/r2-concorrencia.sh          (PAUSA=1 para parar entre as etapas)
#   COMPRAS=100 UNIDADES=10 bash scripts/requisitos/r2-concorrencia.sh

source "$(dirname "$0")/lib.sh"

COMPRAS="${COMPRAS:-100}"
UNIDADES="${UNIDADES:-10}"
PRECO=1

titulo "R2 — Controle de concorrência (F5: $COMPRAS compras para $UNIDADES unidades)"
MOCHILA=1000 DINHEIRO=100000 preparar_cenario
saldo_inicial="$(saldo)"

passo "Criando um item com $UNIDADES unidades na loja"
ITEM="$(criar_item "Pocao rara" "$UNIDADES" "$PRECO")"
info "item: $ITEM — estoque: $(estoque "$ITEM" | cut -d' ' -f1)"
pausa

passo "Disparando $COMPRAS compras simultâneas"
inicio_s=$(date +%s)
for i in $(seq "$COMPRAS"); do
  curl -s -w "$MARCA%{http_code} %{time_total}" -X POST "$S3_URL/acquisitions" \
    -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: corrida-$ITEM-$i" \
    --data "{\"campaignId\":\"$CAMPANHA\",\"characterId\":\"$PERSONAGEM\",\"itemId\":\"$ITEM\"}" \
    > "$TMP/compra-$i.txt" &   # corpo só com ids (sem acentos): pode ir na linha de comando
done
wait
info "as $COMPRAS requisições terminaram em $(( $(date +%s) - inicio_s )) s"

aceitas=0; recusadas=0; outras=0
operacoes=()
for i in $(seq "$COMPRAS"); do
  separa_resposta "$(cat "$TMP/compra-$i.txt")"
  case "$HTTP_CODE" in
    202) aceitas=$((aceitas + 1)); operacoes+=("$(json_str operationId "$BODY")") ;;
    409) recusadas=$((recusadas + 1)) ;;
    *)   outras=$((outras + 1)); info "resposta inesperada: $HTTP_CODE $BODY" ;;
  esac
done
info "202 Accepted: $aceitas    409 sem estoque: $recusadas    outras: $outras"
confere "exatamente $UNIDADES compras aceitas" [ "$aceitas" = "$UNIDADES" ]
confere "as outras $((COMPRAS - UNIDADES)) recusadas por falta de estoque" [ "$recusadas" = "$((COMPRAS - UNIDADES))" ]
pausa

passo "Acompanhando as $aceitas compras aceitas até o fim da Saga"
concluidas=0; finais=""
for _ in $(seq 180); do
  concluidas=0; finais=""
  for op in "${operacoes[@]}"; do
    st="$(status_compra "$op")"
    finais="$finais $st"
    case "$st" in COMPLETED|COMPENSATED|REJECTED|EXPIRED) concluidas=$((concluidas + 1)) ;; esac
  done
  [ "$concluidas" = "${#operacoes[@]}" ] && break
  sleep 0.5
done
completas="$(conta COMPLETED "$finais")"
info "estados finais:$(printf '%s\n' $finais | sort | uniq -c | awk '{printf " %s=%s", $2, $1}')"
confere "as $UNIDADES compras aceitas terminaram em COMPLETED" [ "$completas" = "$UNIDADES" ]
pausa

passo "Conferindo os bancos"
read -r disponivel reservado <<<"$(estoque "$ITEM")"
info "estoque do item: disponível=$disponivel reservado=$reservado"
confere "estoque zerado, sem ficar negativo" [ "$disponivel" = "0" ]
confere "nenhuma reserva pendente" [ "$reservado" = "0" ]

api GET "$S3_URL/inventory/$PERSONAGEM"
entregues="$(conta "\"itemId\":\"$ITEM\"" "$BODY")"
info "itens entregues ao personagem: $entregues"
confere "o personagem recebeu exatamente $UNIDADES unidades" [ "$entregues" = "$UNIDADES" ]

saldo_final="$(saldo)"
info "saldo: $saldo_inicial → $saldo_final moedas"
confere "foram cobradas exatamente $UNIDADES compras" [ "$((saldo_inicial - saldo_final))" = "$((UNIDADES * PRECO))" ]

resultado_final "R2"
