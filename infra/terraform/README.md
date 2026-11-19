# Infraestrutura como código (Terraform)

Toda a infraestrutura do projeto é criada por este Terraform, no próprio `docker compose up`. O
contêiner `terraform` espera o MiniStack e o RabbitMQ ficarem saudáveis, aplica e termina; os
serviços só sobem depois que ele termina com sucesso.

| Recurso | Nome padrão | Arquivo | Para quê |
| --- | --- | --- | --- |
| Tabela DynamoDB | `campaigns` | `campaigns.tf` | Campanhas (S1). |
| Tabela DynamoDB | `campaign_join_codes` | `campaigns.tf` | Códigos de entrada de seis dígitos em uso (S1). |
| Tabela DynamoDB | `campaign_members` | `campaigns.tf` | Participantes por usuário: papel, personagem e itens (S1); índice `byUser`. |
| Tabela DynamoDB | `campaign_activity` | `campaigns.tf` | Atividade da campanha, ordenada por data (S1). |
| Tabela DynamoDB | `campaign_operations` | `campaigns.tf` | Operações já contadas (S1). |
| Tabela DynamoDB | `campaign_inbox` | `campaigns.tf` | Mensagens já processadas (S1); TTL em `expiresAt`. |
| Tabela DynamoDB | `campaign_outbox` | `campaigns.tf` | Eventos a publicar (S1); índice `pending`, TTL em `expiresAt`. |
| Tabela DynamoDB | `characters` | `characters.tf` | Fichas e reservas da Saga (S2); índice `byCampaign`. |
| Tabela DynamoDB | `character_inbox` | `characters.tf` | Mensagens já processadas (S2); TTL em `expiresAt`. |
| Tabela DynamoDB | `character_outbox` | `characters.tf` | Eventos a publicar (S2); índice `pending`; TTL em `expiresAt`. |
| Tabela DynamoDB | `character_read_model` | `characters.tf` | Modelo de leitura (CQRS) do S2. |
| Tabela DynamoDB | `identity_users` | `identity.tf` | Usuários e credenciais protegidas do S4. |
| Tabela DynamoDB | `identity_unique_identifiers` | `identity.tf` | Unicidade de e-mail e nome de usuário do S4. |
| Tabela DynamoDB | `identity_sessions` | `identity.tf` | Sessões e refresh tokens do S4; TTL em `expiresAt`. |
| Bucket S3 | `rpg-assets` | `characters.tf` | Retratos, com CORS para o front-end. |
| Tabelas DynamoDB | `inventory_items`, `inventory_stocks`, `inventory_inventory`, `inventory_acquisition_sagas`, `inventory_inventory_inbox`, `inventory_inventory_outbox` | `inventory.tf` | Catálogo, estoque, inventário, Saga, inbox e outbox (S3); chave `id`. |
| Exchange, filas e ligações | `rpg.events`, ... | `rabbitmq.tf` | Topologia de `infra/rabbitmq/definitions.json`. |

## De onde vêm os nomes

Nada de nome fixo no Terraform:

- **tabelas:** dos mesmos arquivos de ambiente que o Compose entrega aos serviços,
  `services/campaigns/.env.example`, `services/characters/.env.example` e
  `services/identity/.env.example` (`env.tf` lê as linhas `TABLE_*`), além de
  `services/inventory/.env.example` (`INVENTORY_TABLE_PREFIX`, mais o nome de cada tabela).
  Trocar um nome ali troca no serviço e no Terraform ao mesmo tempo;
- **filas, exchange e ligações:** de `infra/rabbitmq/definitions.json`, o arquivo que o teste de
  `contracts/` confere contra os esquemas dos eventos;
- **bucket, endpoints e credenciais:** do `.env` da raiz, pelas variáveis `TF_VAR_*` que o
  `docker-compose.yml` passa ao contêiner (`variables.tf` lista todas).

Os providers são o da AWS e o do RabbitMQ (`cyrilgdn/rabbitmq`, pela API de gerenciamento). Só os
endpoints apontam para o MiniStack e para o RabbitMQ local, então o mesmo código serviria para a AWS
real.

## Recriar o ambiente do zero

Na raiz do monorepo:

```sh
docker compose down --volumes         # apaga tudo: dados, filas e estado do Terraform
docker compose up --build --wait      # o Terraform recria a infraestrutura e os serviços sobem
```

Rodar `docker compose up` de novo, com a pilha no ar ou não, não muda nada ("No changes"). Se alguém
apagar uma tabela ou uma fila, o próximo `up` (ou `docker compose run --rm terraform`) a recria.

A primeira execução baixa os providers (precisa de internet). Eles ficam guardados, junto com o
estado, no volume `terraform-state`.

### Ambiente criado antes do Terraform

Uma pilha que subiu antes desta mudança tem as tabelas e o bucket criados pelos scripts antigos, fora
do estado do Terraform. Nesse caso o `apply` falha com "already exists"/`ResourceInUseException`.
Resolva uma vez com `docker compose down --volumes` (apaga os dados locais de teste).

O mesmo acontece se só um dos volumes for apagado (por exemplo `terraform-state` sem `ministack-data`):
apague sempre os dois juntos, com `down --volumes`.

## Outros comandos

```sh
docker compose run --rm terraform plan                    # o que mudaria; "No changes" se estiver em dia
docker compose run --rm terraform output                  # nomes criados
docker compose run --rm terraform destroy -auto-approve   # apaga tudo o que o Terraform criou
```

Conferir a partir do host:

```sh
aws --endpoint-url http://localhost:4566 dynamodb list-tables
aws --endpoint-url http://localhost:4566 s3api get-bucket-cors --bucket rpg-assets
docker compose exec rabbitmq rabbitmqctl list_queues name arguments
```

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `versions.tf` | Versões, backend local e os providers AWS e RabbitMQ apontados para os endpoints. |
| `variables.tf` | Endpoints, região, credenciais fictícias, bucket e origem do CORS. |
| `env.tf` | Lê os nomes das tabelas dos `.env.example` dos serviços. |
| `campaigns.tf` | As tabelas do S1. |
| `characters.tf` | As quatro tabelas do S2, o bucket e o CORS. |
| `identity.tf` | As três tabelas do S4. |
| `rabbitmq.tf` | Exchange, filas e ligações de `definitions.json`. |
| `outputs.tf` | Nomes dos recursos criados. |

`.terraform.lock.hcl` fixa a versão exata de cada provider e é versionado.

## Fila com argumentos novos

O RabbitMQ não altera os argumentos de uma fila que já existe. Se um argumento mudar no
`definitions.json`, o Terraform apaga a fila e cria de novo, e as mensagens dela se perdem; o `plan`
mostra isso como `must be replaced`.
