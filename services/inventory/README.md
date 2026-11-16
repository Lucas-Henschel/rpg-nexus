# S3 Inventário e Saga

Serviço Java 21 / Spring Boot na porta 8080. Usa apenas tabelas `inventory_*` no DynamoDB. RabbitMQ: exchange `rpg.events` (topic), fila própria `rpg.inventory.results.v1`, fila morta `rpg.inventory.results.dlq.v1`.

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

No monorepo, `docker compose up --build` cria as seis tabelas do manifesto `infra/manifests/inventory.json` e inicia o serviço na porta 8080. Para build isolado, execute `docker build -f services/inventory/Dockerfile -t rpg-inventory .` **na raiz do repositório**. Para Maven local, entre em `services/inventory` e execute `mvn spring-boot:run`, com RabbitMQ e DynamoDB já configurados. As tabelas usam chave primária `id` String e cobrança `PAY_PER_REQUEST`. Configure AWS_REGION, credenciais AWS, DYNAMODB_ENDPOINT (omita na AWS), SPRING_RABBITMQ_HOST/PORT/USERNAME/PASSWORD, INVENTORY_TABLE_PREFIX, SAGA_TIMEOUT_SECONDS e MAX_RETRIES. `GET /health` verifica vida do processo.

## API

- `POST /items` → `{ "itemId":"sword", "name":"Espada" }` (201).
- `GET /items` → catálogo de itens cadastrados.
- `POST /stocks` → `{ "campaignId":"c1", "itemId":"sword", "available":10 }` (201); evita sobrescrever estoque já criado.
- `GET /stocks?campaignId=c1` → estoques cadastrados da campanha.
- `GET /stocks/{campaignId}/{itemId}` → saldo disponível.
- `GET /inventory/{characterId}` → itens confirmados.
- `POST /acquisitions` com `Idempotency-Key: chave-unica` e `{ "campaignId":"c1", "characterId":"p1", "itemId":"sword" }` → 202 `{ "operationId":"...", "statusUrl":"/acquisitions/..." }`.
- `GET /acquisitions/{operationId}` → estado e prazo.

Quantidade fixa: 1. Uma chave de idempotência representa uma aquisição; reutilizá-la com outro corpo retorna 409. Estoque esgotado gera operação `REJECTED` ainda consultável pelo mesmo ID. A reserva, Saga e outbox entram na mesma transação. Resultados do broker são aplicados com inbox, versão otimista e transação local. Falha ou prazo expirado devolve a unidade em uma única transação com a mudança terminal e evento de cancelamento. Mensagens tardias ou fora de ordem são registradas na inbox sem alterar a Saga.

## Integração RabbitMQ

Envelope JSON: `messageId`, `correlationId` (= operationId), `type`, `version:1`, `occurredAt`, `payload` com `operationId`, `campaignId`, `characterId`, `itemId`, `quantity:1`. O serviço publica:

| Routing key | Type |
|---|---|
| `character.validation.requested.v1` | `rpg.character.validation-requested.v1` |
| `external.validation.requested.v1` | `rpg.external.validation-requested.v1` |
| `item.acquired.v1` | `rpg.item.acquired.v1` |
| `acquisition.cancelled.v1` | `rpg.acquisition.cancelled.v1` |

Consome `character.validated.v1` / `character.rejected.v1` com types `rpg.character.validated.v1` / `rpg.character.rejected.v1`; e `external.validation.succeeded.v1` / `external.validation.failed.v1` com types `rpg.external.validation.succeeded.v1` / `rpg.external.validation.failed.v1`. Cada produtor deve publicar envelopes únicos com o mesmo `correlationId` da requisição. O consumidor confirma ACK após transação; erros são republicados com contador `x-inventory-attempt` até MAX_RETRIES e enviados à DLQ. O worker de outbox usa publisher confirms e retenta eventos pendentes. Duplicações entre confirmação do broker e marcação `PUBLISHED` são esperadas: consumidores devem usar inbox.

O evento `CharacterValidationRequested` inclui `deadlineAt`, necessário para o S2 não reservar capacidade após o prazo. O S2 já reconhece os eventos `ItemAcquired` e `AcquisitionCancelled`; o S4 ainda deve implementar sua fila para a validação externa. Os schemas dos eventos publicados pelo Inventário estão em `contracts/events/`.
