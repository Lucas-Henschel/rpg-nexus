# Contratos de eventos

O arquivo `events/event-envelope.schema.json` define o envelope comum dos
eventos publicados no RabbitMQ, usando JSON Schema draft 2020-12.

| Campo | Regra |
| --- | --- |
| `messageId` | UUID que identifica a mensagem. |
| `correlationId` | UUID que correlaciona eventos de uma mesma operação. |
| `type` | String com o tipo do evento. |
| `version` | Inteiro positivo com a versão do contrato do evento. |
| `occurredAt` | Instante do evento no formato `date-time`. |
| `payload` | Objeto com os dados específicos do evento. |

Todos os seis campos são obrigatórios. O esquema do envelope verifica a
estrutura comum; os contratos de cada tipo de evento podem definir os dados
internos do `payload`. Os serviços permanecem independentes e não são membros
do workspace pnpm (`services/*` fica fora dele).

Após `pnpm install`, execute na raiz:

```sh
pnpm validate:contracts
pnpm turbo run validate:contracts
```

A validação usa Ajv para draft 2020-12 e `ajv-formats` para conferir UUIDs e
datas. O comando termina com status 0 somente quando
`examples/event-envelope.valid.json` é aceito e
`examples/event-envelope.invalid.json` é rejeitado. O exemplo inválido omite
`messageId`; o tipo e o payload dos exemplos são apenas ilustrativos.

A tarefa raiz do Turbo tem cache desabilitado para sempre executar essas
asserções. Os scripts `pnpm dev`, `pnpm dev:detached` e `pnpm down` controlam o
Docker Compose; eles dependem do arquivo Compose criado na etapa seguinte.
