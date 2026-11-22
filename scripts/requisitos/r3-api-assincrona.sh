#!/usr/bin/env bash
# R3 — API assíncrona.
#
# A compra na loja (S3) não espera a Saga terminar: responde 202 Accepted na hora, com um operationId.
# O cliente consulta o andamento depois, em GET /acquisitions/{operationId}, até um estado final.
#
#   bash scripts/requisitos/r3-api-assincrona.sh          (PAUSA=1 para parar entre as etapas)

source "$(dirname "$0")/lib.sh"

titulo "R3 — API assíncrona (202 Accepted + consulta de status)"
preparar_cenario

passo "Criando um item na loja"
ITEM="$(criar_item "Espada curta" 5 10)"
info "item: $ITEM (5 unidades, 10 moedas)"
pausa

passo "Pedindo a compra"
cmd "curl -X POST $S3_URL/acquisitions -H 'Idempotency-Key: ...' -d '{campaignId, characterId, itemId}'"
comprar "$ITEM"
info "HTTP $HTTP_CODE em ${TEMPO}s (sem esperar a Saga): $BODY"
confere "a entrada respondeu 202 Accepted" [ "$HTTP_CODE" = "202" ]
confere "a resposta traz um operationId" [ -n "$OPERACAO" ]
confere "a resposta traz o endereço para consultar o status" [ -n "$(json_str statusUrl "$BODY")" ]
pausa

passo "Consultando o status até o fim (GET /acquisitions/$OPERACAO)"
final="$(espera_fim_compra "$OPERACAO" 60)"
confere "a compra terminou em COMPLETED" [ "$final" = "COMPLETED" ]
pausa

passo "Linha do tempo da operação no S3"
cmd "curl $S3_URL/acquisitions/$OPERACAO/history"
api GET "$S3_URL/acquisitions/$OPERACAO/history"
printf '%s' "$BODY" | grep -o '"status":"[A-Z_]*"' | sed 's/"status":"\(.*\)"/  → \1/' | uniq || info "$BODY"

resultado_final "R3"
