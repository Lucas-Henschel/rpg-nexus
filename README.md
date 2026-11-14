# RPG — base do monorepo

Ambiente local para o trabalho de sistemas distribuídos. A base contém RabbitMQ
para mensageria, MiniStack para S3 e DynamoDB, inicialização idempotente do bucket
S3 e contratos JSON Schema com envelope comum. Os serviços de negócio serão
adicionados quando forem implementados.

## Pré-requisitos

- Node.js 20 ou superior e `pnpm` na versão indicada em `package.json`.
- Docker Engine ou Docker Desktop em execução, com Docker Compose v2.
- GNU Make e `curl` disponíveis no host.
- Para `make smoke` no Docker Desktop, habilite **Settings → Resources → Network
  → Enable host networking**. No Linux, a rede do host já está disponível. O smoke
  executa a AWS CLI em contêiner com `--network host`, sem exigir AWS CLI instalada
  no host.
- Portas locais `5672`, `15672` e `4566` livres, ou portas alternativas no `.env`.

## Primeiro uso

Após clonar o repositório, execute na raiz (o primeiro uso exige acesso à internet
para baixar as dependências e as imagens Docker):

```sh
pnpm install --frozen-lockfile
make bootstrap
make verify
pnpm dev
```

`make bootstrap` copia `.env.example` para `.env` apenas quando `.env` ainda não
existe; configurações locais existentes são preservadas. O arquivo `.env` não deve
ser versionado. As credenciais de exemplo são fictícias e exclusivas deste ambiente
local.

**`pnpm dev` é a entrada principal**, anexada aos logs do Docker Compose. O script
executa `docker compose up --build` para iniciar todos os serviços declarados.
Ao adicionar serviços ao Compose, eles participarão do mesmo comando. O inicializador
`aws-init` aguarda o MiniStack saudável, cria o bucket caso necessário e termina;
repetir a inicialização preserva um bucket existente.

Para iniciar em segundo plano e verificar a infraestrutura:

```sh
pnpm dev:detached
make smoke
pnpm down
```

`pnpm dev:detached` executa `docker compose up --build --detach --wait`, aguardando
os serviços saudáveis. É a opção preferida para smoke tests. `make smoke` exige a
pilha já iniciada: consulta a API de saúde do RabbitMQ no host, verifica a existência
do bucket por S3 `head-bucket` e chama DynamoDB `list-tables` pela AWS CLI em
contêiner contra `http://localhost:4566` (ou a porta configurada). Qualquer falha
encerra o comando com código diferente de zero. A configuração é lida do Compose
resolvido, respeitando `.env` e as variáveis do ambiente.

## Comandos

| Comando | Comportamento |
| --- | --- |
| `make bootstrap` | Cria `.env` a partir do exemplo, sem sobrescrever o existente. |
| `pnpm dev` | Inicia a pilha completa e acompanha os logs no terminal. |
| `pnpm dev:detached` / `make up` | Inicia a pilha completa em segundo plano e aguarda saúde. |
| `pnpm down` / `make down` | Encerra a pilha, preservando os volumes. |
| `make logs` | Acompanha os logs de todos os serviços do Compose. |
| `make verify` | Valida a definição Compose e os exemplos dos contratos JSON Schema. |
| `make smoke` | Verifica RabbitMQ, o bucket S3 e a API DynamoDB pelos endpoints do host. |
| `make reset-local` | **Destrutivo:** encerra a pilha e remove seus volumes persistentes. |

`make reset-local` executa `docker compose down --volumes --remove-orphans`.
Remove os volumes nomeados deste projeto Compose (`rabbitmq-data` e
`ministack-data`, com o prefixo do projeto), incluindo mensagens, configuração
persistida do RabbitMQ, objetos S3 e dados DynamoDB. Não use para uma parada comum;
use `pnpm down`. Um próximo bootstrap da pilha recria os volumes e o bucket vazio.
O comando não remove volumes de outros projetos Compose.

## Higiene Git e reprodução

Versione `pnpm-lock.yaml` e instale com `pnpm install --frozen-lockfile` para usar
as versões registradas. `.env.example` é versionado; `.env`, suas variantes locais,
`node_modules/`, `.turbo/` e os diretórios locais `data/` e `.local/` são ignorados.
Os dados da pilha ficam nos volumes nomeados do Docker, fora da árvore Git.

Após `make down`, `git status --short` deve permanecer vazio em um clone sem
alterações de código. Para validar também a configuração de referência, execute
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
| `RABBITMQ_USER` | `dev` | Usuário inicial do RabbitMQ e autenticação do smoke. |
| `RABBITMQ_PASSWORD` | `dev` | Senha fictícia do RabbitMQ. |
| `RABBITMQ_PORT` | `5672` | Porta AMQP publicada no host. |
| `RABBITMQ_MANAGEMENT_PORT` | `15672` | Porta do painel e API de saúde no host. |
| `MINISTACK_PORT` | `4566` | Porta S3/DynamoDB publicada no host. |
| `AWS_ENDPOINT_URL` | `http://ministack:4566` | Endpoint interno usado pelo inicializador Compose. |
| `AWS_REGION` | `us-east-1` | Região da inicialização e do smoke. |
| `AWS_ACCESS_KEY_ID` | `test` | Chave fictícia para o MiniStack. |
| `AWS_SECRET_ACCESS_KEY` | `test` | Segredo fictício para o MiniStack. |
| `RPG_ASSETS_BUCKET` | `rpg-assets` | Bucket criado pelo inicializador e conferido no smoke. |

Mudar uma porta publicada altera somente o endereço no host. A porta interna do
MiniStack continua `4566`, portanto mantenha `AWS_ENDPOINT_URL=http://ministack:4566`
para o Compose. Clientes executados no host usam `http://localhost:4566`, ajustando
a porta se necessário. As credenciais iniciais do RabbitMQ são criadas com o volume
vazio; mudar `.env` não altera usuários já persistidos.

Os detalhes ficam em [contratos](contracts/README.md),
[RabbitMQ](infra/rabbitmq/README.md) e [MiniStack](infra/ministack/README.md).
