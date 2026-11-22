#!/usr/bin/env bash
# F2 — Serviço morre no meio: `docker kill` na réplica do S2 que está processando o débito da compra.
# Os consumidores do S2 recebem um atraso de 8 s por mensagem (CONSUMER_SIMULATED_DELAY_MS) só para
# dar tempo de matar no meio do processamento.
# Esperado: a mensagem sem ACK volta para a fila, outra réplica a processa e o débito acontece uma
# única vez; a compra termina COMPLETED.
CENARIO="F2 Serviço morre no meio"
source "$(dirname "$0")/lib.sh"

FILA=characters.money-commands.v1
ATRASO_MS=8000

restaura() {
  dc up -d --wait characters characters-worker >/dev/null 2>&1 && info "S2 sem atraso e com as réplicas no ar"
}

# Contêiner do S2 com mensagem sem ACK. O nome do canal no RabbitMQ começa pelo IP de quem conectou
# ("172.23.0.10:53690 -> ..."); o IP leva ao contêiner.
replica_com_mensagem() {
  local ip id
  for ip in $(rabbitmqctl list_channels messages_unacknowledged name | awk '$1 > 0 { split($2, a, ":"); print a[1] }'); do
    for id in $(dc ps -q characters characters-worker); do
      if docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$id" | grep -qw "$ip"; then
        echo "${id:0:12}"
        return
      fi
    done
  done
}

titulo "$CENARIO"
passo "Preparando campanha, loja e personagem (saldo 100)"
cria_mundo 30 5 100 10

passo "Deixando os consumidores do S2 lentos (${ATRASO_MS} ms por mensagem)"
CONSUMER_SIMULATED_DELAY_MS=$ATRASO_MS dc up -d --wait characters characters-worker >/dev/null 2>&1 ||
  aborta "não consegui recriar o S2"
dc ps --format '{{.Name}}  {{.ID}}' characters characters-worker | sed 's/^/  /'
T0=$(agora_utc)

passo "Comprando e esperando o débito chegar a uma réplica do S2"
compra
confere "resposta do POST /acquisitions" 202 "$STATUS"
info "operationId: $OPID"
ALVO=""
fim=$((SECONDS + 45))
while [ $SECONDS -lt $fim ]; do
  if [ "$(rabbitmqctl list_queues name messages_unacknowledged | awk -v q="$FILA" '$1 == q { print $2 }')" -gt 0 ] 2>/dev/null; then
    ALVO=$(replica_com_mensagem)
    [ -n "$ALVO" ] && break
  fi
  sleep 0.5
done
[ -n "$ALVO" ] || aborta "o débito não chegou ao S2 a tempo"
info "a réplica $ALVO está com o débito em mãos (sem ACK)"

passo "Provocando a falha: docker kill $ALVO"
docker kill "$ALVO" >/dev/null && info "réplica $ALVO morta no meio do processamento"

passo "Esperando a Saga"
espera_saga "$OPID" 60
info "linha do tempo da Saga (S3):"
historico_saga "$OPID"
# Se a réplica morta era a da API (porta do S2), religa para as consultas abaixo.
dc up -d --wait --no-recreate characters characters-worker >/dev/null 2>&1

passo "Quem processou o débito (logs do S2, fila $FILA)"
dc logs --no-color --no-log-prefix --since "$T0" characters characters-worker 2>/dev/null | grep -F "$OPID" |
  grep -F "$FILA" | "${PY[@]}" -c '
import json, sys
for linha in sys.stdin:
    try:
        e = json.loads(linha)
    except ValueError:
        continue
    if e.get("msg") == "message.processed":
        print("  %s  réplica %s  %s  redelivered=%s" % (e.get("ts", "")[11:23], e.get("instance"), e.get("outcome"), e.get("redelivered")))
' | sort

passo "Estado final"
mostra_estado
confere "estado da Saga" COMPLETED "$SAGA"
confere "dinheiro (um débito só)" "PURCHASE:30:DEBITED" "$(movimentos)"
confere "saldo" 70 "$(saldo)"
confere "inventário" 1 "$(inventario)"
confere "estoque" 4 "$(estoque)"

resultado
