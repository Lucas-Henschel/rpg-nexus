#!/usr/bin/env bash
# Dados de demonstração: dois usuários com senha conhecida, uma campanha com loja e itens e o
# personagem do jogador, com retrato. Nenhuma compra é feita: elas ficam para a demonstração ao vivo.
# Serve para entrar no front com dados reais e mostrar as tabelas de cada banco
# (`docker compose --profile db-admin up -d`).
#
# Com a pilha no ar, na raiz do repositório:  bash scripts/demo/popular-banco.sh
# Pode rodar de novo: os usuários são reaproveitados e uma campanha nova é criada.
source "$(dirname "${BASH_SOURCE[0]}")/../requisitos/lib.sh"

SENHA="${SENHA_DEMO:-12345678}"
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
}
item "Poção de Cura" "Recupera 2d4 pontos de vida" 10 20
item "Corda de Seda" "15 metros, aguenta três aventureiros" 5 10
item "Espada Longa" "Aço anão, bem equilibrada" 40 3
item "Coroa do Rei Esquecido" "Cara demais para um aventureiro iniciante" 500 1
ok "loja com 4 itens"

passo "Jogador: entra pelo código, cria e escolhe o personagem"
entrar jogador
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

# Retrato: o S2 confere tipo e tamanho do arquivo e grava no bucket S3 do MiniStack.
RETRATO="$(dirname "${BASH_SOURCE[0]}")/retrato-thorin.png"
separa_resposta "$(curl -s -w "$MARCA%{http_code} %{time_total}" -X PUT "$S2_URL/characters/$PERSONAGEM/portrait" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: image/png' --data-binary "@$RETRATO" || true)"
if [ "$HTTP_CODE" = "200" ]; then ok "retrato enviado ao S3"; else falha "enviar o retrato falhou (HTTP $HTTP_CODE): $BODY"; fi

titulo "Pronto"
cat <<EOF
  Front-end:  http://localhost:${FRONTEND_PORT:-5173}
    mestre  / $SENHA   (dono da campanha e da loja)
    jogador / $SENHA   (Thorin, com $OURO de ouro, pronto para comprar na loja)
  Campanha "Mesa de demonstração", código $CODIGO

  Tabelas (docker compose --profile db-admin up -d):
    Campanhas   http://localhost:${DB_ADMIN_CAMPAIGNS_PORT:-8001}   campanha e participantes
    Personagens http://localhost:${DB_ADMIN_CHARACTERS_PORT:-8002}   characters e character_read_model (CQRS)
    Inventário  http://localhost:${DB_ADMIN_INVENTORY_PORT:-8003}   loja e estoque dos itens
    Identidade  http://localhost:${DB_ADMIN_IDENTITY_PORT:-8004}   usuários e histórico da campanha
EOF
