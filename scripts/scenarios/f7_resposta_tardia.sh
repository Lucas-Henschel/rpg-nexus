#!/usr/bin/env bash
# F7 — Resposta tardia: o validador externo responde em 15 s, mas a Saga só espera 10 s
# (SAGA_TIMEOUT_SECONDS=10 no S3, só durante o cenário; o padrão é 60 s).
# Esperado: a Saga expira e devolve estoque e reserva; quando a resposta atrasada chega, ela é
# ignorada: nada é debitado e a compra continua EXPIRED. (O validador vê o deadlineAt do pedido e,
# se já passou, responde failed com motivo DEADLINE_EXPIRED; se respondesse succeeded, o S3 também
# ignoraria.)
CENARIO="F7 Resposta tardia"
source "$(dirname "$0")/lib.sh"

TIMEOUT=10
ATRASO_MS=15000

restaura() {
  dc up -d --wait inventory identity-validator >/dev/null 2>&1 &&
    info "S3 com o prazo normal da Saga e validador sem atraso"
}

titulo "$CENARIO"
passo "Preparando campanha, loja (estoque 5) e personagem (saldo 100)"
cria_mundo 30 5 100 10
FOTO="$TMPD/dlqs"; foto_dlqs "$FOTO"

passo "Provocando a falha: validador com ${ATRASO_MS} ms de atraso e Saga com prazo de ${TIMEOUT} s"
SAGA_TIMEOUT_SECONDS=$TIMEOUT VALIDATION_MIN_DELAY_MS=$ATRASO_MS VALIDATION_MAX_DELAY_MS=$ATRASO_MS \
  dc up -d --wait inventory identity-validator >/dev/null 2>&1 || aborta "não consegui recriar o S3 e o validador"
info "inventory e identity-validator recriados"

passo "Comprando"
compra
for i in $(seq 60); do # o S3 acabou de subir: a primeira compra pode demorar
  [ "$STATUS" = 202 ] && break
  sleep 1
  compra
done
confere "resposta do POST /acquisitions" 202 "$STATUS"
info "operationId: $OPID"
espera_saga "$OPID" 40
info "Saga: $SAGA. Estoque: $(estoque) | reserva no S2: $(reservas)"

passo "Esperando a resposta atrasada do validador"
RESPOSTA=""
fim=$((SECONDS + 40))
while [ $SECONDS -lt $fim ]; do
  RESPOSTA=$(resposta_validador "$OPID")
  [ "$RESPOSTA" != nenhuma ] && break
  sleep 2
done
info "resposta na outbox do validador (S4): $RESPOSTA"
sleep 5 # tempo para o S3 receber e ignorar a resposta
info "linha do tempo da Saga (S3):"
historico_saga "$OPID"

passo "Estado final"
SAGA=$(saga_status "$OPID")
mostra_estado
confere "estado da Saga" EXPIRED "$SAGA"
confere_que "o validador respondeu depois do prazo" "$RESPOSTA" test "$RESPOSTA" != nenhuma
confere "estoque devolvido" 5 "$(estoque)"
confere "saldo intacto" 100 "$(saldo)"
confere "nenhum movimento de dinheiro" nenhum "$(movimentos)"
confere "inventário" 0 "$(inventario)"
confere "reserva no S2" RELEASED "$(reservas)"
dlqs_novas "$FOTO"
confere "mensagens novas em DLQ" 0 "$DLQ_NOVAS"

resultado
