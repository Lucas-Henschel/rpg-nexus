#!/usr/bin/env bash
# R5 — Dependência instável simulada (cenários F1: compensação e F7: resposta tardia).
#
# A dependência instável da compra é o validador externo (contêiner identity-validator, do S4). Latência e
# taxa de falha vêm de variáveis de ambiente: VALIDATION_FAILURE_RATE, VALIDATION_MIN_DELAY_MS e
# VALIDATION_MAX_DELAY_MS. O script recria o contêiner com outros valores, sem mudar o .env nem o código.
#
#   Parte A (F1): falha em 100%  → a Saga compensa: estoque volta, mochila liberada, nada cobrado.
#   Parte B (F7): atraso maior que o prazo da Saga → a compra expira; a resposta que chega atrasada é
#                 registrada e ignorada, sem mudar o resultado.
#
#   bash scripts/requisitos/r5-dependencia-instavel.sh          (PAUSA=1 para parar entre as etapas)
#
# No fim (ou se o script for interrompido), o validador e o S3 voltam à configuração do .env.

source "$(dirname "$0")/lib.sh"

PRAZO_SAGA=10        # segundos (parte B); o padrão do projeto é 60
ATRASO_VALIDADOR=20000

restaurar() {
  echo
  passo "Restaurando o validador e o S3 com a configuração do .env"
  docker compose up --detach --no-deps --force-recreate --wait identity-validator inventory >"$TMP/restaurar.out" 2>&1 \
    || { tail -5 "$TMP/restaurar.out" | sed 's/^/      /'; aviso "confira com: docker compose ps"; }
  espera_http "$S3_URL/health" 90 || true
  ok "configuração normal de volta"
}
titulo "R5 — Dependência instável (F1: falha 100% e F7: resposta tardia)"
preparar_cenario
# Só a partir daqui o script mexe no validador e no S3; daqui em diante, sair sempre restaura os dois.
trap 'restaurar; rm -rf "$TMP"' EXIT
ITEM="$(criar_item "Amuleto" 5 30)"
saldo_inicial="$(saldo)"
info "item: $ITEM (5 unidades, 30 moedas) — saldo do personagem: $saldo_inicial"
pausa

# --- Parte A ---------------------------------------------------------------------------------------------
titulo "Parte A — F1: a dependência falha em 100% das vezes"

passo "Recriando o validador com VALIDATION_FAILURE_RATE=1"
cmd "VALIDATION_FAILURE_RATE=1 docker compose up --detach --no-deps --force-recreate identity-validator"
VALIDATION_FAILURE_RATE=1 dc up --detach --no-deps --force-recreate --wait identity-validator
ok "validador recusando todas as validações"
pausa

passo "Comprando o item"
inicio="$(agora_utc)"
comprar "$ITEM"
info "HTTP $HTTP_CODE — operação $OPERACAO"
final="$(espera_fim_compra "$OPERACAO" 60)"
confere "a Saga terminou compensada (COMPENSATED)" [ "$final" = "COMPENSATED" ]

passo "Conferindo que os passos anteriores foram desfeitos"
read -r disponivel reservado <<<"$(estoque "$ITEM")"
info "estoque: disponível=$disponivel reservado=$reservado"
confere "a unidade reservada voltou ao estoque" [ "$disponivel/$reservado" = "5/0" ]
# O S2 recebe o AcquisitionCancelled pelo RabbitMQ (a outbox do S3 publica a cada 2 s).
espera_reserva "$OPERACAO" RELEASED 30 || true
info "reserva na mochila (S2): $(status_reserva "$OPERACAO")"
confere "a reserva da mochila foi liberada (RELEASED)" [ "$(status_reserva "$OPERACAO")" = "RELEASED" ]
confere "nada foi cobrado do personagem" [ "$(saldo)" = "$saldo_inicial" ]
info "o validador respondeu:"
docker compose logs --no-log-prefix --since "$inicio" identity-validator 2>/dev/null \
  | grep -o '"routingKey":"external\.validation\.[a-z]*\.v1"' | sed 's/^/    /' || true
pausa

# --- Parte B ---------------------------------------------------------------------------------------------
titulo "Parte B — F7: a resposta chega depois do prazo"

passo "Prazo da Saga em ${PRAZO_SAGA}s e validador demorando $((ATRASO_VALIDADOR / 1000))s"
cmd "SAGA_TIMEOUT_SECONDS=$PRAZO_SAGA docker compose up --detach --no-deps --force-recreate inventory"
cmd "VALIDATION_MIN_DELAY_MS=$ATRASO_VALIDADOR VALIDATION_MAX_DELAY_MS=$ATRASO_VALIDADOR docker compose up --detach --no-deps --force-recreate identity-validator"
SAGA_TIMEOUT_SECONDS=$PRAZO_SAGA dc up --detach --no-deps --force-recreate inventory
VALIDATION_MIN_DELAY_MS=$ATRASO_VALIDADOR VALIDATION_MAX_DELAY_MS=$ATRASO_VALIDADOR \
  dc up --detach --no-deps --force-recreate --wait identity-validator
espera_http "$S3_URL/health" 90 || { falha "o S3 não voltou"; exit 1; }
sleep 3
ok "prazo curto e validador lento"
pausa

passo "Comprando o item"
comprar "$ITEM"
info "HTTP $HTTP_CODE — operação $OPERACAO"
final="$(espera_fim_compra "$OPERACAO" 60)"
confere "a compra expirou (EXPIRED) sem esperar a dependência" [ "$final" = "EXPIRED" ]

passo "Esperando a resposta atrasada do validador chegar (~$((ATRASO_VALIDADOR / 1000))s depois do pedido)"
inicio="$(agora_utc)"
for _ in $(seq 40); do
  docker compose logs --no-log-prefix --since "$inicio" identity-validator 2>/dev/null \
    | grep -q 'actions.validation.published' && break
  sleep 1
done
sleep 3
info "resposta tardia publicada pelo validador (ele vê que o prazo passou e responde falha, DEADLINE_EXPIRED):"
docker compose logs --no-log-prefix --since "$inicio" identity-validator 2>/dev/null \
  | grep -o '"routingKey":"external\.validation\.[a-z]*\.v1"' | sed 's/^/    /' || true

final="$(status_compra "$OPERACAO")"
confere "a resposta atrasada não mudou o resultado (continua EXPIRED)" [ "$final" = "EXPIRED" ]
read -r disponivel reservado <<<"$(estoque "$ITEM")"
info "estoque: disponível=$disponivel reservado=$reservado"
confere "a unidade voltou ao estoque" [ "$disponivel/$reservado" = "5/0" ]
espera_reserva "$OPERACAO" RELEASED 30 || true
confere "a reserva da mochila foi liberada (RELEASED)" [ "$(status_reserva "$OPERACAO")" = "RELEASED" ]
confere "nada foi cobrado do personagem" [ "$(saldo)" = "$saldo_inicial" ]

resultado_final "R5"
