#!/usr/bin/env bash
# F1 — Compensação: o validador externo (dependência instável do S4) falha em 100% das chamadas.
# Esperado: a Saga desfaz os passos anteriores (estoque e reserva liberados), nada é debitado e o
# cliente vê a compra como COMPENSATED.
CENARIO="F1 Compensação"
source "$(dirname "$0")/lib.sh"

restaura() {
  dc up -d --wait identity-validator >/dev/null 2>&1 && info "identity-validator de volta à taxa de falha normal"
}

titulo "$CENARIO"
passo "Preparando campanha, loja (estoque 5) e personagem (saldo 100)"
cria_mundo 30 5 100 10
FOTO="$TMPD/dlqs"; foto_dlqs "$FOTO"

passo "Provocando a falha: VALIDATION_FAILURE_RATE=1 no identity-validator"
VALIDATION_FAILURE_RATE=1 dc up -d --wait identity-validator >/dev/null 2>&1 || aborta "não consegui recriar o identity-validator"
info "validador recriado com taxa de falha 100%"

passo "Comprando a Espada de Cinzas"
compra
confere "resposta do POST /acquisitions" 202 "$STATUS"
info "operationId: $OPID"
espera_saga "$OPID" 60
info "linha do tempo da Saga (S3):"
historico_saga "$OPID"

passo "Resposta do validador, na outbox dele (tabela action_validation_outbox do S4)"
info "$(resposta_validador "$OPID")"

passo "Estado final"
sleep 2 # o S2 libera a reserva ao receber o acquisition.cancelled
mostra_estado
confere "estado da Saga" COMPENSATED "$SAGA"
confere "estoque devolvido" 5 "$(estoque)"
confere "saldo intacto" 100 "$(saldo)"
confere "inventário do personagem" 0 "$(inventario)"
confere "reserva no S2" RELEASED "$(reservas)"
dlqs_novas "$FOTO"
confere "mensagens novas em DLQ" 0 "$DLQ_NOVAS"

resultado
