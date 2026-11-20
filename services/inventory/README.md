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

O S3 reserva uma unidade de modo transacional, grava a Saga e publica `MoneyDebitRequested`. Quando receber `MoneyDebited`, entrega o item, confirma o estoque e publica `ShopItemPurchased` e `ItemAcquired`. Se o débito for recusado ou o prazo acabar, devolve a unidade. O S2 ainda não consome `characters.money-commands.v1` nem mantém saldo monetário; portanto **compras reais ainda expiram sem entrega** até essa integração ser implementada.

Para iniciar a pilha, use `docker compose up --build` na raiz. O Terraform cria as tabelas e filas. O S3 também mantém endpoints legados de catálogo, estoque e inventário.
