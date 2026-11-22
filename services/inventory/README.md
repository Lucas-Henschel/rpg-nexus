# S3 Inventário e loja por campanha

Serviço Java 21 / Spring Boot na porta 8080. Cada campanha pode ter uma loja opcional. O dono da campanha ativa ou desativa a loja, define seu nome e cadastra, edita ou remove itens com preço e quantidade. Membros da campanha podem consultar a loja. Um jogador com personagem selecionado pode iniciar uma compra de uma unidade.

## Autorização

As operações da loja usam `Authorization: Bearer <access token>` do S4. O S3 valida assinatura HS256, emissor, audiência e expiração. Para cada edição e compra, consulta o S1 com o mesmo token para conferir o dono ou o personagem selecionado. Configure `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` e `CAMPAIGNS_URL`. O Compose usa o mesmo segredo do S1/S4 e `http://campaigns:3001`.

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

Preço e estoque são inteiros não negativos. A edição do estoque e a remoção recusam itens com reserva pendente (409), preservando a compra em andamento. Uma chave de idempotência representa uma compra; reutilizá-la com outros dados retorna 409.

## Compra e dependência do S2

O S3 reserva uma unidade de modo transacional, grava a Saga e solicita a validação externa simulada ao S4. Depois da aprovação, publica `MoneyDebitRequested`. O S2 consome `characters.money-commands.v1`, debita o campo **Dinheiro** da ficha e responde com `MoneyDebited` ou `MoneyDebitRejected`. Quando o débito é confirmado, o S3 entrega o item, confirma o estoque e publica `ShopItemPurchased` e `ItemAcquired`. Se a validação ou o débito forem recusados, ou se o prazo acabar, devolve a unidade; estornos usam `MoneyRefundRequested` e `MoneyRefunded`.

Para iniciar a pilha, use `docker compose up --build` na raiz. O Terraform cria as tabelas e filas. O S3 também mantém endpoints legados de catálogo, estoque e inventário.


## Ordem da Saga de compra

1. O S3 reserva uma unidade de estoque e publica `ExternalValidationRequested`.
2. A operação fica em `VALIDATING_EXTERNAL`.
3. Quando o S4 aprova, o S3 muda para `WAITING_MONEY` e publica `MoneyDebitRequested`.
4. O débito confirmado entrega o item; falha externa, débito recusado ou prazo expirado liberam a reserva.
5. Um débito tardio após expiração gera `MoneyRefundRequested`.

As respostas do S4 e do S2 passam pela mesma inbox idempotente da Saga. Uma
resposta repetida ou fora de ordem é registrada sem repetir efeitos.
