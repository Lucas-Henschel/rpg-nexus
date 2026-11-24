#!/usr/bin/env bash
# Dados de demonstração: dois usuários com senha conhecida, uma campanha com loja, o personagem do
# jogador e algumas compras (concluídas e uma compensada por falta de ouro). Serve para entrar no
# front com dados reais e mostrar as tabelas de cada banco (`docker compose --profile db-admin up -d`).
#
# Com a pilha no ar, na raiz do repositório:  bash scripts/demo/popular-banco.sh
# Pode rodar de novo: os usuários são reaproveitados e uma campanha nova é criada.
source "$(dirname "${BASH_SOURCE[0]}")/../requisitos/lib.sh"

SENHA="${SENHA_DEMO:-rpg-nexus-demo}"
OURO="${OURO:-100}"

# entrar USUARIO  → TOKEN do usuário (cadastra na primeira vez, depois só faz login)
entrar() {
  TOKEN=""
  api POST "$S4_URL/auth/register" "{\"username\":\"$1\",\"email\":\"$1@rpg-nexus.dev\",\"password\":\"$SENHA\"}"
  if [ "$HTTP_CODE" = "409" ]; then
    api POST "$S4_URL/auth/login" "{\"identifier\":\"$1\",\"password\":\"$SENHA\"}"
  fi
  TOKEN="$(json_str accessToken "$BODY")"
  [ -n "$TOKEN" ] || { falha "não consegui entrar como $1 (HTTP $HTTP_CODE): $BODY"; exit 1; }
}

# tenta_ate CODIGO METODO URL [CORPO]  → repete por até 30 s enquanto o evento da campanha não chegou
tenta_ate() {
  local esperado="$1"; shift
  for _ in $(seq 60); do
    api "$@"
    [ "$HTTP_CODE" = "$esperado" ] && return 0
    sleep 0.5
  done
  falha "$2 $3 respondeu HTTP $HTTP_CODE (esperado $esperado): $BODY"
  exit 1
}

titulo "Populando o banco com dados de demonstração"
confere_pilha

passo "Mestre: usuário, campanha e loja"
entrar mestre
TOKEN_MESTRE="$TOKEN"
api POST "$S1_URL/campaigns" '{"name":"Mesa de demonstração"}'
CAMPANHA="$(json_str campaignId "$BODY")"
CODIGO="$(json_str joinCode "$BODY")"
[ -n "$CAMPANHA" ] || { falha "criar a campanha falhou (HTTP $HTTP_CODE): $BODY"; exit 1; }
info "campanha $CAMPANHA (código $CODIGO)"

tenta_ate 200 PUT "$S3_URL/shops/$CAMPANHA" '{"name":"Empório do Anão","active":true}'
item() {
  api POST "$S3_URL/shops/$CAMPANHA/items" \
    "{\"name\":\"$1\",\"description\":\"$2\",\"price\":$3,\"available\":$4}"
  [ "$HTTP_CODE" = "201" ] || { falha "criar o item $1 falhou (HTTP $HTTP_CODE): $BODY"; exit 1; }
  json_str itemId "$BODY"
}
POCAO="$(item "Poção de Cura" "Recupera 2d4 pontos de vida" 10 20)"
CORDA="$(item "Corda de Seda" "15 metros, aguenta três aventureiros" 5 10)"
ESPADA="$(item "Espada Longa" "Aço anão, bem equilibrada" 40 3)"
COROA="$(item "Coroa do Rei Esquecido" "Cara demais para um aventureiro iniciante" 500 1)"
ok "loja com 4 itens"

passo "Jogador: entra pelo código, cria e escolhe o personagem"
entrar jogador
TOKEN_JOGADOR="$TOKEN"
api POST "$S1_URL/campaigns/join" "{\"joinCode\":\"$CODIGO\"}"
case "$HTTP_CODE" in 200|201) ;; *) falha "entrar na campanha falhou (HTTP $HTTP_CODE): $BODY"; exit 1 ;; esac

# O S2 só aceita a ficha depois de receber, pelo RabbitMQ, a entrada do jogador na campanha.
tenta_ate 201 POST "$S2_URL/characters" \
  "{\"campaignId\":\"$CAMPANHA\",\"name\":\"Thorin Escudo-de-Ferro\",\"hp\":{\"current\":12,\"max\":12},\"maxItems\":10,\"currency\":{\"name\":\"Ouro\",\"amount\":$OURO}}"
PERSONAGEM="$(json_str id "$BODY")"
api PUT "$S1_URL/campaigns/$CAMPANHA/members/me/character" \
  "{\"characterId\":\"$PERSONAGEM\",\"characterName\":\"Thorin Escudo-de-Ferro\"}"
[ "$HTTP_CODE" = "200" ] || { falha "escolher o personagem falhou (HTTP $HTTP_CODE): $BODY"; exit 1; }
info "personagem $PERSONAGEM com $OURO de ouro"

# O S3 sabe qual personagem o jogador usa pelo evento do S1: item inexistente dá 404 quando já sabe.
for _ in $(seq 60); do
  comprar "item-que-nao-existe" "sonda-$RANDOM-$RANDOM"
  [ "$HTTP_CODE" = "404" ] && break
  sleep 0.5
done
ok "jogador pronto para comprar"

passo "Compras do jogador"
compra() {
  comprar "$2"
  [ "$HTTP_CODE" = "202" ] || { falha "comprar $1 respondeu HTTP $HTTP_CODE: $BODY"; return; }
  info "$1: $(espera_fim_compra "$OPERACAO" 2>/dev/null)"
}
compra "Poção de Cura" "$POCAO"
compra "Poção de Cura" "$POCAO"
compra "Corda de Seda" "$CORDA"
compra "Espada Longa" "$ESPADA"
compra "Coroa do Rei Esquecido (sem ouro: o débito é recusado e a Saga compensa)" "$COROA"

TOKEN="$TOKEN_JOGADOR"
info "ouro restante: $(saldo)"
TOKEN="$TOKEN_MESTRE"

titulo "Pronto"
cat <<EOF
  Front-end:  http://localhost:${FRONTEND_PORT:-5173}
    mestre  / $SENHA   (dono da campanha e da loja)
    jogador / $SENHA   (Thorin, com o inventário e o histórico das compras)
  Campanha "Mesa de demonstração", código $CODIGO

  Tabelas (docker compose --profile db-admin up -d):
    Campanhas   http://localhost:${DB_ADMIN_CAMPAIGNS_PORT:-8001}   participantes e itemsAcquired
    Personagens http://localhost:${DB_ADMIN_CHARACTERS_PORT:-8002}   characters e character_read_model (CQRS)
    Inventário  http://localhost:${DB_ADMIN_INVENTORY_PORT:-8003}   Sagas, estoque e histórico da Saga
    Identidade  http://localhost:${DB_ADMIN_IDENTITY_PORT:-8004}   usuários e histórico da campanha
EOF
