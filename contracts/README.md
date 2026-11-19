# Contratos de eventos

Todo evento publicado no RabbitMQ usa o envelope de `envelope.schema.json` (JSON Schema draft
2020-12), e cada tipo de evento tem o próprio esquema em `events/`, com um exemplo válido e um
inválido em `examples/`.

## Envelope

| Campo | Regra |
| --- | --- |
| `messageId` | UUID gerado a cada evento novo. Um reenvio da outbox mantém o mesmo; é por ele que o consumidor descarta duplicatas. |
| `correlationId` | Liga os eventos de uma mesma operação. No fluxo de aquisição é o `operationId` da Saga. |
| `type` | `rpg.<domínio>.<evento>.v<versão>`, por exemplo `rpg.item.acquired.v1`. |
| `version` | Inteiro positivo, igual ao sufixo de `type`. |
| `occurredAt` | Instante do evento em `date-time` com fuso (`Z` ou `±hh:mm`). |
| `payload` | Dados do evento, definidos no esquema do tipo. |

Todos os campos são obrigatórios e nenhum outro é aceito no envelope. Dentro do `payload`, campos
extras são permitidos: quem consome ignora o que não conhece.

## Eventos

Todos passam pelo exchange `rpg.events` (tipo `topic`). As filas ficam em
`infra/rabbitmq/definitions.json`.

| Evento | Routing key | Produz | Consome (fila) |
| --- | --- | --- | --- |
| `CharacterValidationRequested` | `character.validation.requested.v1` | S3 Inventário | S2 (`characters.validation-requested.v1`) |
| `CharacterValidated` | `character.validated.v1` | S2 Personagens | S3 (`inventory.saga-replies.v1`) |
| `CharacterRejected` | `character.rejected.v1` | S2 Personagens | S3 (`inventory.saga-replies.v1`) |
| `ExternalValidationRequested` | `external.validation.requested.v1` | S3 Inventário | S4 (`actions.validation-requested.v1`) |
| `ExternalValidationSucceeded` | `external.validation.succeeded.v1` | S4 Ações | S3 (`inventory.saga-replies.v1`) |
| `ExternalValidationFailed` | `external.validation.failed.v1` | S4 Ações | S3 (`inventory.saga-replies.v1`) |
| `ItemAcquired` | `item.acquired.v1` | S3 Inventário | S1 (`campaigns.activity.v1`), S2 (`characters.acquisition-outcomes.v1`), S4 (`actions.history.v1`) |
| `AcquisitionCancelled` | `acquisition.cancelled.v1` | S3 Inventário | S2 (`characters.acquisition-outcomes.v1`), S4 (`actions.history.v1`) |
| `MoneyDebitRequested` | `money.debit.requested.v1` | S3 Inventário | S2 (`characters.money-commands.v1`) |
| `MoneyDebitRejected` | `money.debit-rejected.v1` | S2 Personagens | S3 (`inventory.saga-replies.v1`) |
| `MoneyDebited` | `money.debited.v1` | S2 Personagens | S3 (`inventory.saga-replies.v1`) |
| `MoneyRefundRequested` | `money.refund.requested.v1` | S3 Inventário | S2 (`characters.money-commands.v1`) |
| `MoneyRefunded` | `money.refunded.v1` | S2 Personagens | S3 (`inventory.saga-replies.v1`) |
| `ShopItemPurchased` | `shop.item.purchased.v1` | S3 Inventário | S1 (`campaigns.activity.v1`), S4 (`actions.history.v1`) |
| `CampaignCreated` | `campaign.created.v1` | S1 Campanhas | S3 (`inventory.campaign-members.v1`), S4 (`actions.history.v1`) |
| `CampaignMemberJoined` | `campaign.member.joined.v1` | S1 Campanhas | S3 (`inventory.campaign-members.v1`), S4 (`actions.history.v1`) |
| `CampaignMemberRemoved` | `campaign.member.removed.v1` | S1 Campanhas | S3 (`inventory.campaign-members.v1`), S4 (`actions.history.v1`) |

Os payloads da aquisição têm `operationId`, `campaignId`, `characterId`, `itemId` e `quantity`. Os
campos próprios de cada evento estão descritos no esquema dele. O S3 publica `AcquisitionCancelled` sempre
que uma Saga que já pediu a validação do personagem termina sem entregar o item: é esse evento que
faz o S2 devolver o espaço reservado na mochila.

Os eventos de campanha usam `correlationId = campaignId` e saem da outbox do S1, gravados na mesma
transação da mudança. Criar uma campanha publica `CampaignCreated` e também `CampaignMemberJoined`
do dono (`role = OWNER`), então quem projeta participantes só precisa tratar entrada e saída. Entrar
de novo quem já participa não gera evento. A fila `inventory.campaign-members.v1` é para a projeção
de participantes do S3: as mensagens ficam guardadas nela até o S3 começar a consumir.

## Mudanças

A versão é mantida por `type`. Crie uma versão nova (`.v2`, com esquema e routing key próprios)
quando a mudança quebrar quem consome: remover ou renomear campos, mudar tipos ou significados, ou
tornar obrigatório um campo novo. Campo opcional novo mantém a versão. As duas versões convivem até
todos os consumidores migrarem e as mensagens antigas acabarem.

Uma routing key nova precisa de uma fila em `infra/rabbitmq/definitions.json`; senão o RabbitMQ
descarta a mensagem em silêncio. O teste abaixo confere isso.

## Rastreamento (tracing)

O contexto de trace **não** faz parte do envelope. Ele viaja nos headers AMQP da mensagem, no padrão W3C
Trace Context (`traceparent` e `tracestate`).

## Validação

Com Node.js instalado, dentro de `contracts/`:

```sh
npm ci
npm test
```

Sem Node.js, usando Docker a partir da raiz do repositório:

```sh
docker run --rm -v "$PWD:/repo" -w /repo/contracts node:24-alpine sh -c "npm ci && npm test"
```

O teste (`validate.mjs`, com Ajv e `ajv-formats`) termina com status 0 somente quando:

1. cada esquema aceita o exemplo válido e recusa o inválido, e um exemplo de versão desconhecida
   passa no envelope mas é recusado pela v1;
2. cada routing key chega a pelo menos uma fila, e as filas citadas em `x-routing.consumers` existem
   e recebem essa routing key;
3. toda ligação do `definitions.json` corresponde a um evento com esquema;
4. toda fila de consumo tem `.retry` e `.dlq` com os argumentos esperados;
5. as filas declaradas nos manifestos dos serviços (`infra/manifests/*.json`) são iguais às do
   `definitions.json`, já que o RabbitMQ recusa declarar uma fila existente com outros argumentos.
