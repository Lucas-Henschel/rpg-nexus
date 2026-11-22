#!/usr/bin/env bash
# F3 — Mensagem duplicada: republica 5 vezes o ItemAcquired real de uma compra, com o mesmo messageId.
# Esperado: um único efeito. Os três consumidores do evento (S1, S2 e S4) reconhecem a repetição pela
# inbox e não mudam nada: contador, atividade, histórico, reserva e saldo ficam iguais.
CENARIO="F3 Mensagem duplicada"
source "$(dirname "$0")/lib.sh"

# Contagens que a repetição não pode mudar.
fotografa() {
  http GET "$S1/campaigns/$CID"
  S1_ITENS=$(printf '%s' "$BODY" | json "next(m.get('itemsAcquired') for m in d['members'] if m.get('characterId') == '$CHID')")
  S1_ATIV=$(printf '%s' "$BODY" | json "sum(1 for a in d['recentActivity'] if a.get('operationId') == '$OPID')")
  http GET "$S4/campaigns/$CID/history"
  S4_HIST=$(printf '%s' "$BODY" | json "sum(1 for e in d['items'] if e.get('operationId') == '$OPID' and e.get('type') == 'ITEM_ACQUIRED')")
  S2_DIN=$(movimentos)
  S2_RES=$(reservas)
  S3_INV=$(inventario)
}

titulo "$CENARIO"
passo "Fazendo uma compra normal"
cria_mundo 30 5 100 10
compra
espera_saga "$OPID" 60
confere "estado da Saga" COMPLETED "$SAGA"
sleep 3 # deixa os consumidores do ItemAcquired terminarem
fotografa
info "antes: S1 itens=$S1_ITENS atividade=$S1_ATIV | S4 histórico=$S4_HIST | S2 dinheiro=$S2_DIN reserva=$S2_RES | S3 inventário=$S3_INV"

passo "Lendo o ItemAcquired original na outbox do S3 (tabela inventory_inventory_outbox)"
EVENTO=$(evento_s3 "$OPID" rpg.item.acquired.v1)
[ -n "$EVENTO" ] || aborta "não achei o ItemAcquired da compra na outbox do S3"
MID=$(printf '%s' "$EVENTO" | json 'd["messageId"]')
info "messageId: $MID"

passo "Provocando a falha: publicando a mesma mensagem 5 vezes em rpg.events (item.acquired.v1)"
FOTO="$TMPD/dlqs"; foto_dlqs "$FOTO"
T0=$(agora_utc)
for i in 1 2 3 4 5; do
  info "envio $i: $(publica rpg.events item.acquired.v1 "$EVENTO" "$MID")"
done
sleep 5

passo "O que cada consumidor fez com as 5 cópias (logs)"
for servico in "S1:campaigns campaigns-worker" "S2:characters characters-worker" "S4:identity"; do
  nome=${servico%%:*}
  # shellcheck disable=SC2086
  resumo=$(dc logs --no-color --no-log-prefix --since "$T0" ${servico#*:} 2>/dev/null | grep -F "$MID" |
    grep -oE '"(result|outcome)": *"[A-Za-z_-]+"' | tr -d ' "' | sort | uniq -c | tr -s ' ' | tr '\n' ' ')
  info "$nome: ${resumo:-nenhuma linha com o messageId}"
done

passo "Estado depois das repetições"
ANTES="$S1_ITENS $S1_ATIV $S4_HIST $S2_DIN $S2_RES $S3_INV"
fotografa
confere "S1: itens adquiridos do participante" 1 "$S1_ITENS"
confere "S1: atividades da compra" 1 "$S1_ATIV"
confere "S4: entradas ITEM_ACQUIRED no histórico" 1 "$S4_HIST"
confere "S2: dinheiro (um débito só)" "PURCHASE:30:DEBITED" "$S2_DIN"
confere "S3: inventário" 1 "$S3_INV"
confere "nada mudou desde antes das repetições" "$ANTES" "$S1_ITENS $S1_ATIV $S4_HIST $S2_DIN $S2_RES $S3_INV"
dlqs_novas "$FOTO"
confere "mensagens novas em DLQ" 0 "$DLQ_NOVAS"

resultado
