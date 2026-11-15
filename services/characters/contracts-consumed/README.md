# Expectativas do consumidor S2 (consumer-driven contracts)

`ItemAcquired` e `AcquisitionCancelled` pertencem ao **S3 Inventário (P3)**; os schemas oficiais
ficam em `contracts/events/` e são mantidos por P3.

Os arquivos desta pasta **não substituem** esses schemas: descrevem apenas o **mínimo** que o S2
precisa ler. Os testes do S2 validam os schemas oficiais de P3 contra estas expectativas quando
eles existirem em `contracts/events/` (ver `tests/test_contracts.py`). Se P3 remover ou renomear um
desses campos, o teste do S2 quebra antes da integração.

| Evento | type | routing key | Campos obrigatórios para o S2 |
|---|---|---|---|
| ItemAcquired | `rpg.item.acquired.v1` | `item.acquired.v1` | `operationId`, `characterId` |
| AcquisitionCancelled | `rpg.acquisition.cancelled.v1` | `acquisition.cancelled.v1` | `operationId`, `characterId` |

`quantity` é opcional (padrão: a quantidade registrada na reserva do S2).
