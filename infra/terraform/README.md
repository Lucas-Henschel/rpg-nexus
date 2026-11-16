# Infraestrutura como código (Terraform)

Recria do zero, no MiniStack, os recursos de nuvem do serviço de Personagens:

| Recurso | Nome padrão | Para quê |
| --- | --- | --- |
| Tabela DynamoDB | `characters` | Fichas e reservas da Saga; índice `byCampaign`. |
| Tabela DynamoDB | `character_inbox` | Mensagens já processadas (idempotência); TTL em `expiresAt`. |
| Tabela DynamoDB | `character_outbox` | Eventos a publicar; índice `pending`; TTL em `expiresAt`. |
| Tabela DynamoDB | `character_read_model` | Modelo de leitura (CQRS): resumo por personagem, consultado por campanha. |
| Bucket S3 | `rpg-assets` | Retratos, com CORS para o front-end. |

A definição espelha `infra/manifests/characters.json`. O provider é o da AWS; só o endpoint aponta
para o MiniStack, então o mesmo código serviria para a AWS real.

## Recriar o ambiente do zero

Na raiz do monorepo:

```sh
docker compose down --volumes                     # apaga tudo: dados, filas e estado do Terraform
docker compose --profile iac run --rm terraform   # sobe o MiniStack e aplica o Terraform
docker compose up --build --detach --wait         # sobe o resto da pilha
```

O Terraform precisa rodar **antes** do restante da pilha. Os inicializadores (`aws-init` e
`characters-init`) são idempotentes: encontram o bucket e as tabelas já criados e seguem em frente.
Se a pilha já subiu antes, os recursos já existem fora do estado do Terraform e o `apply` falha com
"já existe"; nesse caso comece pelo `down --volumes`.

A primeira execução baixa o provider da AWS (precisa de internet e leva alguns minutos). Ele fica
guardado, junto com o estado, no volume `terraform-state`.

## Outros comandos

```sh
docker compose --profile iac run --rm terraform plan              # o que mudaria; "No changes" se estiver em dia
docker compose --profile iac run --rm terraform output            # nomes criados
docker compose --profile iac run --rm terraform destroy -auto-approve
```

Conferir no MiniStack, a partir do host:

```sh
aws --endpoint-url http://localhost:4566 dynamodb list-tables
aws --endpoint-url http://localhost:4566 s3api get-bucket-cors --bucket rpg-assets
```

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `versions.tf` | Versões, backend local e provider AWS apontado para o endpoint. |
| `variables.tf` | Endpoint, região, credenciais fictícias e nomes dos recursos. |
| `main.tf` | As quatro tabelas, o bucket e o CORS. |
| `outputs.tf` | Nomes dos recursos criados. |

Depois da primeira execução, o Terraform cria `infra/terraform/.terraform.lock.hcl`, que fixa a
versão exata do provider. Vale versionar esse arquivo.
