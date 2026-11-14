# MiniStack local

Valide a definição Compose, inclusive sem um `.env` local, a partir da raiz:

```sh
docker compose --env-file .env.example config --quiet
```

O serviço `ministack` usa `ministackorg/ministack:latest` para as APIs S3 e
DynamoDB. O host acessa [localhost:4566](http://localhost:4566), com porta
configurável por `MINISTACK_PORT`. Contêineres na rede `rpg` usam
`http://ministack:4566`; a porta interna continua sendo `4566` quando a porta do
host muda. A publicação é restrita ao host local.

As credenciais fictícias `test`/`test` e a região `us-east-1` vêm de
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e `AWS_REGION`. Os defaults do
Compose coincidem com `.env.example` e permitem validar sem `.env` local.

O health check chama a AWS CLI interna contra `http://localhost:4566` e exige
sucesso em `s3api list-buckets` e `dynamodb list-tables`. A disponibilidade do
executável `aws` é documentada no
[README oficial, Startup Scripts](https://github.com/ministackorg/ministack#startup-scripts)
e sua inclusão consta no
[Dockerfile oficial](https://github.com/ministackorg/ministack/blob/main/Dockerfile).

O volume nomeado `ministack-data`, com prefixo do projeto Compose, é montado
em `/data`. `PERSIST_STATE=1` preserva metadados em `/data/state` e
`S3_PERSIST=1` preserva o conteúdo dos objetos em `/data/s3`, conforme a
[configuração oficial de persistência](https://ministack.org/docs/configuration#persistence).

`aws-init` é um contêiner AWS CLI de execução única que aguarda o MiniStack
saudável. Ele monta o repositório somente para leitura em `/work` e executa
`/bin/sh /work/infra/ministack/init-resources.sh`, recebendo `AWS_ENDPOINT_URL`
(`http://ministack:4566`), região, credenciais fictícias e `RPG_ASSETS_BUCKET`
(`rpg-assets`). O script cria o bucket se necessário e verifica a API DynamoDB;
não são criadas tabelas de domínio. O RabbitMQ depende da conclusão com sucesso
de `aws-init`, tornando a inicialização uma condição explícita de prontidão da
pilha em `docker compose up`, inclusive com `--wait`.

A entrada principal do ambiente é `docker compose up`; `docker compose down` preserva os volumes.
Para conferir os serviços declarados:

```sh
docker compose --env-file .env.example config --services
```
