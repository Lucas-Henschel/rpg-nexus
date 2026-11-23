#!/usr/bin/env bash
# Funções comuns dos scripts de requisitos (R1 a R6). Não rode este arquivo direto: os scripts rN-*.sh o
# carregam com `source`.
#
# Precisa de: bash (no Windows, o Git Bash), curl e docker compose, com a pilha no ar
# (`docker compose up --build --detach --wait` na raiz do repositório).

set -euo pipefail

# O curl nunca recebe caminho de arquivo (-o): no Git Bash ele pode ser o curl.exe do Windows, que não entende
# caminhos como /dev/null ou /tmp/... As respostas são lidas da saída padrão do curl.

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"

# Endereços dos serviços no host (as portas padrão do .env.example da raiz). O compose publica as portas só
# em 127.0.0.1 (IPv4); "localhost" pode virar ::1 (IPv6) no Windows, então o IP vai direto.
S1_URL="${S1_URL:-http://127.0.0.1:${CAMPAIGNS_PORT:-3001}}"
S2_URL="${S2_URL:-http://127.0.0.1:${CHARACTERS_PORT:-8000}}"
S3_URL="${S3_URL:-http://127.0.0.1:${INVENTORY_PORT:-8080}}"
S4_URL="${S4_URL:-http://127.0.0.1:${IDENTITY_PORT:-3002}}"
RABBIT_API="${RABBIT_API:-http://127.0.0.1:${RABBITMQ_MANAGEMENT_PORT:-15672}/api}"

# Um proxy de rede configurado na máquina (HTTP_PROXY, comum em rede de universidade) não pode intermediar
# as chamadas aos serviços locais.
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"
export no_proxy="$NO_PROXY"
RABBIT_USER="${RABBITMQ_USER:-dev}"
RABBIT_PASS="${RABBITMQ_PASSWORD:-dev}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- Saída ---------------------------------------------------------------------------------------------

if [ -t 1 ]; then
  NEGRITO=$'\e[1m'; VERDE=$'\e[32m'; VERMELHO=$'\e[31m'; AMARELO=$'\e[33m'; AZUL=$'\e[36m'; FIM=$'\e[0m'
else
  NEGRITO=""; VERDE=""; VERMELHO=""; AMARELO=""; AZUL=""; FIM=""
fi

FALHAS=0

titulo() { printf '\n%s══ %s ══%s\n' "$NEGRITO" "$*" "$FIM"; }
passo()  { printf '\n%s▶ %s%s\n' "$AZUL" "$*" "$FIM"; }
info()   { printf '  %s\n' "$*"; }
ok()     { printf '  %s✔ %s%s\n' "$VERDE" "$*" "$FIM"; }
# Vai para o stderr: assim aparece mesmo quando a função que falhou roda dentro de $(...).
falha()  { printf '  %s✘ %s%s\n' "$VERMELHO" "$*" "$FIM" >&2; FALHAS=$((FALHAS + 1)); }
aviso()  { printf '  %s! %s%s\n' "$AMARELO" "$*" "$FIM"; }
cmd()    { printf '  %s$ %s%s\n' "$AMARELO" "$*" "$FIM"; }

# Confere uma condição e registra o resultado: confere "descrição" <comando de teste...>
confere() {
  local descricao="$1"; shift
  if "$@"; then ok "$descricao"; else falha "$descricao"; fi
}

# Com PAUSA=1, espera Enter antes de cada etapa (para apresentar ao vivo).
pausa() {
  if [ "${PAUSA:-0}" = "1" ]; then
    read -r -p "  [Enter para continuar] " _
  fi
}

resultado_final() {
  echo
  if [ "$FALHAS" -eq 0 ]; then
    printf '%s%s✔ %s: tudo conferido.%s\n' "$NEGRITO" "$VERDE" "$1" "$FIM"
  else
    printf '%s%s✘ %s: %d verificação(ões) falharam.%s\n' "$NEGRITO" "$VERMELHO" "$1" "$FALHAS" "$FIM"
    exit 1
  fi
}

# --- HTTP e JSON -----------------------------------------------------------------------------------------

TOKEN=""
HTTP_CODE=""
TEMPO=""
BODY=""

# api MÉTODO URL [CORPO_JSON] [CABEÇALHO_EXTRA]  → preenche HTTP_CODE e BODY
api() {
  local metodo="$1" url="$2" dados="${3:-}" extra="${4:-}"
  local args=(-s -w "$MARCA%{http_code} %{time_total}" -X "$metodo" "$url" -H 'Content-Type: application/json')
  [ -n "$TOKEN" ] && args+=(-H "Authorization: Bearer $TOKEN")
  [ -n "$extra" ] && args+=(-H "$extra")
  if [ -n "$dados" ]; then
    # O corpo vai pela entrada padrão: o curl.exe do Windows recebe os argumentos numa codificação do
    # Windows e estragaria acentos; pela entrada padrão, os bytes UTF-8 chegam intactos.
    separa_resposta "$(printf '%s' "$dados" | curl "${args[@]}" --data-binary @- || true)"
  else
    separa_resposta "$(curl "${args[@]}" || true)"
  fi
}

# A MARCA não pode começar com @ (o curl leria o -w de um arquivo).
# O curl escreve o corpo e, depois da MARCA, "código tempo". separa_resposta TEXTO → BODY, HTTP_CODE, TEMPO
MARCA='##fim-da-resposta##'
separa_resposta() {
  local texto="${1//$'\r'/}" fim
  if [[ "$texto" == *"$MARCA"* ]]; then
    BODY="${texto%"$MARCA"*}"
    fim="${texto##*"$MARCA"}"
  else
    BODY="$texto"; fim="000 0"
  fi
  HTTP_CODE="${fim%% *}"
  TEMPO="${fim#* }"   # segundos, medidos pelo curl
}

# codigo_http URL  → só o código HTTP (000 se não respondeu)
codigo_http() {
  local saida
  saida="$(curl -s --max-time 5 -w "$MARCA%{http_code}" "$1" 2>/dev/null || true)"
  saida="${saida//$'\r'/}"
  if [[ "$saida" == *"$MARCA"* ]]; then printf '%s' "${saida##*"$MARCA"}"; else printf '000'; fi
}

# json_str CAMPO [JSON]  → primeiro valor de texto do campo (lê de stdin se o JSON não for passado)
json_str() {
  local texto="${2-$(cat)}"
  printf '%s' "$texto" | grep -o "\"$1\": *\"[^\"]*\"" | head -1 | sed 's/.*: *"\(.*\)"$/\1/' || true
}

# json_num CAMPO [JSON]  → primeiro valor numérico do campo
json_num() {
  local texto="${2-$(cat)}"
  printf '%s' "$texto" | grep -o "\"$1\": *-\{0,1\}[0-9][0-9]*" | head -1 | grep -o -- '-\{0,1\}[0-9][0-9]*$' || true
}

# conta OCORRÊNCIAS de um texto fixo num conteúdo
conta() { printf '%s' "$2" | grep -o -F -- "$1" | wc -l | tr -d ' '; }

# Instante atual em UTC, para filtrar logs (docker compose logs --since). Volta 5 s: no Windows, o relógio
# da máquina virtual do Docker Desktop pode estar uns segundos diferente do relógio do PC. Os filtros usam
# ids únicos de cada execução, então a folga não traz linhas de outras execuções.
agora_utc() { date -u -d '-5 seconds' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ; }

# logs_s2 DESDE  → linhas de log do S2 (API e workers) desde o instante dado
logs_s2() {
  docker compose logs --no-log-prefix --since "$1" characters characters-worker 2>/dev/null || true
}

# espera_logs_s2 DESDE QUANTIDADE SEGUNDOS FILTRO...  → espera até haver QUANTIDADE linhas com todos os
# filtros (textos fixos). As estatísticas de fila do RabbitMQ atualizam com atraso; o log não.
espera_logs_s2() {
  local desde="$1" quantidade="$2" limite="$3"; shift 3
  local linhas n filtro
  for _ in $(seq "$limite"); do
    linhas="$(logs_s2 "$desde")"
    for filtro in "$@"; do linhas="$(printf '%s\n' "$linhas" | grep -F -- "$filtro" || true)"; done
    n="$(printf '%s\n' "$linhas" | grep -c . || true)"
    [ "$n" -ge "$quantidade" ] && return 0
    sleep 1
  done
  return 1
}

# espera_http URL [SEGUNDOS] [CÓDIGO]  → espera a URL responder com o código (padrão 200), sem token
espera_http() {
  local url="$1" limite="${2:-90}" esperado="${3:-200}" codigo
  for _ in $(seq "$limite"); do
    codigo="$(codigo_http "$url")"
    [ "$codigo" = "$esperado" ] && return 0
    sleep 1
  done
  return 1
}

# --- Compra (S3) -----------------------------------------------------------------------------------------

# status_compra OPERATION_ID  → status atual da Saga
status_compra() {
  api GET "$S3_URL/acquisitions/$1"
  json_str status "$BODY"
}

# espera_fim_compra OPERATION_ID [SEGUNDOS]  → imprime cada mudança de estado e devolve o estado final
espera_fim_compra() {
  local op="$1" limite="${2:-60}" atual="" anterior=""
  for _ in $(seq "$((limite * 2))"); do
    atual="$(status_compra "$op")"
    if [ "$atual" != "$anterior" ]; then
      info "estado: ${atual:-?}" >&2
      anterior="$atual"
    fi
    case "$atual" in COMPLETED|COMPENSATED|REJECTED|EXPIRED) break ;; esac
    sleep 0.5
  done
  printf '%s' "$atual"
}

# comprar ITEM_ID [CHAVE]  → POST /acquisitions; preenche HTTP_CODE, BODY e OPERACAO
comprar() {
  local chave="${2:-req-$(date +%s)-$RANDOM-$RANDOM}"
  api POST "$S3_URL/acquisitions" \
    "{\"campaignId\":\"$CAMPANHA\",\"characterId\":\"$PERSONAGEM\",\"itemId\":\"$1\"}" \
    "Idempotency-Key: $chave"
  OPERACAO="$(json_str operationId "$BODY")"
}

# criar_item NOME ESTOQUE PREÇO  → id do item novo na loja da campanha
criar_item() {
  api POST "$S3_URL/shops/$CAMPANHA/items" \
    "{\"name\":\"$1\",\"description\":\"criado pelos scripts de requisitos\",\"price\":$3,\"available\":$2}"
  if [ "$HTTP_CODE" != "201" ]; then
    falha "não foi possível criar o item (HTTP $HTTP_CODE): $BODY"
    exit 1
  fi
  json_str itemId "$BODY"
}

# estoque ITEM_ID  → "disponível reservado"
estoque() {
  api GET "$S3_URL/shops/$CAMPANHA/items"
  local item
  item="$(printf '%s' "$BODY" | tr '}' '\n' | grep -F "\"itemId\":\"$1\"" | head -1)"
  printf '%s %s' "$(json_num available "$item")" "$(json_num reserved "$item")"
}

# status_reserva OPERATION_ID  → estado da reserva na mochila (S2): HELD, COMMITTED ou RELEASED
status_reserva() {
  api GET "$S2_URL/characters/$PERSONAGEM/holds"
  printf '%s' "$BODY" | grep -o "\"operationId\":\"$1\"[^}]*" | json_str status
}

# espera_reserva OPERATION_ID ESTADO [SEGUNDOS]  → o S2 recebe o desfecho da Saga pelo RabbitMQ
espera_reserva() {
  for _ in $(seq "${3:-30}"); do
    [ "$(status_reserva "$1")" = "$2" ] && return 0
    sleep 1
  done
  return 1
}

# saldo  → dinheiro atual do personagem (S2)
saldo() {
  api GET "$S2_URL/characters/$PERSONAGEM"
  printf '%s' "$BODY" | grep -o '"currency": *{[^}]*}' | json_num amount
}

# --- Cenário ---------------------------------------------------------------------------------------------

# Confere se a pilha está no ar antes de começar.
confere_pilha() {
  local nome url erro
  confere_docker
  for par in "S1 Campanhas|$S1_URL/health" "S2 Personagens|$S2_URL/health" \
             "S3 Inventário|$S3_URL/health" "S4 Identidade|$S4_URL/health"; do
    nome="${par%%|*}"; url="${par#*|}"
    if ! erro="$(curl -sS -f --max-time 5 "$url" 2>&1 >/dev/null)"; then
      echo "${VERMELHO}$nome não responde em $url${FIM}"
      echo "  erro do curl: $erro"
      echo "  contêineres da pilha:"
      docker compose ps --format '    {{.Service}}: {{.Status}}' 2>/dev/null || true
      echo "  Se algum serviço não estiver Up, suba a pilha: docker compose up --build --detach --wait"
      exit 1
    fi
  done
}

# Monta um cenário novo e isolado: usuário, campanha, personagem escolhido, loja ativa.
# Variáveis definidas: TOKEN, USUARIO, CAMPANHA, PERSONAGEM.
#   MOCHILA (padrão 100) e DINHEIRO (padrão 1000) ajustam o personagem.
preparar_cenario() {
  confere_pilha
  local sufixo senha
  sufixo="$(date +%s)$RANDOM"
  USUARIO="req$sufixo"
  senha="senha-dos-requisitos"

  passo "Preparando um cenário novo (usuário, campanha, personagem e loja)"

  TOKEN=""
  api POST "$S4_URL/auth/register" "{\"username\":\"$USUARIO\",\"email\":\"$USUARIO@exemplo.com\",\"password\":\"$senha\"}"
  TOKEN="$(json_str accessToken "$BODY")"
  [ -n "$TOKEN" ] || { falha "cadastro no S4 falhou (HTTP $HTTP_CODE): $BODY"; exit 1; }
  info "usuário: $USUARIO"

  api POST "$S1_URL/campaigns" "{\"name\":\"Requisitos $sufixo\"}"
  CAMPANHA="$(json_str campaignId "$BODY")"
  [ -n "$CAMPANHA" ] || { falha "criar campanha no S1 falhou (HTTP $HTTP_CODE): $BODY"; exit 1; }
  info "campanha: $CAMPANHA (código $(json_str joinCode "$BODY"))"

  # O S2 só aceita a ficha depois de receber, pelo RabbitMQ, o evento de entrada na campanha.
  local corpo="{\"campaignId\":\"$CAMPANHA\",\"name\":\"Cobaia\",\"hp\":{\"current\":10,\"max\":10},\"maxItems\":${MOCHILA:-100},\"currency\":{\"name\":\"Moedas\",\"amount\":${DINHEIRO:-1000}}}"
  for _ in $(seq 60); do
    api POST "$S2_URL/characters" "$corpo"
    [ "$HTTP_CODE" = "201" ] && break
    sleep 0.5
  done
  PERSONAGEM="$(json_str id "$BODY")"
  [ "$HTTP_CODE" = "201" ] && [ -n "$PERSONAGEM" ] || { falha "criar personagem no S2 falhou (HTTP $HTTP_CODE): $BODY"; exit 1; }
  info "personagem: $PERSONAGEM (mochila ${MOCHILA:-100}, ${DINHEIRO:-1000} moedas)"

  api PUT "$S1_URL/campaigns/$CAMPANHA/members/me/character" "{\"characterId\":\"$PERSONAGEM\",\"characterName\":\"Cobaia\"}"
  [ "$HTTP_CODE" = "200" ] || { falha "escolher personagem no S1 falhou (HTTP $HTTP_CODE): $BODY"; exit 1; }

  # O S3 também conhece dono e personagem escolhido pelos eventos do S1.
  for _ in $(seq 60); do
    api PUT "$S3_URL/shops/$CAMPANHA" '{"name":"Loja dos requisitos","active":true}'
    [ "$HTTP_CODE" = "200" ] && break
    sleep 0.5
  done
  [ "$HTTP_CODE" = "200" ] || { falha "ativar a loja no S3 falhou (HTTP $HTTP_CODE): $BODY"; exit 1; }

  # Espera o S3 saber qual personagem foi escolhido: com item inexistente, 404 em vez de 403.
  for _ in $(seq 60); do
    comprar "item-que-nao-existe" "sonda-$sufixo-$RANDOM"
    [ "$HTTP_CODE" = "404" ] && break
    sleep 0.5
  done
  [ "$HTTP_CODE" = "404" ] || { falha "o S3 não recebeu o personagem escolhido (HTTP $HTTP_CODE): $BODY"; exit 1; }
  ok "cenário pronto"
}

# --- Docker ----------------------------------------------------------------------------------------------

# dc ARGUMENTOS...  → docker compose; se falhar, mostra o erro do Docker e para o script.
dc() {
  if ! docker compose "$@" >"$TMP/dc.out" 2>&1; then
    falha "falhou: docker compose $*"
    tail -15 "$TMP/dc.out" | sed 's/^/      /'
    exit 1
  fi
}

# Publica eventos de teste no RabbitMQ pelo script do S2 (dentro do contêiner).
publicar() {
  if ! docker compose exec -T characters python -m scripts.publish_event "$@" 2>"$TMP/publicar.err"; then
    falha "falhou: docker compose exec characters python -m scripts.publish_event $*"
    tail -15 "$TMP/publicar.err" | sed 's/^/      /' >&2
    exit 1
  fi
}

# Confere se o docker compose deste bash enxerga os contêineres da pilha.
confere_docker() {
  local dica="  Abra o ${NEGRITO}Git Bash${FIM} na pasta do repositório e rode o script por lá.
  No PowerShell, o comando ${NEGRITO}bash${FIM} costuma abrir o bash do WSL, que não usa o Docker do Windows.
  Para chamar o Git Bash a partir do PowerShell:
    & \"C:\\Program Files\\Git\\bin\\bash.exe\" scripts/requisitos/r1-idempotencia.sh"
  if grep -qi microsoft /proc/version 2>/dev/null; then
    aviso "este é o bash do WSL (Linux dentro do Windows)."
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "${VERMELHO}O comando docker não existe neste bash.${FIM}"
    printf '%s\n' "$dica"
    exit 1
  fi
  if ! docker compose ps --services --status running >"$TMP/ps.out" 2>&1 || ! grep -qx characters "$TMP/ps.out"; then
    echo "${VERMELHO}O docker compose deste bash não enxerga a pilha do rpg-nexus rodando:${FIM}"
    tail -5 "$TMP/ps.out" | sed 's/^/    /'
    printf '%s\n' "$dica"
    exit 1
  fi
}
