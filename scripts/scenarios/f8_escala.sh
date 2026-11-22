#!/usr/bin/env bash
# F8 — Escala horizontal: sobe 3 réplicas de characters-worker (consumidor do S2) e faz 30 compras.
# Esperado: as mensagens se dividem entre as réplicas (a API do S2 também consome) e cada compra
# tem efeito uma vez só: 30 débitos, 30 itens e o saldo exato.
CENARIO="F8 Escala horizontal"
source "$(dirname "$0")/lib.sh"

REPLICAS=3
COMPRAS=${COMPRAS:-30}
PRECO=5

restaura() {
  dc up -d --wait --scale characters-worker=1 characters-worker >/dev/null 2>&1 &&
    info "characters-worker de volta a 1 réplica"
}

titulo "$CENARIO"
passo "Preparando loja com $COMPRAS unidades e personagem com saldo 1000"
cria_mundo $PRECO "$COMPRAS" 1000 200

passo "Subindo $REPLICAS réplicas de characters-worker"
# Um atraso pequeno por mensagem deixa a divisão da carga mais visível.
CONSUMER_SIMULATED_DELAY_MS=${ATRASO_MS:-200} dc up -d --wait --scale characters-worker=$REPLICAS characters-worker \
  >/dev/null 2>&1 || aborta "não consegui escalar o characters-worker"
dc ps --format '{{.Name}}  {{.ID}}' characters characters-worker | sed 's/^/  /'
info "consumidores na fila characters.money-commands.v1: $(fila_consumidores characters.money-commands.v1)"
T0=$(agora_utc)

passo "Fazendo $COMPRAS compras"
: > "$TMPD/ops"
for i in $(seq "$COMPRAS"); do
  compra
  [ -n "$OPID" ] && echo "$OPID" >> "$TMPD/ops"
done
info "$(wc -l < "$TMPD/ops" | tr -d ' ') compras aceitas (202)"
: > "$TMPD/finais"
while read -r op; do
  espera_saga "$op" 90
  echo "$SAGA" >> "$TMPD/finais"
done < "$TMPD/ops"
sort "$TMPD/finais" | uniq -c | sed 's/^ */  /'

passo "Mensagens processadas por réplica do S2 (logs, desde o início das compras)"
dc logs --no-color --since "$T0" characters characters-worker 2>/dev/null | grep -F '"message.processed"' |
  awk '{ print $1 }' | sort | uniq -c | sed 's/^ */  /' | tee "$TMPD/por-replica"
COM_CARGA=$(grep -c 'characters-worker' "$TMPD/por-replica")

passo "Estado final"
sleep 2
info "Saga: $(sort -u "$TMPD/finais" | tr '\n' ' ') | estoque: $(estoque) | saldo: $(saldo) | inventário: $(inventario)"
confere "compras concluídas" "$COMPRAS" "$(grep -c '^COMPLETED$' "$TMPD/finais")"
confere "réplicas de characters-worker que processaram mensagens" $REPLICAS "$COM_CARGA"
http GET "$S2/characters/$CHID/money/transactions"
confere "débitos no S2 (um por compra)" "$COMPRAS" "$(printf '%s' "$BODY" | json 'sum(1 for m in d["items"] if m.get("status") == "DEBITED")')"
confere "saldo (1000 - $COMPRAS x $PRECO)" $((1000 - COMPRAS * PRECO)) "$(saldo)"
confere "inventário" "$COMPRAS" "$(inventario)"
confere "estoque" 0 "$(estoque)"

resultado
