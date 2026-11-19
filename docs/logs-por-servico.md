# Logs por serviço no terminal

`docker compose up` mistura os logs de todos os contêineres. Para ver cada serviço no
seu próprio painel, use o **mprocs** com o arquivo `mprocs.yaml` da
raiz: a lista de serviços fica à esquerda e o log do selecionado à direita.

```
┌ Processos ──────┐┌ campaigns ──────────────────────────────────────┐
│ ▶ campaigns     ││ {"msg":"rabbitmq.connected", ...}               │
│   characters    ││ {"msg":"campaigns.activity.processed", ...}     │
│   frontend      ││                                                 │
│   rabbitmq      ││                                                 │
│   ministack     ││                                                 │
│   inicializad.. ││                                                 │
└─────────────────┘└─────────────────────────────────────────────────┘
```

É opcional: o sistema continua subindo só com `docker compose up`. O mprocs apenas
acompanha os logs dos contêineres que o Compose subiu (cada painel roda
`docker compose logs --follow <serviço>`).

O mprocs agora se chama **dekit**. O dekit traz o mprocs dentro dele, como
`dekit mprocs`, e é a versão mantida; instale o dekit.

## Instalação

### macOS

```sh
brew install dekit
```

Sem Homebrew: `curl -fsSL https://dekit.run/install.sh | sh`.

### Linux

```sh
curl -fsSL https://dekit.run/install.sh | sh
```

Também dá com o Homebrew para Linux (`brew install dekit`).

### Windows

No PowerShell:

```powershell
irm https://dekit.run/install.ps1 | iex
```

Use o **Windows Terminal** (ou o terminal do VS Code); o console antigo do `cmd.exe`
não desenha bem a interface. O Docker Desktop precisa estar aberto.

### Qualquer sistema, pelo npm

Com o Node instalado ([Instalação do Node.js](instalacao-node.md)):

```sh
npm install -g @dekit/cli
```

### Conferir

Feche e abra o terminal depois de instalar, e então:

```sh
dekit --version
```

## Uso

Na raiz do repositório:

```sh
docker compose up --build --detach --wait   # sobe tudo em segundo plano
dekit mprocs                                # abre os painéis de log
```

Para sair, `q`. Os contêineres continuam rodando; para pará-los, `docker compose down`.

| Tecla | O que faz |
| --- | --- |
| `↑` `↓` (ou `k` `j`) | Escolhe o serviço |
| `Ctrl` + `a` | Alterna entre a lista e o log (com o foco no log, a rolagem funciona) |
| `Ctrl` + `u` / `Ctrl` + `d` | Rola o log para cima / para baixo |
| `z` | Amplia o log, escondendo a lista |
| `r` | Reabre o log do serviço selecionado |
| `v` | Modo de seleção, para copiar um trecho (`c` copia, `Esc` sai) |
| `q` | Sai |

O painel **terraform** mostra o contêiner que cria a infraestrutura e termina. Ele não fica
acompanhando: mostra o que o Terraform escreveu e para. Se ele falhou, o erro aparece ali.

## Adicionar um serviço

Ao colocar um serviço novo no `docker-compose.yml`, acrescente um bloco no `mprocs.yaml`
com o nome do serviço do Compose no fim:

```yaml
  inventory:
    cmd: ["docker", "compose", "logs", "--follow", "--no-log-prefix", "--tail", "200", "inventory"]
```

O `cmd` é uma lista (programa e argumentos), e não uma linha de texto, para rodar igual no
Windows, no Linux e no macOS, sem depender do shell de cada um.

## Problemas comuns

- **`dekit: command not found`** (ou "não é reconhecido" no Windows): o terminal foi
  aberto antes da instalação. Abra outro.
- **Painel vazio ou que termina na hora**: a pilha não está no ar. Rode
  `docker compose up --build --detach --wait` e, no mprocs, selecione o serviço e aperte `r`.
- **O log parou depois de um `docker compose up --build`**: o contêiner foi recriado e o
  acompanhamento antigo terminou. Selecione o serviço e aperte `r` (ou saia e abra o mprocs
  de novo).
- **`no such service`**: o nome no `mprocs.yaml` não é o mesmo do `docker-compose.yml`.
- **Já usa o mprocs antigo** (`npm install -g mprocs` ou `scoop install mprocs`): funciona com
  o mesmo arquivo; rode `mprocs` no lugar de `dekit mprocs`.
