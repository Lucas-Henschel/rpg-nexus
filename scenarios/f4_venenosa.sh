#!/usr/bin/env bash
# F4 — Mensagem venenosa: publica um payload inválido na fila de validação do S2
# (characters.validation-requested.v1) e, logo depois, faz uma compra que passa pela mesma fila.
# Esperado: a inválida é tentada MAX_RETRIES vezes com espera crescente (fila .retry) e vai para a
# .dlq; a compra segue normalmente.
CENARIO="F4 Mensagem venenosa"
source "$(dirname "$0")/lib.sh"

FILA=characters.validation-requested.v1
DLQ=$FILA.dlq

titulo "$CENARIO"
passo "Preparando campanha, loja e personagem"
cria_mundo 30 5 100 10
DLQ0=$(fila_msgs "$DLQ")
T0=$(agora_utc)

passo "Provocando a falha: publicando um payload inválido direto na fila $FILA"
MID=$(novo_uuid)
info "messageId: $MID"
info "$(publica "" "$FILA" '{"type":"rpg.character.validation.requested.v1","payload":"isto não é um pedido de validação"}' "$MID")"

passo "Enquanto isso, uma compra normal usa a mesma fila"
compra
confere "resposta do POST /acquisitions" 202 "$STATUS"
espera_saga "$OPID" 60
confere "a compra seguiu normalmente" COMPLETED "$SAGA"

passo "Esperando a mensagem inválida esgotar as tentativas"
fim=$((SECONDS + 60))
while [ $SECONDS -lt $fim ] && [ "$(fila_msgs "$DLQ")" -le "$DLQ0" ]; do sleep 1; done

info "logs do S2 para a mensagem inválida:"
dc logs --no-color --no-log-prefix --since "$T0" characters characters-worker 2>/dev/null | grep -F "$MID" |
  "${PY[@]}" -c '
import json, sys
for linha in sys.stdin:
    try:
        e = json.loads(linha)
    except ValueError:
        continue
    extra = " ".join("%s=%s" % (k, e[k]) for k in ("attempt", "maxRetries", "delayMs", "dlq") if k in e)
    print("  %s  %s  %s  %s" % (e.get("ts", "")[11:23], e.get("instance", ""), e.get("msg"), extra))
' | sort

passo "A mensagem na DLQ (lida sem remover)"
curl -sS -u "$MQ_AUTH" -H 'Content-Type: application/json' -X POST "$MQ/api/queues/%2F/$DLQ/get" \
  --data-binary '{"count":1000,"ackmode":"ack_requeue_true","encoding":"auto"}' > "$TMPD/dlq.json"
NA_DLQ=$("${PY[@]}" -c '
import json, sys
msgs = [m for m in json.load(sys.stdin) if m["properties"].get("message_id") == sys.argv[1]]
if msgs:
    h = msgs[0]["properties"].get("headers", {})
    print("x-retry-count=%s | x-last-error=%s" % (h.get("x-retry-count"), str(h.get("x-last-error"))[:90]))
' "$MID" < "$TMPD/dlq.json")
info "${NA_DLQ:-não encontrada}"

passo "Estado final"
confere "mensagem inválida na DLQ" "x-retry-count=${MAX_RETRIES:-3}" "${NA_DLQ%% |*}"
confere "DLQ $DLQ ganhou uma mensagem" $((DLQ0 + 1)) "$(fila_msgs "$DLQ")"
confere "fila principal vazia" 0 "$(fila_msgs "$FILA")"
confere "saldo depois da compra" 70 "$(saldo)"
confere "inventário" 1 "$(inventario)"

resultado
