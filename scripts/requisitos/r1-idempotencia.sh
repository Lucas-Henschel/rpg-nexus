#!/usr/bin/env bash
# R1 — Entrega at-least-once com idempotência (cenário F3: mensagem duplicada).
#
# Publica no RabbitMQ a MESMA mensagem (mesmo messageId) 5 vezes: um pedido de validação de personagem
# para o S2. O S2 grava o messageId na inbox na mesma transação do efeito (a reserva na mochila), então
# só a primeira entrega tem efeito; as outras 4 são reconhecidas como duplicadas.
#
#   bash scripts/requisitos/r1-idempotencia.sh          (PAUSA=1 para parar entre as etapas)

source "$(dirname "$0")/lib.sh"

titulo "R1 — At-least-once com idempotência (F3: mesma mensagem 5 vezes)"
MOCHILA=10 preparar_cenario
pausa

passo "Publicando a MESMA mensagem 5 vezes (mesmo messageId)"
inicio="$(agora_utc)"
cmd "docker compose exec characters python -m scripts.publish_event validation --character-id $PERSONAGEM --campaign-id $CAMPANHA --times 5"
saida="$(publicar validation --character-id "$PERSONAGEM" --campaign-id "$CAMPANHA" --times 5)"
info "$saida"
mensagem="$(json_str messageId "$saida")"
operacao="$(json_str operationId "$saida")"
pausa

passo "Esperando o S2 processar as 5 entregas"
espera_logs_s2 "$inicio" 5 60 "\"messageId\": \"$mensagem\"" '"msg": "message.processed"' \
  || aviso "nem todas as 5 entregas apareceram nos logs em 60 s"
sleep 2   # margem para alguma entrega a mais, se houvesse

logs="$(logs_s2 "$inicio" | grep -F "\"messageId\": \"$mensagem\"" | grep -F '"msg": "message.processed"' || true)"
recebidas="$(printf '%s\n' "$logs" | grep -c . || true)"
aprovadas="$(conta '"outcome": "APPROVED"' "$logs")"
duplicadas="$(conta '"outcome": "DUPLICATE"' "$logs")"
info "entregas processadas: $recebidas (APPROVED: $aprovadas, DUPLICATE: $duplicadas)"
confere "as 5 entregas chegaram ao S2" [ "$recebidas" = "5" ]
confere "só a primeira teve efeito (1 APPROVED)" [ "$aprovadas" = "1" ]
confere "as outras 4 foram reconhecidas como duplicadas" [ "$duplicadas" = "4" ]
pausa

passo "Conferindo o estado no banco do S2"
cmd "curl $S2_URL/internal/inbox/$mensagem"
api GET "$S2_URL/internal/inbox/$mensagem"
info "$BODY"
confere "o messageId está registrado na inbox" [ "$HTTP_CODE" = "200" ]

api GET "$S2_URL/characters/$PERSONAGEM/holds"
reservas="$(conta "\"operationId\":\"$operacao\"" "$BODY")"
info "reservas na mochila para a operação $operacao: $reservas"
confere "uma única reserva na mochila (efeito aplicado uma vez)" [ "$reservas" = "1" ]

api GET "$S2_URL/characters/$PERSONAGEM"
info "mochila: $(json_num slotsUsed "$BODY") de $(json_num maxItems "$BODY") espaços usados"
confere "a mochila tem 1 espaço usado, e não 5" [ "$(json_num slotsUsed "$BODY")" = "1" ]

resultado_final "R1"
