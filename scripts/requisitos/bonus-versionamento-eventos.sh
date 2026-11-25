#!/usr/bin/env bash
# R7 — demonstra v1 e v2 de CharacterValidationRequested no RabbitMQ.
# Deixa as duas mensagens na fila para inspeção visual, depois libera os consumidores e
# acompanha as duas Sagas até o estado final. O log fica em logs/.

source "$(dirname "$0")/lib.sh"

mkdir -p "$RAIZ/logs"
LOG="$RAIZ/logs/versionamento-eventos-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

INITIAL_VERSION="$(docker compose exec -T inventory printenv VALIDATION_EVENT_VERSION 2>/dev/null | tr -d '\r' || true)"
[ -n "$INITIAL_VERSION" ] || INITIAL_VERSION=0
WORKER_WAS_RUNNING=0
if docker compose ps --services --status running 2>/dev/null | grep -qx characters-worker; then
  WORKER_WAS_RUNNING=1
fi
CONSUMERS_STOPPED=0

restore() {
  local code=$?
  trap - EXIT INT TERM
  if [ "$CONSUMERS_STOPPED" = 1 ]; then
    docker compose start characters >/dev/null 2>&1 || true
    if [ "$WORKER_WAS_RUNNING" = 1 ]; then docker compose start characters-worker >/dev/null 2>&1 || true; fi
  fi
  VALIDATION_EVENT_VERSION="$INITIAL_VERSION" docker compose up -d --force-recreate inventory >/dev/null 2>&1 || true
  rm -rf "$TMP"
  exit "$code"
}
trap restore EXIT
trap 'exit 130' INT TERM

titulo "R7 — versionamento de eventos (v1 + v2)"
info "Log: $LOG"
info "RabbitMQ: http://localhost:${RABBITMQ_MANAGEMENT_PORT:-15672} (usuário/senha do .env)"

preparar_cenario

QUEUE="characters.validation-requested.v1"
passo "Verificando a fila RabbitMQ antes da demonstração"
fila_json="$(curl -fsS -u "$RABBIT_USER:$RABBIT_PASS" "$RABBIT_API/queues/%2F/$QUEUE")" || {
  falha "não foi possível consultar a fila $QUEUE no RabbitMQ Management API"
  exit 1
}
baseline="$(json_num messages_ready "$fila_json")"
[ "${baseline:-0}" = 0 ] || {
  falha "a fila já contém mensagens prontas ($baseline); esvazie ou processe-as antes de iniciar"
  exit 1
}
ok "fila vazia; as mensagens da demonstração serão fáceis de identificar"

passo "Parando temporariamente os consumidores S2 para deixar os eventos visíveis"
dc stop characters characters-worker
CONSUMERS_STOPPED=1

declare -a OPERACOES=()
for versao in 1 2; do
  passo "Configurando o S3 para publicar o evento v$versao"
  if ! VALIDATION_EVENT_VERSION="$versao" docker compose up -d --force-recreate inventory >"$TMP/inventory.out" 2>&1; then
    falha "não foi possível recriar o Inventário para v$versao"
    tail -15 "$TMP/inventory.out" | sed 's/^/      /'
    exit 1
  fi
  espera_http "$S3_URL/health" 90 || { falha "Inventário não ficou saudável"; exit 1; }

  item="$(criar_item "Item demo v$versao $(date +%s)" 5 1)"
  comprar "$item" "version-demo-v$versao-$(date +%s)-$RANDOM"
  [ "$HTTP_CODE" = 202 ] && [ -n "$OPERACAO" ] || {
    falha "compra v$versao não iniciou (HTTP $HTTP_CODE): $BODY"
    exit 1
  }
  OPERACOES+=("$OPERACAO")
  info "operação v$versao: $OPERACAO"

  esperado=$((baseline + versao))
  recebido=0
  for _ in $(seq 45); do
    fila_json="$(curl -fsS -u "$RABBIT_USER:$RABBIT_PASS" "$RABBIT_API/queues/%2F/$QUEUE" 2>/dev/null || true)"
    recebido="$(json_num messages_ready "$fila_json")"
    [ "${recebido:-0}" -ge "$esperado" ] && break
    sleep 1
  done
  [ "${recebido:-0}" -ge "$esperado" ] || {
    falha "não apareceu na fila a mensagem de validação v$versao (prontas: ${recebido:-0})"
    exit 1
  }
  ok "mensagem v$versao aguardando em $QUEUE (messages_ready=$recebido)"
done

passo "Inspeção visual no RabbitMQ"
info "Abra a fila $QUEUE em http://localhost:${RABBITMQ_MANAGEMENT_PORT:-15672}."
info "Use Get messages com requeue habilitado para inspecionar os dois envelopes."
info "Compare type/version e payload: v1 usa deadlineAt; v2 usa expiresAt."
info "Não confirme/remova mensagens durante a inspeção."
read -r -p "  Pressione Enter depois de visualizar as duas mensagens... " _

passo "Retomando o S2 para processar as duas versões"
dc start characters characters-worker
CONSUMERS_STOPPED=0
for i in 0 1; do
  versao=$((i + 1))
  final="$(espera_fim_compra "${OPERACOES[$i]}" 90)"
  confere "o consumidor processou a mensagem v$versao (operação $final)" [ "$final" = "COMPLETED" ]
done

resultado_final "R7 — versionamento de eventos"
