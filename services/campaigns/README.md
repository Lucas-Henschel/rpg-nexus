# S1 — Campanhas (Node.js · TypeScript · Fastify)

> RPG Nexus · Sistemas Distribuídos — FURB · Dono: **P1**

Microsserviço das **campanhas** de RPG: cadastro, participantes e um resumo do que cada personagem
conquistou. Usa **DynamoDB** (tabelas exclusivas) e consome o evento **`ItemAcquired`** do
**RabbitMQ**.

## 1. Responsabilidades

| Faz                                                                           | Não faz                                                                 |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Criar e listar campanhas, com código informado (`c1`) ou gerado (UUID)        | Validar personagens no S2 (o front lista só os personagens da campanha) |
| Adicionar participantes e trocar o nome deles                                 | Participar da Saga de aquisição (é do S3 Inventário)                    |
| Consumir `ItemAcquired`: registrar a atividade e somar itens por participante | Publicar eventos                                                        |
| Mostrar a campanha com participantes e as últimas 20 atividades               | Ler tabelas de outros serviços                                          |

## 2. Organização do código

```
src/
  config.ts              variáveis de ambiente (zod), com os padrões do ambiente local
  server.ts              liga tudo: repositórios → serviço → HTTP e consumidor
  domain/                tipos e erros do negócio
  db/                    infraestrutura do DynamoDB: conexão, nomes e criação das tabelas
  repositories/          um repositório por tabela; só lê e grava
  services/campaigns.ts  regras (campanha precisa existir, monta a página, gera o código)
  http/                  rotas, formatos aceitos (schemas.ts) e tratamento de erros
  messaging/             consumo do RabbitMQ: validação, decisão de retry e o consumidor
  scripts/               create-tables e publish-item-acquired
  tracing/               OpenTelemetry: setup, spans HTTP, de mensagens e do DynamoDB
```

Rotas e consumidor só falam com o **serviço**; o serviço é quem usa os repositórios.

## 3. HTTP

| Rota                                                                  | Resposta                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /health`                                                         | `{status: "ok"}`                                                                                    |
| `GET /ready`                                                          | 200 `ready` ou 503 `degraded`, com `checks.dynamodb` e `checks.rabbitmq`                            |
| `POST /campaigns` `{name, gameMaster?, campaignId?}`                  | 201 com a campanha; 409 `CAMPAIGN_ALREADY_EXISTS` se o código já existe                             |
| `GET /campaigns`                                                      | `{items: [...]}`                                                                                    |
| `GET /campaigns/{campaignId}`                                         | campanha + `members` + `recentActivity`; 404 `CAMPAIGN_NOT_FOUND`                                   |
| `POST /campaigns/{campaignId}/members` `{characterId, characterName}` | 201 se novo, 200 se já participava (troca o nome e mantém o contador); 404 se a campanha não existe |

Códigos seguem `^[A-Za-z0-9_-]{1,64}$`; textos têm de 1 a 80 caracteres. Fora disso: 422
`VALIDATION_ERROR` com `details[].field`. Erros usam o formato `{"error": {"code", "message", "details"}}`.

## 4. Consumo de `ItemAcquired`

Fila `campaigns.activity.v1` (ligada a `rpg.events` / `item.acquired.v1`), com `.retry` e `.dlq`
criadas pelo Terraform ([`infra/terraform`](../../infra/terraform)). O evento é validado com os JSON Schemas de [`contracts/`](../../contracts)
e gravado numa **transação** do DynamoDB (tudo ou nada):

1. inbox: `messageId` ainda não processado;
2. a campanha existe;
3. marcador da operação: `operationId` ainda não contado;
4. grava a atividade;
5. soma `quantity` no participante (cria o participante, sem nome, se ele ainda não existe).

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

## 5. Tabelas DynamoDB

Criadas pelo Terraform ([`infra/terraform/campaigns.tf`](../../infra/terraform/campaigns.tf)) antes de o
serviço subir, com os nomes deste `.env.example`. O script `create-tables` cria as mesmas tabelas
e serve para os testes de integração ou para um DynamoDB sem o Terraform.

| Variável           | Padrão                | Chave                                                   | Conteúdo                                                             |
| ------------------ | --------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `TABLE_CAMPAIGNS`  | `campaigns`           | `campaignId`                                            | campanhas                                                            |
| `TABLE_MEMBERS`    | `campaign_members`    | `campaignId` + `characterId`                            | participantes e itens conquistados                                   |
| `TABLE_ACTIVITY`   | `campaign_activity`   | `campaignId` + `activityKey` (`occurredAt#operationId`) | atividade, ordenada por data                                         |
| `TABLE_OPERATIONS` | `campaign_operations` | `operationId`                                           | operações já contadas                                                |
| `TABLE_INBOX`      | `campaign_inbox`      | `messageId`                                             | mensagens já processadas (TTL em `expiresAt`, `INBOX_TTL_DAYS` dias) |

## 6. Variáveis de ambiente

Todas estão em [`.env.example`](.env.example), com os valores para rodar fora do Docker. No Compose,
o mesmo arquivo é carregado e os endereços (`AWS_ENDPOINT_URL`, `RABBITMQ_URL`), o `CORS_ORIGINS`
e o `CONTRACTS_DIR` são trocados pelos da rede Compose.

| Variável                                                   | Padrão                                                 | Uso                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `PORT`                                                     | `3001`                                                 | porta HTTP                                                                     |
| `CORS_ORIGINS`                                             | `http://localhost:5173`                                | origens liberadas, separadas por vírgula                                       |
| `AWS_ENDPOINT_URL`, `AWS_REGION`                           | `http://localhost:4566`, `us-east-1`                   | DynamoDB (MiniStack)                                                           |
| `TABLE_*`, `INBOX_TTL_DAYS`                                | ver seção 5                                            | nomes das tabelas e validade da inbox                                          |
| `RABBITMQ_URL`                                             | `amqp://dev:dev@localhost:5672/`                       | conexão com o RabbitMQ                                                         |
| `RABBITMQ_EXCHANGE`                                        | `rpg.events`                                           | exchange usada pelo script de publicação                                       |
| `RABBITMQ_QUEUE`, `RABBITMQ_RETRY_QUEUE`                   | `campaigns.activity.v1`, `campaigns.activity.v1.retry` | fila consumida e fila de retry                                                 |
| `RABBITMQ_PREFETCH`                                        | `16`                                                   | mensagens em processamento ao mesmo tempo, por réplica                         |
| `MAX_RETRIES`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS` | `3`, `1000`, `15000`                                   | tentativas e espera do retry                                                   |
| `CONTRACTS_DIR`                                            | `../../contracts`                                      | pasta dos JSON Schemas                                                         |
| `TRACING_ENABLED`, `SERVICE_NAME`                          | `false`, `campaigns`                                   | liga o envio de spans e dá o nome do serviço no Jaeger (no Compose vem `true`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                              | `http://localhost:4318`                                | endereço OTLP do Jaeger                                                        |

## 7. Tracing (OpenTelemetry)

O S1 manda spans para o Jaeger ([localhost:16686](http://localhost:16686)), no mesmo formato do S2
(W3C Trace Context), então uma operação aparece num trace só quando passa pelos dois serviços.

| O que vira span                                                                                       | Como                                   |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Cada requisição HTTP (`POST /campaigns`, `GET /campaigns/:campaignId`...), menos `/health` e `/ready` | plugin `@fastify/otel`                 |
| Cada comando do DynamoDB (`DynamoDB PutItem`, `DynamoDB TransactWriteItems`...)                       | middleware no cliente da AWS           |
| O consumo de cada mensagem (`campaigns.activity.v1 process`), filho de quem publicou                  | `traceparent` lido dos headers AMQP    |
| A publicação do script `publish-item-acquired` (`item.acquired.v1 publish`)                           | `traceparent` escrito nos headers AMQP |

Uma nova tentativa (fila de retry) continua no mesmo trace; retry e DLQ marcam o span como erro.
O código fica em `src/tracing/`: `setup.ts` liga e desliga, `http.ts` cuida das rotas,
`spans.ts` do RabbitMQ e `dynamodb.ts` dos comandos do banco. Para ver na demonstração: publique uma aquisição (seção 9), abra o
Jaeger, escolha o serviço `publish-item-acquired` e clique no trace. Ele mostra a publicação e, abaixo,
o consumo no S1 e no S2, cada um com suas chamadas ao DynamoDB.

## 8. Desenvolvimento e testes

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

## 9. Demonstração: idempotência

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
