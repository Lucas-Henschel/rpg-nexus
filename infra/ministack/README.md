# MiniStack local

O Compose usa **quatro instâncias MiniStack**. Cada microsserviço e seus workers
alcançam apenas a instância ligada à sua rede `db-*`. O Terraform é o processo de
provisionamento e participa das quatro redes. A instância `ministack` pertence ao S2
Personagens e fornece também o bucket S3; sua porta é publicada para as URLs de
retratos usadas pelo navegador. `ministack-campaigns`, `ministack-inventory` e
`ministack-identity` não publicam portas no host.

As credenciais locais são diferentes por serviço e vêm do `.env` da raiz. A
separação efetiva no Compose é feita por instâncias e redes; não se deve tratar o
IAM do emulador como um controle de acesso comprovado. Na AWS real, atribua a cada
serviço uma identidade IAM com acesso apenas às suas tabelas e, para o S2, ao bucket.

**Migração de um ambiente antigo:** o Terraform não transfere automaticamente as
tabelas nem os dados da instância única anterior. Faça backup antes de trocar de
ambiente. Para uma instalação nova de demonstração, remova os volumes antigos com
`docker compose down --volumes` e suba novamente; esse comando apaga os dados locais.

Valide a definição Compose, inclusive sem um `.env` local, a partir da raiz:

```sh
docker compose --env-file .env.example config --quiet
```

As instâncias usam `ministackorg/ministack:latest`. O host acessa somente o
MiniStack de Personagens em [localhost:4566](http://localhost:4566), com porta
configurável por `MINISTACK_PORT`. Cada serviço usa o nome de sua instância na
rede privada; a porta interna é sempre `4566`.

Os quatro pares de credenciais e a região vêm das variáveis no `.env.example`
da raiz. Os defaults do Compose coincidem com esse arquivo.

O health check chama a AWS CLI interna contra `http://localhost:4566` e exige
sucesso em `s3api list-buckets` e `dynamodb list-tables`. A disponibilidade do
executável `aws` é documentada no
[README oficial, Startup Scripts](https://github.com/ministackorg/ministack#startup-scripts)
e sua inclusão consta no
[Dockerfile oficial](https://github.com/ministackorg/ministack/blob/main/Dockerfile).

Cada instância tem seu próprio volume montado em `/data`. `PERSIST_STATE=1`
preserva metadados em `/data/state`; `S3_PERSIST=1` preserva os retratos do S2
em `/data/s3`, conforme a
[configuração oficial de persistência](https://ministack.org/docs/configuration#persistence).

O bucket e as tabelas DynamoDB são criados pelo contêiner `terraform`, que espera
as quatro instâncias saudáveis (veja [`infra/terraform/README.md`](../terraform/README.md)).

A entrada principal do ambiente é `docker compose up`; `docker compose down` preserva os volumes.
Para conferir os serviços declarados:

```sh
docker compose --env-file .env.example config --services
```

O isolamento é garantido pela rede: cada API resolve apenas o nome DNS do próprio
MiniStack, pois credenciais fictícias do emulador não são uma prova de aplicação de IAM.
