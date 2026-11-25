# Scripts dos requisitos R1 a R6

Cada script provoca um requisito de sistemas distribuídos do enunciado com a pilha rodando de verdade,
mostra o que aconteceu (respostas HTTP, logs e estado dos bancos) e confere o resultado esperado com ✔ ou ✘.

| Script | Requisito | Cenário de falha | O que confere |
|---|---|---|---|
| `r1-idempotencia.sh` | R1 At-least-once com idempotência | F3 mensagem duplicada | A mesma mensagem 5 vezes: 1 `APPROVED`, 4 `DUPLICATE`, uma reserva só na mochila |
| `r2-concorrencia.sh` | R2 Controle de concorrência | F5 corrida pelo recurso | 100 compras simultâneas para 10 unidades: 10 aceitas e concluídas, 90 recusadas, estoque 0, 10 cobranças |
| `r3-api-assincrona.sh` | R3 API assíncrona | — | `202 Accepted` com `operationId` e a consulta do status até `COMPLETED` |
| `r4-consumidores-concorrentes.sh` | R4 Consumidores concorrentes | F8 escala horizontal | 3 réplicas: carga dividida, cada operação decidida uma vez, mochila nunca acima do limite |
| `r5-dependencia-instavel.sh` | R5 Dependência instável | F1 compensação e F7 resposta tardia | Falha 100%: `COMPENSATED`, estoque e mochila devolvidos. Atraso maior que o prazo: `EXPIRED`, a resposta atrasada não muda nada |
| `r6-reconexao.sh` | R6 Reconexão | F6 broker fora | RabbitMQ parado por 30 s: tudo reconecta sozinho e o que foi pedido durante a queda termina |
| `bonus-versionamento-eventos.sh` | Bônus: versionamento de eventos | — | Gera v1 e v2, deixa ambas visíveis na fila do RabbitMQ, depois retoma o consumidor e confere as duas compras |

## Como rodar

Precisa de **bash**, **curl** e **docker compose**. No Windows, use o **Git Bash** (vem com o Git): abra o
Git Bash na pasta do repositório.

> **Atenção no Windows:** digitar `bash` no PowerShell costuma abrir o bash do **WSL**, não o Git Bash. O bash
> do WSL alcança os serviços pelo `curl`, mas o `docker compose` dele não enxerga o Docker Desktop (a não ser
> que a integração com o WSL esteja ligada). Os scripts conferem isso no início e avisam. Para usar o Git Bash
> a partir do PowerShell:
>
> ```powershell
> & "C:\Program Files\Git\bin\bash.exe" scripts/requisitos/r1-idempotencia.sh
> ```

1. Suba a pilha na raiz do repositório:

   ```bash
   docker compose up --build --detach --wait
   ```

2. Rode os scripts um de cada vez, por exemplo:

   ```bash
   bash scripts/requisitos/r2-concorrencia.sh
   ```

Para apresentar as duas versões de evento pelo painel do RabbitMQ, rode o script do bônus. Ele grava o resultado
em `logs/versionamento-eventos-<data-hora>.log`, pausa antes de consumir as mensagens para você inspecioná-las
no painel e restaura a configuração anterior do Inventário ao terminar:

```bash
bash scripts/requisitos/bonus-versionamento-eventos.sh
```

**Para apresentar ao vivo**, use `PAUSA=1`. O script para antes de cada etapa e espera o Enter, para dar
tempo de explicar:

```bash
PAUSA=1 bash scripts/requisitos/r6-reconexao.sh
```

## O que cada script faz por conta própria

- **Cenário isolado:** cada execução cadastra um usuário novo no S4, cria uma campanha no S1, uma ficha
  "Cobaia" no S2, escolhe essa ficha na campanha e ativa a loja no S3. Não mexe nos seus dados e pode ser
  repetido quantas vezes quiser.
- **Consistência eventual:** S2 e S3 conhecem os participantes pelos eventos do S1. O script espera esses
  eventos chegarem antes de seguir.
- **Configuração temporária:** o `r4` sobe 3 réplicas e volta para 1 no fim. O `r5` recria o validador
  (e o S3, com prazo de 10 s na parte B) passando as variáveis só na linha de comando, sem mexer no `.env`.
  No fim, ou se você interromper com Ctrl+C, ele volta tudo para a configuração do `.env`. O `r6` religa o
  RabbitMQ mesmo se for interrompido.

## Variáveis opcionais

| Variável | Padrão | Uso |
|---|---|---|
| `PAUSA` | `0` | `1` espera Enter entre as etapas |
| `COMPRAS` / `UNIDADES` | `100` / `10` | `r2`: quantas compras e quantas unidades |
| `MENSAGENS` / `REPLICAS` | `300` / `3` | `r4`: carga e número de réplicas |
| `FORA` | `30` | `r6`: segundos com o RabbitMQ parado |
| `S1_URL`, `S2_URL`, `S3_URL`, `S4_URL` | portas do `.env.example` | endereços dos serviços, se você mudou as portas |

## Quando algo dá errado

- **"S1 Campanhas não responde"**: a pilha não está no ar. Rode o `docker compose up` do passo 1.
- **"O docker compose deste bash não enxerga a pilha"**: você está num bash sem acesso ao Docker (em geral, o do
  WSL). Use o Git Bash, como no aviso acima.
- **Um ✘ aparece**: o script mostra o que encontrou na linha anterior. Para investigar, veja os logs:
  `docker compose logs --since 5m characters characters-worker inventory`.
- **`r4` sem divisão de carga**: as réplicas novas demoram alguns segundos para se conectar. O script espera
  até 30 s. Rode de novo se a máquina estiver lenta.
- **`$'\r': command not found`**: o arquivo foi salvo com quebras de linha do Windows. O `.gitattributes` do
  repositório já força `LF` nos `.sh`. Se acontecer, rode `git checkout -- scripts/requisitos`.
