# RPG — base do monorepo

Ambiente local para o trabalho de sistemas distribuídos. A base contém RabbitMQ
para mensageria, MiniStack para S3 e DynamoDB, inicialização idempotente do bucket
S3 e contratos JSON Schema com envelope comum. Os serviços de negócio serão
adicionados quando forem implementados.

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `apps/` | Aplicações (front-end, clientes). |
| `services/` | Serviços de back-end do sistema distribuído. |
| `contracts/` | Contratos JSON Schema dos eventos trocados entre serviços. |
| `infra/` | Configuração da infraestrutura local (RabbitMQ, MiniStack). |
| `scripts/` | Scripts auxiliares do monorepo. |

Cada pasta dentro de `apps/` ou `services/` com seu próprio `package.json` passa a
fazer parte do workspace pnpm (`pnpm-workspace.yaml`).

## Pré-requisitos

- Node.js 20 ou superior e `pnpm` na versão indicada em `package.json`.
- Docker Engine ou Docker Desktop em execução, com Docker Compose v2.
- Portas locais `5672`, `15672` e `4566` livres, ou portas alternativas no `.env`.

## Primeiro uso

Após clonar o repositório, execute na raiz (o primeiro uso exige acesso à internet
para baixar as dependências e as imagens Docker):

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm test
pnpm dev
```

O arquivo `.env` não deve ser versionado. As credenciais de exemplo são fictícias
e exclusivas deste ambiente local.

**`pnpm dev` é a entrada principal**, anexada aos logs do Docker Compose. O script
executa `docker compose up --build` para iniciar todos os serviços declarados.
Ao adicionar serviços ao Compose, eles participarão do mesmo comando. O inicializador
`aws-init` aguarda o MiniStack saudável, cria o bucket caso necessário e termina;
repetir a inicialização preserva um bucket existente. O RabbitMQ aguarda a conclusão
com sucesso de `aws-init`, tornando a inicialização uma condição de prontidão da
pilha. Uma falha do inicializador faz ambos os comandos de desenvolvimento falharem.

## Comandos

| Comando | Comportamento |
| --- | --- |
| `pnpm dev` | Inicia a pilha completa e acompanha os logs no terminal. |
| `pnpm dev:detached` | Inicia a pilha em segundo plano e aguarda saúde e inicialização. |
| `pnpm down` | Encerra a pilha, preservando os volumes. |
| `pnpm test` | Valida os exemplos dos contratos JSON Schema. |
| `docker compose logs -f` | Acompanha os logs de todos os serviços. |
| `docker compose down --volumes` | **Destrutivo:** encerra a pilha e remove os volumes (mensagens, objetos S3, dados DynamoDB). |

## Higiene Git e reprodução

Versione `pnpm-lock.yaml` e instale com `pnpm install --frozen-lockfile` para usar
as versões registradas. `.env.example` é versionado; `.env`, suas variantes locais,
`node_modules/`, `.turbo/` e os diretórios locais `data/` e `.local/` são ignorados.
Os dados da pilha ficam nos volumes nomeados do Docker, fora da árvore Git.

Para validar a configuração de referência, execute
`docker compose --env-file .env.example config --quiet`. As imagens RabbitMQ e
MiniStack usam tags móveis; o lockfile fixa as dependências pnpm, mas não congela
as imagens Docker.

## Endpoints e variáveis

As portas publicadas ficam restritas a `127.0.0.1`. Os nomes de serviço são
resolvidos entre contêineres na rede Compose, e não no host.

| Recurso | No host (defaults) | Entre contêineres Compose |
| --- | --- | --- |
| RabbitMQ AMQP | `amqp://localhost:5672` | `amqp://rabbitmq:5672` |
| RabbitMQ Management | [localhost:15672](http://localhost:15672) | `http://rabbitmq:15672` |
| MiniStack S3 / DynamoDB | `http://localhost:4566` | `http://ministack:4566` |

| Variável em `.env` | Default | Uso |
| --- | --- | --- |
| `RABBITMQ_USER` | `dev` | Usuário inicial do RabbitMQ. |
| `RABBITMQ_PASSWORD` | `dev` | Senha fictícia do RabbitMQ. |
| `RABBITMQ_PORT` | `5672` | Porta AMQP publicada no host. |
| `RABBITMQ_MANAGEMENT_PORT` | `15672` | Porta do painel e API de saúde no host. |
| `MINISTACK_PORT` | `4566` | Porta S3/DynamoDB publicada no host. |
| `AWS_ENDPOINT_URL` | `http://ministack:4566` | Endpoint interno usado pelo inicializador Compose. |
| `AWS_REGION` | `us-east-1` | Região usada na inicialização. |
| `AWS_ACCESS_KEY_ID` | `test` | Chave fictícia para o MiniStack. |
| `AWS_SECRET_ACCESS_KEY` | `test` | Segredo fictício para o MiniStack. |
| `RPG_ASSETS_BUCKET` | `rpg-assets` | Bucket criado pelo inicializador. |

Mudar uma porta publicada altera somente o endereço no host. A porta interna do
MiniStack continua `4566`, portanto mantenha `AWS_ENDPOINT_URL=http://ministack:4566`
para o Compose. Clientes executados no host usam `http://localhost:4566`, ajustando
a porta se necessário. As credenciais iniciais do RabbitMQ são criadas com o volume
vazio; mudar `.env` não altera usuários já persistidos.

Os detalhes ficam em [contratos](contracts/README.md),
[RabbitMQ](infra/rabbitmq/README.md) e [MiniStack](infra/ministack/README.md).
