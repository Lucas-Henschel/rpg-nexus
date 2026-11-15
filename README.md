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

Cada serviço fica em sua própria pasta dentro de `services/`, com `Dockerfile` e
endpoint de health check, e é declarado no `docker-compose.yml`. Os projetos são
independentes: cada um tem suas próprias dependências e lockfile (`package.json`,
`pom.xml`, `requirements.txt`) e seu Dockerfile usa a própria pasta como contexto,
podendo ser construído isoladamente com `docker build services/<serviço>`. A exceção
é `services/characters`, cujo build usa a raiz como contexto para copiar `contracts/`
e `infra/manifests/`: `docker build -f services/characters/Dockerfile .`.

| Projeto | Pasta | Serviços no Compose |
| --- | --- | --- |
| Personagens (S2, Python) | [`services/characters`](services/characters/README.md) | `characters-init`, `characters` |
| Front-end (React + Vite) | [`apps/frontend`](apps/frontend/README.md) | `frontend` |

## Pré-requisitos

- Opcional: Node.js 24 LTS, apenas para desenvolver os projetos JavaScript fora do
  Docker. Veja [Instalação do Node.js](docs/instalacao-node.md).
- Docker Engine ou Docker Desktop em execução, com Docker Compose v2.
- Portas locais `5672`, `15672`, `4566`, `8000` e `5173` livres, ou portas alternativas no `.env`.

## Primeiro uso

Após clonar o repositório, execute na raiz (o primeiro uso exige acesso à internet
para baixar as dependências e as imagens Docker):

```sh
cp .env.example .env
docker compose up --build
```

O arquivo `.env` não deve ser versionado. As credenciais de exemplo são fictícias
e exclusivas deste ambiente local.

**`docker compose up --build` é a entrada principal**, subindo
a infraestrutura e todos os serviços declarados no Compose, com os logs anexados
ao terminal. O inicializador `aws-init` aguarda o MiniStack saudável, cria o
bucket caso necessário e termina; repetir a inicialização preserva um bucket
existente. O RabbitMQ aguarda a conclusão com sucesso de `aws-init`, tornando a
inicialização uma condição de prontidão da pilha. Uma falha do inicializador faz
o `docker compose up` falhar.

Em seguida, `characters-init` cria as tabelas DynamoDB do serviço de Personagens e
aplica o CORS do bucket, e só então `characters` sobe. Com a pilha no ar, abra o
front-end em [localhost:5173](http://localhost:5173).

### Logs separados por serviço

`docker compose up` mistura os logs de todos os contêineres, com o nome do serviço como
prefixo. Para ver cada serviço separadamente, suba a pilha em segundo plano com
`docker compose up --build --detach --wait` e use uma destas opções:

- [lazydocker](https://github.com/jesseduffield/lazydocker) (`brew install lazydocker`):
  interface no terminal com a lista de contêineres e o log de cada um.
- Um painel do terminal por serviço com `docker compose logs -f <serviço>`.
- A aba de logs de cada contêiner no Docker Desktop.

## Comandos

| Comando | Comportamento |
| --- | --- |
| `docker compose up --build` | Sobe a pilha completa e acompanha os logs no terminal. |
| `docker compose up --build --detach --wait` | Sobe a pilha em segundo plano e aguarda saúde e inicialização. |
| `docker compose up --build <serviço>` | Sobe um serviço e suas dependências. |
| `docker compose logs -f [serviço]` | Acompanha os logs de todos os serviços ou de um. |
| `docker compose down` | Encerra a pilha, preservando os volumes. |
| `docker compose down --volumes` | **Destrutivo:** encerra a pilha e remove os volumes (mensagens, objetos S3, dados DynamoDB). |

## Higiene Git e reprodução

Cada projeto versiona seu próprio lockfile (ex.: `package-lock.json`, instalado
com `npm ci`). `.env.example` é versionado; `.env`, suas variantes locais,
`node_modules/` e os diretórios locais `data/` e `.local/` são ignorados.
Os dados da pilha ficam nos volumes nomeados do Docker, fora da árvore Git.

Para validar a configuração de referência, execute
`docker compose --env-file .env.example config --quiet`. As imagens RabbitMQ e
MiniStack usam tags móveis; os lockfiles fixam as dependências dos projetos, mas
não congelam as imagens Docker.

## Endpoints e variáveis

As portas publicadas ficam restritas a `127.0.0.1`. Os nomes de serviço são
resolvidos entre contêineres na rede Compose, e não no host.

| Recurso | No host (defaults) | Entre contêineres Compose |
| --- | --- | --- |
| RabbitMQ AMQP | `amqp://localhost:5672` | `amqp://rabbitmq:5672` |
| RabbitMQ Management | [localhost:15672](http://localhost:15672) | `http://rabbitmq:15672` |
| MiniStack S3 / DynamoDB | `http://localhost:4566` | `http://ministack:4566` |
| Personagens (API) | [localhost:8000/docs](http://localhost:8000/docs) | `http://characters:8000` |
| Front-end | [localhost:5173](http://localhost:5173) | — |

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
| `RPG_ASSETS_BUCKET` | `rpg-assets` | Bucket criado pelo inicializador e usado pelo serviço de Personagens. |
| `CHARACTERS_PORT` | `8000` | Porta da API de Personagens no host; também é o endereço gravado no build do front-end. |
| `FRONTEND_PORT` | `5173` | Porta do front-end no host; também é a origem liberada no CORS de Personagens e do bucket. |

Mudar uma porta publicada altera somente o endereço no host. A porta interna do
MiniStack continua `4566`, portanto mantenha `AWS_ENDPOINT_URL=http://ministack:4566`
para o Compose. Clientes executados no host usam `http://localhost:4566`, ajustando
a porta se necessário. As credenciais iniciais do RabbitMQ são criadas com o volume
vazio; mudar `.env` não altera usuários já persistidos.

Os detalhes ficam em [contratos](contracts/README.md),
[RabbitMQ](infra/rabbitmq/README.md) e [MiniStack](infra/ministack/README.md).
