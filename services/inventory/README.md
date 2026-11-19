# S3 Inventário e Saga

Serviço Java 21 / Spring Boot na porta 8080. Usa apenas tabelas `inventory_*` no DynamoDB. Além do catálogo e inventário, mantém lojas por campanha, estoque disponível/reservado, uma projeção local de membros e o histórico da Saga comercial.
Serviço Java 21 / Spring Boot na porta 8080. Usa apenas tabelas `inventory_*` no DynamoDB. RabbitMQ: exchange `rpg.events` (topic), fila `inventory.saga-replies.v1`, com `.retry` e `.dlq`. Tabelas e filas são criadas pelo Terraform (`infra/terraform/inventory.tf` e `infra/rabbitmq/definitions.json`); o serviço não declara topologia.

## Organização do código

| Pacote | Responsabilidade |
|---|---|
| `domain` | Estado da aquisição e decisão pura das transições da Saga. |
| `application` | Caso de uso de aquisição e varredura periódica de prazo. |
| `ports` | Interfaces para catálogo, Saga e outbox, sem dependência de DynamoDB ou RabbitMQ. |
| `adapters/dynamodb` | Transações de estoque/Saga/inbox/outbox e consultas persistentes. |
| `adapters/rabbitmq` | Publicação da outbox e consumo de resultados. |
| `api` | Requisições e respostas HTTP. |
| `config` | Beans para AWS e RabbitMQ. |

As regras de transição ficam em `SagaTransition`. O adaptador DynamoDB aplica cada decisão com escrita condicional e transação local; o controlador HTTP recebe apenas os modelos expostos pela aplicação e pelas portas.

## Inicialização

No monorepo, `docker compose up --build` roda o Terraform, que cria as seis tabelas do manifesto `infra/manifests/inventory.json`, e inicia o serviço na porta 8080 com as variáveis de `services/inventory/.env.example`. Para build isolado, execute `docker build -f services/inventory/Dockerfile -t rpg-inventory .` **na raiz do repositório**. Para Maven local, entre em `services/inventory` e execute `mvn spring-boot:run`, com RabbitMQ e DynamoDB já configurados. As tabelas usam chave primária `id` String e cobrança `PAY_PER_REQUEST`. Configure AWS_REGION, credenciais AWS, DYNAMODB_ENDPOINT (omita na AWS), SPRING_RABBITMQ_HOST/PORT/USERNAME/PASSWORD, INVENTORY_TABLE_PREFIX, RABBITMQ_EXCHANGE, RABBITMQ_QUEUE, RABBITMQ_RETRY_QUEUE, RETRY_BASE_DELAY_MS, SAGA_TIMEOUT_SECONDS e MAX_RETRIES. `GET /health` verifica vida do processo.

## API

- `POST /items` → `{ "itemId":"sword", "name":"Espada" }` (201).
- `GET /items` → catálogo de itens cadastrados.
- `PUT /shops/{campaignId}` com `X-User-Id` → cria ou edita a loja; somente a projeção `OWNER` pode executar.
- `GET /shops/{campaignId}` e `GET /shops/{campaignId}/items` → consulta pública da loja.
- `PUT /shops/{campaignId}/items/{itemId}` com `X-User-Id` → grava nome, descrição, preço e estoque; exige `OWNER`.
- `DELETE /shops/{campaignId}/items/{itemId}` com `X-User-Id` → remove item e estoque; exige `OWNER`.
- `POST /stocks` → endpoint legado de estoque, agora também protegido por `X-User-Id` e papel `OWNER`.
- `GET /stocks?campaignId=c1` → estoques cadastrados da campanha.
- `GET /stocks/{campaignId}/{itemId}` → saldo disponível.
- `GET /inventory/{characterId}` → itens confirmados.
- `POST /acquisitions` com `Idempotency-Key`, `X-User-Id` e `{ "campaignId":"c1", "characterId":"p1", "itemId":"sword" }` → reserva estoque, publica o pedido de débito e responde 202.
- `GET /acquisitions/{operationId}` → estado e prazo.
- `GET /acquisitions/{operationId}/history` → transições persistidas da Saga em ordem cronológica.

Quantidade fixa: 1. Uma chave de idempotência representa uma compra; reutilizá-la com outro corpo retorna 409. Usuários fora da campanha ou com outro personagem ativo recebem 403. A reserva, Saga, histórico e outbox entram na mesma transação. `MoneyDebitRejected` ou expiração devolve a unidade. Um `MoneyDebited` tardio não ressuscita a Saga e gera `MoneyRefundRequested` idempotente.

Enquanto o S4 ainda não fornece JWT, `X-User-Id` identifica o usuário para desenvolvimento. A autorização real continua no backend e usa a projeção atualizada por `CampaignCreated`, `CampaignMemberJoined` e `CampaignMemberRemoved`. O header deve ser substituído pelas claims validadas quando a integração de identidade estiver disponível.

## Integração RabbitMQ

Envelope JSON: `messageId`, `correlationId` (= operationId), `type`, `version:1`, `occurredAt`, `payload` com `operationId`, `campaignId`, `characterId`, `itemId`, `quantity:1`. O serviço publica:

| Routing key | Type |
|---|---|
| `character.validation.requested.v1` | `rpg.character.validation-requested.v1` |
| `external.validation.requested.v1` | `rpg.external.validation-requested.v1` |
| `item.acquired.v1` | `rpg.item.acquired.v1` |
| `acquisition.cancelled.v1` | `rpg.acquisition.cancelled.v1` |

Consome `character.validated.v1` / `character.rejected.v1` com types `rpg.character.validated.v1` / `rpg.character.rejected.v1`; e `external.validation.succeeded.v1` / `external.validation.failed.v1` com types `rpg.external.validation-succeeded.v1` / `rpg.external.validation-failed.v1`. Cada produtor deve publicar envelopes únicos com o mesmo `correlationId` da requisição. O consumidor confirma ACK após transação; em erro, publica uma cópia na fila `.retry` com contador `x-inventory-attempt` e espera crescente (RETRY_BASE_DELAY_MS, dobrando a cada tentativa), e ao chegar em MAX_RETRIES recusa sem requeue, o que leva a mensagem à `.dlq`. O worker de outbox usa publisher confirms e retenta eventos pendentes. Duplicações entre confirmação do broker e marcação `PUBLISHED` são esperadas: consumidores devem usar inbox.

O fluxo monetário publica `MoneyDebitRequested`, `MoneyRefundRequested` e `ShopItemPurchased`; consome `MoneyDebited`, `MoneyDebitRejected` e `MoneyRefunded`. Por compatibilidade, a conclusão e o cancelamento ainda publicam `ItemAcquired` e `AcquisitionCancelled`. Os schemas ficam em `contracts/events/`.
O evento `CharacterValidationRequested` inclui `deadlineAt`, necessário para o S2 não reservar capacidade após o prazo. O `AcquisitionCancelled` leva `reason`: `CHARACTER_REJECTED`, `EXTERNAL_VALIDATION_FAILED` ou `DEADLINE_EXPIRED`. O S2 já reconhece os eventos `ItemAcquired` e `AcquisitionCancelled`; o S4 ainda deve implementar sua fila para a validação externa. Os schemas dos eventos publicados pelo Inventário estão em `contracts/events/`.
