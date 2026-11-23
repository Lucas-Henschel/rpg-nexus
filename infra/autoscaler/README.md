# Autoescala do consumidor

`autoscale.sh` ajusta o número de réplicas de um consumidor conforme o tamanho da fila.
O perfil `autoscale` inicia quatro instâncias independentes do controlador:

| Serviço | Controlador | Fila observada | Réplicas |
| --- | --- | --- | --- |
| S1 Campanhas | `autoscaler-campaigns` | `campaigns.activity.v1` | `campaigns-worker` |
| S2 Personagens | `autoscaler` | `characters.validation-requested.v1` | `characters-worker` |
| S3 Inventário | `autoscaler-inventory` | `inventory.saga-replies.v1` | `inventory-worker` |
| S4 Identidade | `autoscaler-identity` | `actions.validation-requested.v1` | `identity-validator` |

- **Medida:** total de mensagens da fila (prontas + em processamento), lido da API de gerenciamento
  do RabbitMQ a cada `AUTOSCALE_INTERVAL_SECONDS`.
- **Regra:** `réplicas = teto(mensagens / AUTOSCALE_MESSAGES_PER_REPLICA)`, limitado entre
  `AUTOSCALE_MIN_REPLICAS` e `AUTOSCALE_MAX_REPLICAS`.
- **Para cima:** imediato. **Para baixo:** só depois de `AUTOSCALE_SCALE_DOWN_AFTER` leituras
  seguidas pedindo menos réplicas, para não oscilar.
- **Como escala:** `docker compose up --scale`, pelo socket do Docker do host. Réplicas em execução
  nunca são recriadas.

Os workers não publicam portas no host; por isso podem ter várias réplicas. O `inventory-worker` não
executa os agendadores de expiração ou publicação da outbox; essas tarefas ficam na instância principal.
Todas as réplicas consomem as respectivas filas (consumidores concorrentes). Remover uma réplica no
meio do processamento é seguro: a mensagem sem ACK volta para a fila e a inbox impede efeito duplicado.

## Demonstração

Na raiz do monorepo, com um personagem criado na campanha `c1`:

Antes, no `.env` da raiz, deixe o consumidor lento de propósito para a fila crescer:
`CONSUMER_SIMULATED_DELAY_MS=500`. Volte para `0` depois da demonstração.

```sh
# 1. sobe a pilha com o autoscaler ligado
docker compose --profile autoscale up --build --detach --wait

# 2. em um terminal, acompanhe as decisões
docker compose logs -f autoscaler autoscaler-campaigns autoscaler-inventory autoscaler-identity

# 3. em outro, gere carga
docker compose exec characters python -m scripts.publish_event flood --character-id <id> --campaign-id c1 --count 3000

# 4. veja as réplicas subirem e, com a fila vazia, voltarem ao mínimo
docker compose ps characters-worker
```

A fila também aparece no painel do RabbitMQ (http://localhost:15672, usuário e senha do `.env`).

| Variável | Padrão | Uso |
| --- | --- | --- |
| `AUTOSCALE_MIN_REPLICAS` | `1` | Mínimo de réplicas. |
| `AUTOSCALE_MAX_REPLICAS` | `4` | Máximo de réplicas. |
| `AUTOSCALE_MESSAGES_PER_REPLICA` | `100` | Mensagens na fila que justificam uma réplica. |
| `AUTOSCALE_INTERVAL_SECONDS` | `5` | Intervalo entre leituras. |
| `AUTOSCALE_SCALE_DOWN_AFTER` | `3` | Leituras seguidas antes de reduzir. |
| `CONSUMER_SIMULATED_DELAY_MS` | `0` | Atraso artificial por mensagem no S2; só para a demonstração. |
