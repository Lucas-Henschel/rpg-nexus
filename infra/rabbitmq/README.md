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
`rabbitmq-diagnostics -q ping`. O serviço participa da rede `rpg` do projeto.

Valide a definição a partir da raiz, mesmo sem `.env`:

```sh
docker compose --env-file .env.example config --quiet
```

A entrada principal do ambiente é `docker compose up`; `docker compose down` encerra os contêineres
preservando os volumes.
