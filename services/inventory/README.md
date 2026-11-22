# S3 Inventário e loja por campanha

Serviço Java 21 / Spring Boot na porta 8080. Cada campanha pode ter uma loja opcional. O dono da campanha ativa ou desativa a loja, define seu nome e cadastra, edita ou remove itens com preço e quantidade. Membros da campanha podem consultar a loja. Um jogador com personagem selecionado pode iniciar uma compra de uma unidade.

## Autorização

As operações da loja usam `Authorization: Bearer <access token>` do S4. O S3 valida assinatura HS256, emissor, audiência e expiração. Dono, participantes e personagem escolhido vêm de uma **cópia local** (tabela `campaign_members`), montada com os eventos do S1 na fila `inventory.campaign-members.v1`; o S3 não chama o S1 por HTTP. Configure `JWT_SECRET`, `JWT_ISSUER` e `JWT_AUDIENCE`; o Compose usa o mesmo segredo do S1/S4.

- **Ordem dos eventos:** entrada/saída e personagem escolhido guardam cada um o instante do evento; um evento mais antigo que o gravado é ignorado. Uma saída apaga o personagem escolhido.
- **Consistência eventual:** logo depois de entrar na campanha ou escolher o personagem, a loja pode responder 403 por um instante, até o evento chegar.
- **Retry:** falhas vão para `inventory.campaign-members.v1.retry` (1 s, 2 s, 4 s) e, depois de `MAX_RETRIES`, para a `.dlq`.
- **Nomes das filas:** vêm do ambiente, como pede o enunciado. `RABBITMQ_QUEUE` e `RABBITMQ_RETRY_QUEUE` são as respostas da Saga; `RABBITMQ_MEMBERS_QUEUE` e `RABBITMQ_MEMBERS_RETRY_QUEUE`, a cópia de participantes. Os padrões são os de `infra/rabbitmq/definitions.json`.

## Rotas principais

| Rota | Uso |
|---|---|
| `GET /shops/{campaignId}` | Loja da campanha; 404 se não foi criada. |
| `PUT /shops/{campaignId}` | Dono cria ou atualiza `{ "name": "Loja", "active": true }`. |
| `GET /shops/{campaignId}/items` | Lista itens para membros. |
| `POST /shops/{campaignId}/items` | Dono cria item com `name`, `description`, `price`, `available`; o S3 gera um UUID único. |
| `PUT /shops/{campaignId}/items/{itemId}` | Dono edita nome, descrição, preço e quantidade de um item existente. |
| `DELETE /shops/{campaignId}/items/{itemId}` | Dono remove item sem compras pendentes. |
| `POST /acquisitions` | Jogador envia `{ "campaignId", "characterId", "itemId" }` e `Idempotency-Key`; recebe 202 com operação. |
| `GET /acquisitions/{operationId}` | Comprador ou dono consulta o andamento. |
| `GET /inventory/{characterId}` | Itens já entregues ao personagem, só das campanhas de que quem chamou participa. |

Preço e estoque são inteiros não negativos. A edição do estoque e a remoção recusam itens com reserva pendente (409), preservando a compra em andamento. Uma chave de idempotência representa uma compra; reutilizá-la com outros dados retorna 409.

## Compra e dependência do S2

O S3 reserva uma unidade de modo transacional, grava a Saga e pede ao S2 que confira o personagem e reserve espaço na mochila (`CharacterValidationRequested`). Com o personagem aprovado, solicita a validação externa simulada (contêiner `identity-validator`). Depois da aprovação, publica `MoneyDebitRequested`. O S2 consome `characters.money-commands.v1`, debita o campo **Dinheiro** da ficha e responde com `MoneyDebited` ou `MoneyDebitRejected`. Quando o débito é confirmado, o S3 entrega o item, confirma o estoque e publica `ShopItemPurchased` e `ItemAcquired`. Se a validação ou o débito forem recusados, ou se o prazo acabar, devolve a unidade; estornos usam `MoneyRefundRequested` e `MoneyRefunded`.

Para iniciar a pilha, use `docker compose up --build` na raiz. O Terraform cria as tabelas e filas.


## Ordem da Saga de compra

1. O S3 reserva uma unidade de estoque e publica `CharacterValidationRequested`; a operação fica em `VALIDATING_CHARACTER`.
2. O S2 confere o personagem (existe, mesma campanha, ativo) e reserva espaço na mochila (`maxItems`). Com `CharacterValidated`, o S3 publica `ExternalValidationRequested` e a operação fica em `VALIDATING_EXTERNAL`. Com `CharacterRejected` (por exemplo, mochila cheia), a unidade volta ao estoque e a operação termina em `REJECTED`.
3. Quando o S4 aprova, o S3 muda para `WAITING_MONEY` e publica `MoneyDebitRequested`.
4. O débito confirmado entrega o item; falha externa, débito recusado ou prazo expirado liberam a reserva.
5. Um débito tardio após expiração gera `MoneyRefundRequested`.

Toda Saga que termina sem entregar o item publica `AcquisitionCancelled`; é ele que faz o S2 devolver o espaço reservado na mochila.

As respostas do validador externo e do S2 passam pela mesma inbox idempotente da Saga. Uma
resposta repetida ou fora de ordem é registrada sem repetir efeitos.

## Testes

```sh
mvn test
```

Rodam sem Docker: os testes de persistência usam o DynamoDB Local em memória (dependência só de teste).

| Arquivo | O que garante |
|---|---|
| `SagaTransitionTest` | Regras puras da Saga: cada resposta leva ao próximo estado certo; respostas fora de hora não fazem nada. |
| `DynamoSagaRepositoryTest` | A Saga gravando de verdade: estoque reservado e devolvido, eventos da outbox, mochila cheia (`REJECTED`), validador que volta dentro do prazo (a compra continua), validador fora depois do prazo (`EXPIRED`), resposta atrasada ignorada, reembolso de débito atrasado, reentrega idempotente. |
| `CampaignProjectionTest` | Cópia local de participantes: dono continua dono, eventos atrasados não desfazem os mais novos, sair corta o acesso, reentrega não muda nada. |
| `CampaignAccessTest` | Quem vê a loja, quem edita e com qual personagem compra. |
