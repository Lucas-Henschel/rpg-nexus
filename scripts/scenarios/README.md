# Cenários de falha (F1–F8)

Um script por cenário do enunciado. Cada um prepara os dados que precisa (usuário, campanha, loja,
item e personagem novos), provoca a falha, mostra a evidência (estado da Saga, estoque, saldo,
movimentos de dinheiro, filas, DLQ e logs) e termina com **PASS** ou **FAIL**. A configuração que o
cenário muda volta ao normal no fim, mesmo se der erro ou se for interrompido com Ctrl+C.

## Como rodar

Com o sistema no ar (`docker compose up -d --wait`), na raiz do repositório:

```sh
bash scripts/scenarios/f1_compensacao.sh
```

Precisa só de **bash, curl e Docker**. No Windows, rode pelo **Git Bash**. Não precisa de `jq`: para
ler JSON os scripts usam o Python do computador e, se ele não existir, o Python do contêiner do
MiniStack. As portas vêm do `.env` da raiz, como no Compose.

Para ensaiar todos em sequência (leva uns 6 minutos):

```sh
for f in scripts/scenarios/f*.sh; do bash "$f" || break; done
```

## O que cada um faz

| # | Script | Como provoca | O que mostra |
| --- | --- | --- | --- |
| F1 | `f1_compensacao.sh` | `VALIDATION_FAILURE_RATE=1` no `identity-validator` | Saga `COMPENSATED`; resposta `SIMULATED_FAILURE` na outbox do validador; estoque, saldo e reserva voltam ao que eram. |
| F2 | `f2_servico_morre.sh` | consumidores do S2 com 8 s de atraso por mensagem; `docker kill` na réplica que está com o débito sem ACK | a outra réplica recebe a mensagem (`redelivered=True`) e debita **uma** vez; Saga `COMPLETED`. |
| F3 | `f3_duplicada.sh` | lê o `ItemAcquired` real na outbox do S3 e o republica 5 vezes em `rpg.events`, com o mesmo `messageId` | S1 (`duplicate`), S2 (`DUPLICATE`) e S4 recebem as 5 cópias; contador, atividade, histórico, saldo e inventário não mudam. |
| F4 | `f4_venenosa.sh` | publica um payload inválido direto em `characters.validation-requested.v1`; logo depois, uma compra normal | 3 tentativas com espera de 1 s, 2 s e 4 s (fila `.retry`), depois `.dlq` com `x-retry-count=3` e o motivo; a compra conclui. |
| F5 | `f5_corrida.sh` | 100 pedidos de compra simultâneos para 10 unidades | exatamente 10 `202` e 90 `409 out of stock`; 10 Sagas `COMPLETED`; estoque 0; saldo cai 10 × preço. |
| F6 | `f6_broker_fora.sh` | `docker compose stop rabbitmq` por 30 s; durante a queda, uma compra e uma campanha nova | S1 e S3 aceitam as operações (o evento fica na outbox); ao voltar, todos reconectam sem reiniciar, a compra conclui e a campanha chega ao S3 e ao S4. |
| F7 | `f7_resposta_tardia.sh` | validador com 15 s de atraso e `SAGA_TIMEOUT_SECONDS=10` no S3 (o padrão é 60 s) | Saga `EXPIRED` em ~10 s com estoque e reserva devolvidos; a resposta que chega depois é ignorada e nada é debitado. |
| F8 | `f8_escala.sh` | `--scale characters-worker=3` e 30 compras | quantas mensagens cada réplica processou (pelos logs); 30 débitos, 30 itens, saldo exato. |

## Na apresentação

- **Prever antes de rodar:** a coluna "O que mostra" é o que o grupo diz que vai acontecer.
- **Onde olhar além do terminal:**
  - painel do RabbitMQ (filas, `.retry`, `.dlq`; no F4, *Get messages* na `.dlq` mostra os headers);
  - Jaeger (o trace da compra);
  - `docker compose logs -f characters characters-worker` durante o F2 e o F8.
- **Tempo:** cada cenário leva de 20 s a 1 min. O F6 é o mais longo, porque espera os 30 s de queda
  e a reconexão.
- **Falha surpresa:** para derrubar um serviço específico, a regra geral é a mesma do F2 e do F6. O
  que já está no banco fica; o evento espera na fila ou na outbox; quando o serviço volta, a inbox
  evita efeito duplicado.

## Detalhes

- **F2:** o atraso (`CONSUMER_SIMULATED_DELAY_MS`) serve só para dar tempo de matar no meio do
  processamento. O S2 também tem `FAULT_CRASH_BEFORE_ACK=once|always`, que derruba o processo depois
  de gravar e antes do ACK: é o caso em que a inbox impede o segundo débito.
- **F3:** as cópias vão para a exchange, então chegam aos três consumidores do evento.
- **F4:** a mensagem inválida fica na `.dlq` como evidência. Ela pode ser apagada pelo painel do
  RabbitMQ (*Purge*).
- **F6:** a compra feita durante a queda precisa terminar dentro do prazo da Saga (60 s). Com 30 s de
  queda sobra margem; com `QUEDA_SEGUNDOS` bem maior, a Saga expira e compensa, que também é o
  comportamento correto.
