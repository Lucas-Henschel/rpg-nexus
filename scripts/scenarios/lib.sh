#!/usr/bin/env bash
# Base comum dos cenários de falha (F1–F8). Cada script faz `source "$(dirname "$0")/lib.sh"`.
#
# Precisa só de bash, curl e Docker (no Windows, o Git Bash basta). Para ler JSON usa o Python do
# próprio computador e, se não houver, o Python do contêiner do MiniStack: não precisa de jq.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

# --- Configuração ---------------------------------------------------------------------------------

# Lê o .env da raiz (sem ele, o .env.example) sem trocar o que já veio do ambiente.
_carrega_env() {
  local arquivo=.env chave valor
  [ -f "$arquivo" ] || arquivo=.env.example
  [ -f "$arquivo" ] || return 0
  while IFS='=' read -r chave valor; do
    valor="${valor%$'\r'}"
    [[ "$chave" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    [ -n "${!chave+x}" ] && continue
    export "$chave=$valor"
  done < "$arquivo"
}
_carrega_env

S1="http://127.0.0.1:${CAMPAIGNS_PORT:-3001}"
S2="http://127.0.0.1:${CHARACTERS_PORT:-8000}"
S3="http://127.0.0.1:${INVENTORY_PORT:-8080}"
S4="http://127.0.0.1:${IDENTITY_PORT:-3002}"
MQ="http://127.0.0.1:${RABBITMQ_MANAGEMENT_PORT:-15672}"
MQ_AUTH="${RABBITMQ_USER:-dev}:${RABBITMQ_PASSWORD:-dev}"

TMPD="$(mktemp -d 2>/dev/null || mktemp -d -t cenario)"

# --- Saída ----------------------------------------------------------------------------------------

if [ -t 1 ]; then
  NEG=$'\e[1m'; VERDE=$'\e[32m'; VERM=$'\e[31m'; AMAR=$'\e[33m'; AZUL=$'\e[36m'; FIM=$'\e[0m'
else
  NEG=""; VERDE=""; VERM=""; AMAR=""; AZUL=""; FIM=""
fi

CONFERIDOS=0
FALHAS=0

titulo() { printf '\n%s=== %s ===%s\n' "$NEG" "$*" "$FIM"; }
passo() { printf '\n%s> %s%s\n' "$AZUL" "$*" "$FIM"; }
info() { printf '  %s\n' "$*"; }
aviso() { printf '  %s! %s%s\n' "$AMAR" "$*" "$FIM"; }
aborta() { printf '\n%sERRO: %s%s\n' "$VERM" "$*" "$FIM" >&2; exit 2; }

# confere "descrição" esperado obtido
confere() {
  CONFERIDOS=$((CONFERIDOS + 1))
  if [ "$2" = "$3" ]; then
    printf '  %s[ok]%s %s: %s\n' "$VERDE" "$FIM" "$1" "$3"
  else
    FALHAS=$((FALHAS + 1))
    printf '  %s[FALHOU]%s %s: esperado %s, obtido %s\n' "$VERM" "$FIM" "$1" "$2" "$3"
  fi
}

# confere_que "descrição" "valor mostrado" comando...   (passa se o comando der certo)
confere_que() {
  local descricao=$1 valor=$2
  shift 2
  CONFERIDOS=$((CONFERIDOS + 1))
  if "$@"; then
    printf '  %s[ok]%s %s: %s\n' "$VERDE" "$FIM" "$descricao" "$valor"
  else
    FALHAS=$((FALHAS + 1))
    printf '  %s[FALHOU]%s %s: %s\n' "$VERM" "$FIM" "$descricao" "$valor"
  fi
}

resultado() {
  _restaura
  echo
  if [ "$FALHAS" -eq 0 ]; then
    printf '%s%sPASS%s  %s (%d verificações)\n' "$NEG" "$VERDE" "$FIM" "$CENARIO" "$CONFERIDOS"
    exit 0
  fi
  printf '%s%sFAIL%s  %s (%d de %d verificações falharam)\n' "$NEG" "$VERM" "$FIM" "$CENARIO" "$FALHAS" "$CONFERIDOS"
  exit 1
}

# Volta a configuração normal uma vez só: no fim do cenário ou ao sair por erro ou Ctrl+C.
_RESTAURADO=0
_restaura() {
  [ "$_RESTAURADO" = 1 ] && return
  _RESTAURADO=1
  if declare -F restaura >/dev/null; then
    passo "Restaurando a configuração normal"
    restaura
  fi
}

_ao_sair() {
  local codigo=$?
  trap - EXIT INT TERM
  _restaura
  rm -rf "$TMPD"
  exit "$codigo"
}
trap _ao_sair EXIT
trap 'exit 130' INT TERM

# --- Ferramentas ----------------------------------------------------------------------------------

dc() { docker compose "$@"; }

_detecta_python() {
  local c
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import json' >/dev/null 2>&1; then
      PY=("$c")
      return
    fi
  done
  PY=(docker compose exec -T ministack python3)
}
_detecta_python

# json 'expressão'  — lê JSON da entrada e avalia a expressão Python com o documento em `d`.
json() {
  "${PY[@]}" -c '
import json, sys
try:
    d = json.loads(sys.stdin.read() or "null")
except Exception:
    d = None
try:
    v = eval(sys.argv[1])
except Exception:
    v = None
print("" if v is None else v if isinstance(v, str) else json.dumps(v))
' "$1"
}

novo_uuid() {
  printf '%04x%04x-%04x-4%03x-%04x-%04x%04x%04x\n' $RANDOM $RANDOM $RANDOM $((RANDOM & 0xfff)) \
    $(((RANDOM & 0x3fff) | 0x8000)) $RANDOM $RANDOM $RANDOM
}

agora_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# http MÉTODO URL [CORPO] [cabeçalho...]  → STATUS e BODY. Usa $TOKEN se houver.
http() {
  local metodo=$1 url=$2 corpo=${3:-} h
  shift 2
  [ $# -gt 0 ] && shift
  local args=(-sS -o "$TMPD/body" -w '%{http_code}' -X "$metodo" --max-time 20
    -H 'Content-Type: application/json')
  [ -n "${TOKEN:-}" ] && args+=(-H "Authorization: Bearer $TOKEN")
  for h in "$@"; do args+=(-H "$h"); done
  [ -n "$corpo" ] && args+=(--data-binary "$corpo")
  : > "$TMPD/body"
  STATUS=$(curl "${args[@]}" "$url" 2>/dev/null) || STATUS=000
  BODY=$(cat "$TMPD/body")
}

# --- RabbitMQ -------------------------------------------------------------------------------------

rabbitmqctl() { dc exec -T rabbitmq rabbitmqctl -q --no-table-headers "$@" 2>/dev/null; }

# Mensagens prontas + em processamento numa fila (consulta direta ao broker, sem atraso de estatística).
fila_msgs() { rabbitmqctl list_queues name messages | awk -v q="$1" '$1 == q { print $2 }'; }

fila_consumidores() { rabbitmqctl list_queues name consumers | awk -v q="$1" '$1 == q { print $2 }'; }

# Grava "fila quantidade" de todas as DLQs no arquivo dado.
foto_dlqs() { rabbitmqctl list_queues name messages | awk '$1 ~ /\.dlq$/ { print $1, $2 }' | sort > "$1"; }

# Mostra as DLQs que ganharam mensagens desde a foto; devolve o total novo em DLQ_NOVAS.
dlqs_novas() {
  local antes=$1 depois="$TMPD/dlqs-depois"
  foto_dlqs "$depois"
  DLQ_NOVAS=$(awk 'NR == FNR { a[$1] = $2; next } { d = $2 - a[$1]; if (d > 0) { print "  " $1 ": +" d > "/dev/stderr"; t += d } } END { print t + 0 }' "$antes" "$depois")
}

# publica EXCHANGE ROUTING_KEY CORPO [MESSAGE_ID]  (EXCHANGE vazio = direto para a fila ROUTING_KEY)
publica() {
  local exchange=${1:-amq.default} chave=$2 corpo=$3 mid=${4:-$(novo_uuid)} envio
  envio=$(printf '%s' "$corpo" | "${PY[@]}" -c '
import json, sys
print(json.dumps({"routing_key": sys.argv[1], "payload": sys.stdin.read(), "payload_encoding": "string",
                  "properties": {"message_id": sys.argv[2], "content_type": "application/json", "delivery_mode": 2}}))
' "$chave" "$mid")
  curl -sS -u "$MQ_AUTH" --max-time 10 -H 'Content-Type: application/json' \
    -X POST "$MQ/api/exchanges/%2F/$exchange/publish" --data-binary "$envio"
}

# --- Banco (DynamoDB do MiniStack) ----------------------------------------------------------------

# dynamo_scan TABELA  → itens da tabela como JSON simples (lido de dentro do contêiner do MiniStack).
dynamo_scan() {
  dc exec -T ministack python3 -c '
import json, sys, boto3
from boto3.dynamodb.types import TypeDeserializer
t = TypeDeserializer()
db = boto3.client("dynamodb", endpoint_url="http://localhost:4566", region_name="us-east-1",
                  aws_access_key_id="test", aws_secret_access_key="test")
itens, chave = [], None
while True:
    args = {"TableName": sys.argv[1]}
    if chave:
        args["ExclusiveStartKey"] = chave
    r = db.scan(**args)
    itens += [{k: t.deserialize(v) for k, v in i.items()} for i in r.get("Items", [])]
    chave = r.get("LastEvaluatedKey")
    if not chave:
        break
print(json.dumps(itens, default=str))
' "$1"
}

# Resposta que o validador externo (S4) gravou na outbox dele para a compra: "routing key motivo".
resposta_validador() {
  dynamo_scan action_validation_outbox | json "' '.join(str(x) for x in next(([r.get('routingKey'), r['envelope']['payload'].get('reason', ''), r.get('status', '')] for r in d if r['envelope'].get('correlationId') == '$1'), ['nenhuma']))"
}

# Envelope original (JSON) de um evento que o S3 gravou na outbox: evento_s3 OPID TIPO
evento_s3() {
  dynamo_scan inventory_inventory_outbox | json "next((r['envelope'] for r in d if '\"$1\"' in r['envelope'] and '\"$2\"' in r['envelope']), None)"
}

# --- Docker ---------------------------------------------------------------------------------------

# "serviço reinícios início" de cada contêiner do Compose.
foto_conteineres() {
  local id
  for id in $(dc ps -q); do
    docker inspect -f '{{.Name}} {{.RestartCount}} {{.State.StartedAt}}' "$id"
  done | sed 's#^/##' | sort
}

verifica_stack() {
  local nome url
  for nome in S1 S2 S3 S4; do
    url="${!nome}/health"
    curl -sf --max-time 5 -o /dev/null "$url" || aborta "$nome não responde em $url. Suba o sistema: docker compose up -d --wait"
  done
  curl -sf --max-time 5 -o /dev/null -u "$MQ_AUTH" "$MQ/api/overview" || aborta "painel do RabbitMQ não responde em $MQ"
}

# --- Fluxo de compra ------------------------------------------------------------------------------

# cria_mundo PREÇO ESTOQUE SALDO MAX_ITENS
# Cria usuário, campanha, loja, item e personagem escolhido. Define TOKEN, CID, IID, CHID e SALDO0.
cria_mundo() {
  local preco=$1 estoque=$2 saldo=$3 max_itens=$4 tag i
  tag="cen$(date +%s)$RANDOM"
  TOKEN=""
  http POST "$S4/auth/register" "{\"username\":\"$tag\",\"email\":\"$tag@exemplo.com\",\"password\":\"senha-forte-123\"}"
  [[ "$STATUS" =~ ^20[01]$ ]] || aborta "cadastro no S4: $STATUS $BODY"
  http POST "$S4/auth/login" "{\"identifier\":\"$tag\",\"password\":\"senha-forte-123\"}"
  TOKEN=$(printf '%s' "$BODY" | json '(d.get("tokens") or d)["accessToken"]')
  [ -n "$TOKEN" ] || aborta "login no S4: $STATUS $BODY"

  http POST "$S1/campaigns" "{\"name\":\"Cenário $CENARIO\"}"
  CID=$(printf '%s' "$BODY" | json 'd["campaignId"]')
  [ -n "$CID" ] || aborta "campanha no S1: $STATUS $BODY"

  # A cópia da campanha chega ao S3 e ao S2 por evento: tenta por alguns segundos.
  for i in $(seq 60); do
    http PUT "$S3/shops/$CID" '{"name":"Loja do cenário","active":true}'
    [[ "$STATUS" =~ ^20[01]$ ]] && break
    sleep 0.25
  done
  [[ "$STATUS" =~ ^20[01]$ ]] || aborta "loja no S3: $STATUS $BODY"
  http POST "$S3/shops/$CID/items" "{\"name\":\"Espada de Cinzas\",\"description\":\"\",\"price\":$preco,\"available\":$estoque}"
  IID=$(printf '%s' "$BODY" | json 'd.get("itemId") or d.get("id")')
  [ -n "$IID" ] || aborta "item no S3: $STATUS $BODY"

  for i in $(seq 60); do
    http POST "$S2/characters" "{\"campaignId\":\"$CID\",\"name\":\"Lyra\",\"hp\":{\"current\":10,\"max\":10},\"maxItems\":$max_itens,\"currency\":{\"amount\":$saldo}}"
    [ "$STATUS" = 201 ] && break
    sleep 0.25
  done
  CHID=$(printf '%s' "$BODY" | json 'd.get("characterId") or d.get("id")')
  [ -n "$CHID" ] || aborta "personagem no S2: $STATUS $BODY"
  http PUT "$S1/campaigns/$CID/members/me/character" "{\"characterId\":\"$CHID\",\"characterName\":\"Lyra\"}"
  [ "$STATUS" = 200 ] || aborta "escolher personagem no S1: $STATUS $BODY"

  # O S3 só aceita compra depois que a escolha do personagem chega a ele. Uma compra de item
  # inexistente responde 404 assim que chegou, sem criar nada.
  for i in $(seq 60); do
    http POST "$S3/acquisitions" "{\"campaignId\":\"$CID\",\"characterId\":\"$CHID\",\"itemId\":\"sonda\"}" "Idempotency-Key: $(novo_uuid)"
    [ "$STATUS" != 403 ] && break
    sleep 0.25
  done
  [ "$STATUS" != 403 ] || aborta "o S3 não recebeu a escolha do personagem"
  SALDO0=$saldo
  info "campanha $CID | item $IID (preço $preco, estoque $estoque) | personagem $CHID (saldo $saldo)"
}

# compra  → OPID (vazio se recusada; STATUS tem o código HTTP)
compra() {
  http POST "$S3/acquisitions" "{\"campaignId\":\"$CID\",\"characterId\":\"$CHID\",\"itemId\":\"$IID\"}" "Idempotency-Key: $(novo_uuid)"
  OPID=""
  [ "$STATUS" = 202 ] && OPID=$(printf '%s' "$BODY" | json 'd["operationId"]')
}

saga_status() {
  http GET "$S3/acquisitions/$1"
  printf '%s' "$BODY" | json 'd.get("status")'
}

# espera_saga OPID [SEGUNDOS]  → SAGA com o estado final (ou o último visto)
espera_saga() {
  local fim=$((SECONDS + ${2:-90}))
  while [ $SECONDS -lt $fim ]; do
    SAGA=$(saga_status "$1")
    case "$SAGA" in COMPLETED | COMPENSATED | REJECTED | EXPIRED) return 0 ;; esac
    sleep 1
  done
  return 1
}

saldo() {
  http GET "$S2/characters/$CHID"
  printf '%s' "$BODY" | json 'd["currency"]["amount"]'
}

estoque() {
  http GET "$S3/shops/$CID/items"
  printf '%s' "$BODY" | json "next((i.get('available') for i in d if (i.get('itemId') or i.get('id')) == '$IID'), None)"
}

# Quantidade do item no inventário do personagem (S3).
inventario() {
  http GET "$S3/inventory/$CHID"
  printf '%s' "$BODY" | json 'sum(int(e.get("quantity", 1)) for e in d)'
}

# Operações de dinheiro no S2, como "TIPO:valor TIPO:valor".
movimentos() {
  http GET "$S2/characters/$CHID/money/transactions"
  printf '%s' "$BODY" | json '" ".join("%s:%s:%s" % (m.get("kind"), m.get("amount"), m.get("status")) for m in d["items"]) or "nenhum"'
}

# Reservas de espaço da Saga no S2, como "STATUS STATUS".
reservas() {
  http GET "$S2/characters/$CHID/holds"
  printf '%s' "$BODY" | json '" ".join(h.get("status", "?") for h in d["items"]) or "nenhuma"'
}

# Linha do tempo da Saga no S3.
historico_saga() {
  http GET "$S3/acquisitions/$1/history"
  printf '%s' "$BODY" | json '"\n".join("  " + str(e.get("occurredAt", ""))[11:23] + "  " + " ".join(str(e.get(k)) for k in ("status", "reason") if e.get(k)) for e in d) if isinstance(d, list) else d'
}

mostra_estado() {
  info "Saga: ${SAGA:-?} | estoque: $(estoque) | saldo: $(saldo) | inventário: $(inventario)"
  info "dinheiro (S2): $(movimentos) | reservas (S2): $(reservas)"
}

verifica_stack
