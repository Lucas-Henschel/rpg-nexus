# RabbitMQ local

O serviço `rabbitmq` usa a imagem Management, com AMQP em `localhost:5672` e
painel em [localhost:15672](http://localhost:15672). As portas são configuráveis
por `RABBITMQ_PORT` e `RABBITMQ_MANAGEMENT_PORT` e são publicadas somente no host
local. Na rede Compose, futuros serviços usarão `rabbitmq:5672`.

`RABBITMQ_USER` e `RABBITMQ_PASSWORD` têm o valor fictício `dev` por padrão.
O usuário inicial é criado quando o volume está vazio; alterar as variáveis não
altera automaticamente um usuário já persistido.

O volume nomeado `rabbitmq-data`, com prefixo do projeto Compose, guarda os
dados em `/var/lib/rabbitmq`. O hostname estável `rabbitmq` mantém a identidade
do nó após recriar o contêiner. O health check executa
`rabbitmq-diagnostics -q check_port_listener 15672`: só passa quando a API de gerenciamento,
usada pelo Terraform, já está aberta. O serviço participa da rede `rpg` do projeto.

Valide a definição a partir da raiz, mesmo sem `.env`:

```sh
docker compose --env-file .env.example config --quiet
```

A entrada principal do ambiente é `docker compose up`; `docker compose down` encerra os contêineres
preservando os volumes.

## Topologia

`definitions.json` declara o exchange `rpg.events` (tipo `topic`), as filas e as ligações. Quem
cria tudo isso é o Terraform ([`infra/terraform/rabbitmq.tf`](../terraform/rabbitmq.tf)), que lê
este arquivo e fala com a API de gerenciamento. Rodar de novo não muda nada, e uma fila apagada é
recriada.

Cada serviço tem uma fila por assunto, e as réplicas do mesmo serviço dividem essa fila. Toda fila
de consumo `Q` vem com:

| Fila | Para quê |
| --- | --- |
| `Q` | Recebe os eventos. Mensagem recusada sem reenvio vai para `Q.dlq`. |
| `Q.retry` | Sem consumidores. O serviço publica ali com TTL por mensagem (o tempo de espera); ao expirar, a mensagem volta para `Q`. |
| `Q.dlq` | Mensagens que esgotaram as tentativas, para inspeção no painel. |

| Fila | Serviço | Routing keys |
| --- | --- | --- |
| `campaigns.activity.v1` | S1 Campanhas | `item.acquired.v1` |
| `characters.validation-requested.v1` | S2 Personagens | `character.validation.requested.v1` |
| `characters.acquisition-outcomes.v1` | S2 Personagens | `item.acquired.v1`, `acquisition.cancelled.v1` |
| `inventory.saga-replies.v1` | S3 Inventário | `character.validated.v1`, `character.rejected.v1`, `external.validation.succeeded.v1`, `external.validation.failed.v1` |
| `actions.validation-requested.v1` | S4 (`identity-validator`) | `external.validation.requested.v1` |
| `characters.money-commands.v1` | S2 Personagens | `money.debit.requested.v1`, `money.refund.requested.v1` |
| `actions.history.v1` | S4 (`identity`) | `campaign.created.v1`, `campaign.member.joined.v1`, `campaign.member.removed.v1`, `shop.item.purchased.v1`, `item.acquired.v1`, `acquisition.cancelled.v1` |

Um serviço que usa o RabbitMQ deve esperar a topologia no Compose:

```yaml
depends_on:
  terraform:
    condition: service_completed_successfully
```

Isso também mantém o `docker compose up --wait` funcionando: ele aceita contêineres que terminam
somente quando algum serviço contínuo depende deles.

Se um serviço também declara as próprias filas ao subir, os argumentos precisam ser iguais aos do
`definitions.json`, ou o RabbitMQ recusa a declaração. O teste de `contracts/` compara as filas dos
manifestos em `infra/manifests/` com este arquivo.

Para aplicar de novo depois de editar o arquivo:

```sh
docker compose run --rm terraform
```

Mudar os argumentos de uma fila que já existe faz o Terraform apagá-la e criá-la de novo (o RabbitMQ
não altera argumentos), e as mensagens dela se perdem.


## Inspeção e replay seguro da DLQ do histórico

A ferramenta do S4 inspeciona sem remover mensagens:

```powershell
cd services/identity
npm run dlq -- inspect
```

O replay exige uma lista explícita de tipos e publica diretamente na fila
`actions.history.v1`, evitando duplicar o evento nos outros serviços:

```powershell
npm run dlq -- replay --types=rpg.campaign.created.v1,rpg.campaign.member.joined.v1
```

Somente mensagens que passam pela validação mínima e pertencem aos tipos escolhidos
são confirmadas na DLQ. As demais são recolocadas. Os eventos antigos
`AcquisitionCancelled` sem `reason` permanecem preservados e não devem ser
corrigidos por suposição; para removê-los ou enriquecê-los é necessária uma decisão
operacional explícita baseada na causa real de cada aquisição.

Use `--count=100`, `--source=<fila.dlq>` e `--target=<fila>` para ajustar o lote
e as filas. O comando usa `RABBITMQ_URL`; a inspeção também usa
`RABBITMQ_MANAGEMENT_URL` (padrão `http://localhost:15672`).
