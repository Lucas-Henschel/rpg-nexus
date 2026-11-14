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

A versão é mantida por `type`. Incremente `version` quando uma mudança quebrar
consumidores existentes, como remover/renomear campos, mudar tipos ou significados
ou adicionar campos obrigatórios. Campos opcionais aditivos podem manter a versão
se os consumidores aceitarem campos desconhecidos. Versões incompatíveis coexistem
com esquemas separados por versão; produtores e consumidores usam o par
`type`/`version` para rotear e validar mensagens. Mantenha a versão anterior até
migrar seus consumidores e processar as mensagens pendentes.

Após `pnpm install`, execute na raiz:

```sh
pnpm validate:contracts
```

A validação usa Ajv para draft 2020-12 e `ajv-formats` para conferir UUIDs e
datas. O comando termina com status 0 somente quando
`examples/event-envelope.valid.json` é aceito e
`examples/event-envelope.invalid.json` é rejeitado. O exemplo inválido omite
`messageId`; o tipo e o payload dos exemplos são apenas ilustrativos.

Os scripts `pnpm dev`, `pnpm dev:detached` e `pnpm down` controlam o
Docker Compose definido na raiz do repositório.
