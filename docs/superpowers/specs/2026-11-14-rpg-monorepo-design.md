# Base do monorepo do sistema de fichas de RPG

## Intenção

Criar uma fundação reprodutível para o trabalho de Sistemas Distribuídos da FURB. O produto será um sistema genérico e simplificado de fichas de RPG, com suporte futuro a personagens, campanhas e rolagens de dados. Esta etapa não implementa regras de negócio nem os microsserviços; ela prepara a estrutura, o ambiente local e os contratos para que quatro integrantes possam trabalhar em paralelo.

## Objetivos

- Manter um único repositório para serviços, contratos, infraestrutura, documentação e automação.
- Usar Java, Python e TypeScript em serviços independentes.
- Subir toda a pilha local — infraestrutura e futuros serviços — com `pnpm dev`, que delega ao Docker Compose.
- Disponibilizar RabbitMQ e MiniStack para desenvolvimento sem conta de nuvem. O MiniStack emula as APIs AWS de S3 e DynamoDB.
- Centralizar comandos de desenvolvimento, verificação e limpeza sem impor um runtime aos serviços que não usam Node.js.
- Reservar uma estrutura explícita para os contratos de eventos e uma convenção única de envelope de mensagens.

## Fora de escopo nesta etapa

- Criar os quatro microsserviços, suas regras de negócio ou suas tabelas finais.
- Criar APIs HTTP, consumidores RabbitMQ, bancos exclusivos por serviço ou fluxos de compensação.
- Configurar deploy em AWS, MiniStack ou qualquer nuvem pública.
- Escolher definitivamente o modelo de domínio ou o sistema de RPG atendido.

## Restrições do trabalho

- A entrega final precisa ter pelo menos quatro microsserviços em ao menos três linguagens.
- A mensageria será RabbitMQ; S3 e DynamoDB completam as categorias de serviços de nuvem escolhidas.
- Cada serviço futuro terá Dockerfile, endpoint de saúde e banco/armazenamento próprio.
- Mensagens precisarão de contrato explícito e envelope com `messageId`, `correlationId`, `type`, `version`, `occurredAt` e `payload`.
- Configurações e endpoints devem vir de variáveis de ambiente.

## Abordagens consideradas

### Turborepo e pnpm com Docker Compose (escolhida)

O Turbo executa tarefas do repositório e o pnpm hospeda apenas os pacotes Node/TypeScript compartilhados. Java e Python mantêm seus gerenciadores e scripts próprios. Um Makefile oferece comandos neutros entre linguagens, e o Compose é a porta de entrada do ambiente local. Esta opção preserva a escolha do grupo por Turborepo sem forçar Java ou Python no ecossistema Node.

### Docker Compose e Makefile sem Turborepo

É uma opção mais enxuta e plenamente neutra entre linguagens, mas não aproveita cache nem grafo de tarefas do Turbo e abandona a ferramenta que o grupo pretende adotar.

## Desenho proposto

```text
raiz
├── apps/                  # aplicações TypeScript futuras, se necessárias
├── services/              # um diretório por microsserviço poliglota
├── contracts/             # AsyncAPI, JSON Schema e exemplos de eventos
├── infra/
│   ├── rabbitmq/          # definição, plugins e inicialização locais
│   └── ministack/         # criação versionada de buckets e tabelas AWS emuladas
├── scripts/               # automações de inicialização e validação
├── docs/                  # arquitetura, decisões e demonstrações
├── docker-compose.yml     # infraestrutura e, depois, serviços
├── compose.dev.yml        # sobreposições voltadas ao desenvolvimento
├── .env.example           # variáveis sem segredos
├── Makefile               # interface neutra: up, down, logs, verify
├── package.json           # scripts raiz e Turbo
├── pnpm-workspace.yaml    # apenas apps/pacotes TypeScript
└── turbo.json             # grafo de tarefas Node/TypeScript
```

### Ambiente local

`docker compose up` inicia:

1. RabbitMQ com painel de administração e volume nomeado.
2. MiniStack, único emulador AWS na porta `4566`, com as APIs S3 e DynamoDB.
3. Um contêiner de inicialização idempotente que cria buckets S3 e, quando definidos, tabelas DynamoDB e outros recursos de cada serviço.

Os serviços futuros recebem `AWS_ENDPOINT_URL=http://ministack:4566` no Compose e `http://localhost:4566` quando executados na máquina. Um arquivo `.env` local, criado a partir de `.env.example`, concentra portas, nomes de recursos, região e credenciais de desenvolvimento. Nenhum segredo real será versionado.

### Automação e contratos

O `pnpm dev` é a interface principal de execução e delega a `docker compose up --build`, iniciando toda a pilha declarada. `pnpm dev:detached` inicia a mesma pilha em segundo plano e aguarda os health checks; `pnpm down` a encerra. O Turbo fica responsável por tarefas de verificação, build e testes dos pacotes Node/TypeScript, sem tentar substituir o orquestrador de runtime poliglota. O Makefile oferece atalhos neutros (`bootstrap`, `up`, `down`, `logs`, `reset-local`, `verify`) e delega para pnpm/Docker ou às ferramentas de cada serviço. `reset-local` será explícito e removerá apenas volumes identificados deste projeto.

Os contratos viverão em `contracts/events/`, com um README que fixa o envelope comum e regras de versionamento. A primeira implementação incluirá somente o contrato-base e validações estruturais; eventos de domínio serão adicionados com cada fluxo de serviço.

### Integração futura

Cada microsserviço terá um diretório próprio em `services/`, seu manifesto de dependências, Dockerfile, `.dockerignore`, testes e documentação de execução. Não haverá bibliotecas de domínio compartilhadas entre serviços; no máximo, esquemas de contrato gerados ou reutilizados a partir de `contracts/`.

## Decisões assumidas nesta etapa

- O ambiente de desenvolvimento será totalmente local, sem provisionar recursos reais em nuvem.
- O MiniStack emula as APIs S3 e DynamoDB no mesmo endpoint local, com credenciais fictícias. Os adaptadores dos serviços devem permitir apontar para AWS em uma futura implantação.
- A modelagem de cada bucket e tabela DynamoDB continuará propriedade do respectivo serviço, mesmo que a criação seja reunida no script de inicialização local.
- O repositório terá três serviços de infraestrutura desde o início, mas nenhum serviço de negócio vazio será criado para evitar scaffolds que finjam implementação.
- A escolha final dos quatro serviços, do serviço de entrada assíncrona e da saga de compensação será uma etapa posterior de arquitetura de domínio.

## Critérios de aceite da base

- Um clone novo, com Docker e Node/pnpm instalados, consegue preparar o ambiente a partir do README.
- `pnpm dev` inicia toda a pilha declarada pelo Compose; `pnpm dev:detached` deixa RabbitMQ e MiniStack saudáveis, e S3 e DynamoDB respondem no endpoint AWS local do MiniStack.
- A inicialização é repetível e cria os recursos locais declarados sem intervenção manual.
- `make verify` valida a configuração Compose, os arquivos de contrato e as tarefas Turbo existentes.
- Nenhuma credencial, volume de dados ou configuração específica de uma máquina entra no Git.

## Pontos a definir antes dos serviços

- Quais serão exatamente os quatro microsserviços e qual integrante implementará cada um.
- Qual serviço receberá a API assíncrona e armazenará o status consultável.
- Qual recurso escasso terá concorrência controlada e qual fluxo terá compensação.
- Se DynamoDB será suficiente para todos os dados ou se algum serviço precisará de outro banco, mantendo a propriedade isolada.
