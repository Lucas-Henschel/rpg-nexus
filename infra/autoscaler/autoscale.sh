#!/bin/sh
# Autoescala de um consumidor conforme o tamanho da fila.
#
# A cada intervalo: lê quantas mensagens estão na fila (API de gerenciamento do RabbitMQ), calcula
# quantas réplicas seriam necessárias e ajusta o serviço com `docker compose up --scale`.
#
#   réplicas desejadas = teto(mensagens / AUTOSCALE_MESSAGES_PER_REPLICA), entre o mínimo e o máximo
#
# Sobe réplicas na hora; só reduz depois de AUTOSCALE_SCALE_DOWN_AFTER leituras seguidas abaixo do
# número atual, para não ficar criando e removendo contêineres quando a fila oscila.
set -eu

: "${RABBITMQ_API_URL:?RABBITMQ_API_URL must be set}"
: "${RABBITMQ_USER:?RABBITMQ_USER must be set}"
: "${RABBITMQ_PASSWORD:?RABBITMQ_PASSWORD must be set}"
: "${AUTOSCALE_QUEUE:?AUTOSCALE_QUEUE must be set}"
: "${AUTOSCALE_SERVICE:?AUTOSCALE_SERVICE must be set}"
MIN="${AUTOSCALE_MIN_REPLICAS:-1}"
MAX="${AUTOSCALE_MAX_REPLICAS:-4}"
PER_REPLICA="${AUTOSCALE_MESSAGES_PER_REPLICA:-100}"
INTERVAL="${AUTOSCALE_INTERVAL_SECONDS:-5}"
DOWN_AFTER="${AUTOSCALE_SCALE_DOWN_AFTER:-3}"
COMPOSE_FILE_PATH="${AUTOSCALE_COMPOSE_FILE:-/work/docker-compose.yml}"

log() {
  printf '%s autoscaler %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

# O projeto Compose é o mesmo deste contêiner; assim as réplicas entram na pilha que já está no ar.
PROJECT="${COMPOSE_PROJECT_NAME:-}"
if [ -z "$PROJECT" ]; then
  PROJECT=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$(hostname)")
fi
[ -n "$PROJECT" ] || { log "não foi possível descobrir o projeto Compose"; exit 1; }

compose() {
  docker compose --project-name "$PROJECT" --file "$COMPOSE_FILE_PATH" "$@"
}

# --no-recreate: as réplicas que já estão rodando nunca são recriadas, só se cria ou remove a diferença.
scale_to() {
  compose up --detach --no-deps --no-build --no-recreate --scale "$AUTOSCALE_SERVICE=$1" "$AUTOSCALE_SERVICE" \
    || log "falha ao escalar para $1"
}

AUTH=$(printf '%s:%s' "$RABBITMQ_USER" "$RABBITMQ_PASSWORD" | base64 | tr -d '\n')

# Total de mensagens da fila (prontas + em processamento). %2F é o vhost "/".
queue_depth() {
  wget -q -O - --header "Authorization: Basic $AUTH" "$RABBITMQ_API_URL/api/queues/%2F/$AUTOSCALE_QUEUE" \
    | grep -o '"messages":[0-9]*' | head -n 1 | cut -d: -f2
}

current_replicas() {
  compose ps --quiet --status running "$AUTOSCALE_SERVICE" | grep -c . || true
}

log "projeto=$PROJECT serviço=$AUTOSCALE_SERVICE fila=$AUTOSCALE_QUEUE min=$MIN max=$MAX mensagens_por_réplica=$PER_REPLICA"

below=0
while true; do
  if ! depth=$(queue_depth) || [ -z "$depth" ]; then
    log "não foi possível ler a fila; tentando de novo em ${INTERVAL}s"
    sleep "$INTERVAL"
    continue
  fi

  desired=$(( (depth + PER_REPLICA - 1) / PER_REPLICA ))
  [ "$desired" -lt "$MIN" ] && desired="$MIN"
  [ "$desired" -gt "$MAX" ] && desired="$MAX"
  current=$(current_replicas)

  if [ "$desired" -gt "$current" ]; then
    below=0
    log "mensagens=$depth réplicas=$current -> $desired (escalando para cima)"
    scale_to "$desired"
  elif [ "$desired" -lt "$current" ]; then
    below=$((below + 1))
    if [ "$below" -ge "$DOWN_AFTER" ]; then
      below=0
      log "mensagens=$depth réplicas=$current -> $desired (escalando para baixo)"
      scale_to "$desired"
    else
      log "mensagens=$depth réplicas=$current (redução para $desired em $((DOWN_AFTER - below)) leitura(s))"
    fi
  else
    below=0
    log "mensagens=$depth réplicas=$current (estável)"
  fi
  sleep "$INTERVAL"
done
