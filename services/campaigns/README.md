# S1 — Campanhas (Node.js · TypeScript · Fastify)

> RPG Nexus · Sistemas Distribuídos — FURB · Dono: **P1**

Microsserviço das **campanhas** de RPG: cadastro, participantes e um resumo do que cada personagem
conquistou. Usa **DynamoDB** (tabelas exclusivas), consome o evento **`ItemAcquired`** do
**RabbitMQ** e publica, por uma outbox, os eventos de campanha e de participantes.

## 1. Responsabilidades

| Faz                                                                                 | Não faz                                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Criar campanhas com dono e código de entrada de seis dígitos; listar as do usuário  | Autenticar (é do S4; aqui só se valida o token) nem validar personagens no S2 |
| Entrada pelo código, papéis `OWNER`/`PLAYER`, personagem de cada um, sair e remover | Participar da Saga de aquisição (é do S3 Inventário)                          |
| Consumir `ItemAcquired`: registrar a atividade e somar itens por participante       | Projetar permissões (é de quem consome os eventos, como o S3)                 |
| Mostrar a campanha com participantes e as últimas 20 atividades                     | Ler tabelas de outros serviços                                                |
| Publicar `CampaignCreated`, `CampaignMemberJoined` e `CampaignMemberRemoved`        |                                                                               |

## 2. Organização do código

```
src/
  config.ts              variáveis de ambiente (zod), com os padrões do ambiente local
  server.ts              liga tudo: repositórios → serviço → HTTP, consumidor e relay da outbox
  domain/                tipos e erros do negócio
  db/                    infraestrutura do DynamoDB: conexão, nomes e criação das tabelas
  repositories/          um repositório por tabela; só lê e grava
  services/campaigns.ts  regras (campanha precisa existir, monta a página, gera o código)
  http/                  rotas, formatos aceitos (schemas.ts) e tratamento de erros
  messaging/             RabbitMQ: consumo (validação, retry), eventos publicados e relay da outbox
  scripts/               create-tables e publish-item-acquired
  tracing/               OpenTelemetry: setup, spans HTTP, de mensagens e do DynamoDB
```

Rotas e consumidor só falam com o **serviço**; o serviço é quem usa os repositórios.

## 3. HTTP

Todas as rotas, menos `/health` e `/ready`, exigem o access token do S4 em
`Authorization: Bearer <token>`. O S1 valida a assinatura HS256 com o mesmo `JWT_SECRET` do S4,
o emissor, a audiência e a validade, e usa o `sub` (userId) e o `username`. Sem token, ou com token
inválido: 401 `UNAUTHENTICATED`.

Quem cria a campanha é o dono (`OWNER`); quem entra pelo código é `PLAYER`. O `campaignId` é um
UUID interno; o que as pessoas veem e digitam é o `joinCode`, de seis algarismos, sorteado pelo
serviço e único (escrita condicional na tabela de códigos; se repetir, sorteia outro).

| Rota                                                                              | Resposta                                                                                                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                                                     | `{status: "ok"}`                                                                                                                              |
| `GET /ready`                                                                      | 200 `ready` ou 503 `degraded`, com `checks.dynamodb` e `checks.rabbitmq`                                                                      |
| `POST /campaigns` `{name}`                                                        | 201 com a campanha (`ownerId`, `ownerName`, `joinCode`); quem chamou entra como `OWNER`                                                       |
| `GET /users/me/campaigns`                                                         | `{items: [...]}`: as campanhas de que o usuário participa                                                                                     |
| `POST /campaigns/join` `{joinCode}`                                               | 201 ao entrar, 200 se já participava (não duplica nem rebaixa o dono); 404 `JOIN_CODE_NOT_FOUND`                                              |
| `GET /campaigns/{campaignId}`                                                     | campanha + `members` (dono primeiro) + `recentActivity`; 403 `NOT_A_MEMBER`; 404 `CAMPAIGN_NOT_FOUND`                                         |
| `GET /campaigns/{campaignId}/members`                                             | `{items: [...]}`, só para participantes                                                                                                       |
| `PUT /campaigns/{campaignId}/members/me/character` `{characterId, characterName}` | personagem que o usuário usa na campanha; 409 `CHARACTER_IN_USE` se outro participante já usa                                                 |
| `DELETE /campaigns/{campaignId}/members/{userId}`                                 | 204. O jogador sai (o próprio userId) ou o dono remove um jogador; 403 `NOT_CAMPAIGN_OWNER`; 409 `OWNER_CANNOT_LEAVE`; 404 `MEMBER_NOT_FOUND` |

Ids seguem `^[A-Za-z0-9_-]{1,64}$`, o código de entrada `^\d{6}$`; textos têm de 1 a 80
caracteres. Fora disso: 422 `VALIDATION_ERROR` com `details[].field`. Erros usam o formato
`{"error": {"code", "message", "details"}}`.

## 4. Consumo de `ItemAcquired`

Fila `campaigns.activity.v1` (ligada a `rpg.events` / `item.acquired.v1`), com `.retry` e `.dlq`
criadas pelo Terraform ([`infra/terraform`](../../infra/terraform)). O evento é validado com os JSON Schemas de [`contracts/`](../../contracts)
e gravado numa **transação** do DynamoDB (tudo ou nada):

1. inbox: `messageId` ainda não processado;
2. a campanha existe;
3. marcador da operação: `operationId` ainda não contado;
4. grava a atividade;
5. soma `quantity` no participante que usa o `characterId` (se nenhum participante escolheu esse
   personagem, só a atividade é gravada; se ele trocou de personagem no meio, a mensagem vai para o retry).

| Situação                                           | Resultado          | O que acontece com a mensagem                                                         |
| -------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| Tudo certo                                         | `applied`          | ack                                                                                   |
| Mesmo `messageId` de novo (reentrega)              | `duplicate`        | ack, nada muda                                                                        |
| Mesmo `operationId` com outro `messageId`          | `duplicate`        | ack, nada muda                                                                        |
| Campanha não cadastrada                            | `unknown-campaign` | ack + log de aviso com o `campaignId`                                                 |
| DynamoDB fora                                      | —                  | fila `.retry` com espera de 1 s, 2 s, 4 s (header `x-retry-count`); depois da 3ª, DLQ |
| Mensagem inválida (não é JSON ou fora do contrato) | —                  | direto para a DLQ                                                                     |

O consumidor reconecta sozinho se o RabbitMQ cair, e réplicas dividem a mesma fila (`prefetch`
configurável).

Chamadas ao DynamoDB têm limite de tempo (5 s por tentativa): um banco travado vira falha e a
mensagem vai para o retry, em vez de ficar presa. Um erro inesperado (por exemplo, não conseguir
publicar no retry) devolve a mensagem à fila depois de 1 s, sem perdê-la.

## 5. Eventos publicados (outbox)

| Evento                  | Routing key                  | Quando                                                        |
| ----------------------- | ---------------------------- | ------------------------------------------------------------- |
| `CampaignCreated`       | `campaign.created.v1`        | ao criar a campanha                                           |
| `CampaignMemberJoined`  | `campaign.member.joined.v1`  | ao criar (o dono, `OWNER`) e ao entrar pelo código (`PLAYER`) |
| `CampaignMemberRemoved` | `campaign.member.removed.v1` | ao sair (`LEFT`) ou ser removido pelo dono (`REMOVED`)        |

Os esquemas estão em [`contracts/`](../../contracts); quem consome é o S4 (`actions.history.v1`) e a
projeção de participantes do S3 (`inventory.campaign-members.v1`). Entrar de novo quem já participa,
ou uma recusa (403, 409), não gera evento.

O evento é gravado na tabela de outbox **na mesma transação** da mudança: ou os dois ficam, ou
nenhum. O relay, que roda em cada réplica, procura os pendentes a cada `OUTBOX_POLL_MS`, reserva um
lote por `OUTBOX_LEASE_MS` (assim duas réplicas não publicam o mesmo evento ao mesmo tempo), publica
cada um com confirmação do RabbitMQ e marca como publicado. Se o processo cair entre publicar e
marcar, a reserva vence e o evento sai de novo: a entrega é _at-least-once_ e quem consome descarta
repetições pelo `messageId`. Com o RabbitMQ fora, os eventos esperam na outbox e saem quando a
conexão volta.

## 6. Tabelas DynamoDB

Criadas pelo Terraform ([`infra/terraform/campaigns.tf`](../../infra/terraform/campaigns.tf)) antes de o
serviço subir, com os nomes deste `.env.example`. O script `create-tables` cria as mesmas tabelas
e serve para os testes de integração ou para um DynamoDB sem o Terraform.

| Variável           | Padrão                | Chave                                                              | Conteúdo                                                             |
| ------------------ | --------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `TABLE_CAMPAIGNS`  | `campaigns`           | `campaignId`                                                       | campanhas                                                            |
| `TABLE_JOIN_CODES` | `campaign_join_codes` | `joinCode`                                                         | códigos de entrada em uso, cada um apontando para a campanha         |
| `TABLE_MEMBERS`    | `campaign_members`    | `campaignId` + `userId`; índice `byUser` (`userId` + `campaignId`) | participantes: papel, personagem escolhido e itens conquistados      |
| `TABLE_ACTIVITY`   | `campaign_activity`   | `campaignId` + `activityKey` (`occurredAt#operationId`)            | atividade, ordenada por data                                         |
| `TABLE_OPERATIONS` | `campaign_operations` | `operationId`                                                      | operações já contadas                                                |
| `TABLE_INBOX`      | `campaign_inbox`      | `messageId`                                                        | mensagens já processadas (TTL em `expiresAt`, `INBOX_TTL_DAYS` dias) |
| `TABLE_OUTBOX`     | `campaign_outbox`     | `messageId`; índice `pending` (`pendingKey` + `pendingAt`)         | eventos a publicar (os publicados somem em `OUTBOX_TTL_DAYS` dias)   |

## 7. Variáveis de ambiente

Todas estão em [`.env.example`](.env.example), com os valores para rodar fora do Docker. No Compose,
o mesmo arquivo é carregado e os endereços (`AWS_ENDPOINT_URL`, `RABBITMQ_URL`), o `CORS_ORIGINS`,
o `CONTRACTS_DIR` e o `JWT_SECRET` (o mesmo do S4, do `.env` da raiz) são trocados pelos do Compose.

| Variável                                                                    | Padrão                                                 | Uso                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `PORT`                                                                      | `3001`                                                 | porta HTTP                                                                               |
| `CORS_ORIGINS`                                                              | `http://localhost:5173`                                | origens liberadas, separadas por vírgula                                                 |
| `AWS_ENDPOINT_URL`, `AWS_REGION`                                            | `http://localhost:4566`, `us-east-1`                   | DynamoDB (MiniStack)                                                                     |
| `TABLE_*`, `INBOX_TTL_DAYS`                                                 | ver seção 6                                            | nomes das tabelas e validade da inbox                                                    |
| `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`                                  | sem padrão, `rpg-nexus-identity`, `rpg-nexus-services` | validação do access token do S4; o segredo é o mesmo do S4 e é obrigatório               |
| `RABBITMQ_URL`                                                              | `amqp://dev:dev@localhost:5672/`                       | conexão com o RabbitMQ                                                                   |
| `RABBITMQ_EXCHANGE`                                                         | `rpg.events`                                           | exchange onde o relay e o script de publicação publicam                                  |
| `RABBITMQ_QUEUE`, `RABBITMQ_RETRY_QUEUE`                                    | `campaigns.activity.v1`, `campaigns.activity.v1.retry` | fila consumida e fila de retry                                                           |
| `RABBITMQ_PREFETCH`                                                         | `16`                                                   | mensagens em processamento ao mesmo tempo, por réplica                                   |
| `MAX_RETRIES`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS`                  | `3`, `1000`, `15000`                                   | tentativas e espera do retry                                                             |
| `OUTBOX_POLL_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_LEASE_MS`, `OUTBOX_TTL_DAYS` | `500`, `25`, `30000`, `3`                              | intervalo do relay, eventos por rodada, reserva de cada evento e validade dos publicados |
| `CONTRACTS_DIR`                                                             | `../../contracts`                                      | pasta dos JSON Schemas                                                                   |
| `TRACING_ENABLED`, `SERVICE_NAME`                                           | `false`, `campaigns`                                   | liga o envio de spans e dá o nome do serviço no Jaeger (no Compose vem `true`)           |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                               | `http://localhost:4318`                                | endereço OTLP do Jaeger                                                                  |

## 8. Tracing (OpenTelemetry)

O S1 manda spans para o Jaeger ([localhost:16686](http://localhost:16686)), no mesmo formato do S2
(W3C Trace Context), então uma operação aparece num trace só quando passa pelos dois serviços.

| O que vira span                                                                                            | Como                                   |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Cada requisição HTTP (`POST /campaigns`, `GET /campaigns/:campaignId`...), menos `/health` e `/ready`      | plugin `@fastify/otel`                 |
| Cada comando do DynamoDB (`DynamoDB PutItem`, `DynamoDB TransactWriteItems`...)                            | middleware no cliente da AWS           |
| O consumo de cada mensagem (`campaigns.activity.v1 process`), filho de quem publicou                       | `traceparent` lido dos headers AMQP    |
| A publicação do script `publish-item-acquired` (`item.acquired.v1 publish`)                                | `traceparent` escrito nos headers AMQP |
| A publicação de um evento da outbox (`campaign.created.v1 publish`...), no trace da requisição que o gerou | `traceparent` guardado com o evento    |

Uma nova tentativa (fila de retry) continua no mesmo trace; retry e DLQ marcam o span como erro.
A consulta da outbox, a cada meio segundo, não gera span.
O código fica em `src/tracing/`: `setup.ts` liga e desliga, `http.ts` cuida das rotas,
`spans.ts` do RabbitMQ e `dynamodb.ts` dos comandos do banco. Para ver na demonstração: publique uma aquisição (seção 10), abra o
Jaeger, escolha o serviço `publish-item-acquired` e clique no trace. Ele mostra a publicação e, abaixo,
o consumo no S1 e no S2, cada um com suas chamadas ao DynamoDB.

## 9. Desenvolvimento e testes

```sh
npm ci
npm test                 # unitários (sem Docker)
npm run typecheck
npm run build

# integração: precisa de um MiniStack (cada teste cria tabelas com nome aleatório)
docker run -d --rm --name ms-test -p 127.0.0.1:34566:4566 ministackorg/ministack:latest
AWS_ENDPOINT_URL=http://localhost:34566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test npm run test:integration
docker stop ms-test
```

Para rodar fora do Docker com a pilha do Compose no ar (as tabelas e filas já existem):
`cp .env.example .env`, `npm run build` e `npm start` (com as variáveis do `.env` carregadas no shell).

## 10. Demonstração: idempotência

Com a pilha no ar (`docker compose up --build --detach --wait` na raiz):

```sh
# 1. cadastrar a campanha c1
curl -X POST localhost:3001/campaigns -H 'content-type: application/json' \
  -d '{"name": "A Coroa de Cinzas", "campaignId": "c1"}'

# 2. a mesma mensagem duas vezes (reentrega) e a mesma operação com outro messageId
pub() { docker compose exec campaigns node dist/scripts/publish-item-acquired.js "$@"; }
pub --campaign c1 --character ch1 --item espada --item-name "Espada Rúnica" --quantity 2 \
    --message-id 6f1c2d3e-4a5b-4c6d-8e7f-901234567890 --operation op-demo
pub --campaign c1 --character ch1 --item espada --item-name "Espada Rúnica" --quantity 2 \
    --message-id 6f1c2d3e-4a5b-4c6d-8e7f-901234567890 --operation op-demo
pub --campaign c1 --character ch1 --item espada --item-name "Espada Rúnica" --quantity 2 --operation op-demo

# 3. resultado: ch1 com itemsAcquired 2 e uma única atividade
curl localhost:3001/campaigns/c1

# 4. campanha não cadastrada: ack com aviso no log, nada fica na fila
pub --campaign nao-existe --character ch1 --item espada
docker compose logs campaigns | grep unknown_campaign
```

## 11. Demonstração: réplicas na mesma fila

`campaigns-worker` é o mesmo serviço sem porta no host. Ele e o `campaigns` consomem a mesma fila
`campaigns.activity.v1`, e o RabbitMQ entrega cada mensagem a um só deles.

```sh
# 1. três consumidores: campaigns + 2 réplicas (rabbitmqctl mostra 3 na coluna consumers)
docker compose up -d --wait --scale campaigns-worker=2
docker compose exec rabbitmq rabbitmqctl list_queues name consumers

# 2. campanha r4, 20 aquisições diferentes e a mesma mensagem 5 vezes, tudo em paralelo
curl -X POST localhost:3001/campaigns -H 'content-type: application/json' \
  -d '{"name": "Réplicas", "campaignId": "r4"}'
pub() { docker compose exec -T campaigns node dist/scripts/publish-item-acquired.js "$@"; }
for i in $(seq 1 20); do pub --campaign r4 --character ch1 --item "item-$i" & done; wait
for i in 1 2 3 4 5; do
  pub --campaign r4 --character ch2 --item escudo --operation op-dup \
      --message-id 11111111-2222-4333-8444-555555555555 &
done; wait

# 3. quem processou o quê: a carga se divide e a mensagem repetida é aplicada uma vez só
docker compose logs campaigns campaigns-worker | grep campaigns.activity.processed \
  | sed -E 's/^([a-z0-9-]+) .*"result":"([a-z-]+)".*/\1 \2/' | sort | uniq -c

# 4. resultado: ch1 com itemsAcquired 20 e ch2 com 1
curl localhost:3001/campaigns/r4
```

Num teste com três consumidores, cada um aplicou 7 mensagens; das cinco cópias da mensagem
repetida, uma foi aplicada e as outras quatro, em réplicas diferentes, deram `duplicate`.

Não há efeito duplicado porque a gravação é uma transação condicional no DynamoDB (seção 4): duas
réplicas com a mesma mensagem disputam a mesma linha da inbox, e só uma transação passa.

**Ordenação.** Com várias réplicas (e com o retry, que devolve a mensagem para o fim da fila), as
mensagens podem ser processadas fora da ordem de publicação. O S1 não depende dessa ordem:

- o contador `itemsAcquired` é uma soma, e a ordem das somas não muda o total;
- a atividade é ordenada por `occurredAt`, a data do evento, e não pela ordem de chegada;
- se o evento chega antes de o personagem entrar na campanha, o participante é criado sem nome, e o
  `POST /members` depois só completa o nome, mantendo o contador.
