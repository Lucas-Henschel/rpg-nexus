# RPG Monorepo Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma base de monorepo reproduzível que inicie RabbitMQ e MiniStack, com contratos versionáveis e comandos únicos de desenvolvimento local.

**Architecture:** O repositório mantém os serviços poliglotas independentes em `services/` e reserva `apps/` apenas para aplicações TypeScript futuras. `pnpm dev` é a entrada única do ambiente e delega a Docker Compose, que inicia infraestrutura e todos os futuros serviços declarados; RabbitMQ cuida de eventos e MiniStack expõe S3 e DynamoDB em `:4566`. pnpm/Turborepo coordenam tarefas JavaScript de validação, build e teste, enquanto Make oferece atalhos neutros ao restante do projeto.

**Tech Stack:** Node.js 22, pnpm 11.25.0, Turborepo 2.11.11, Docker Compose 5, RabbitMQ Management, MiniStack, AWS CLI, JSON Schema draft 2020-12.

**Spec:** `docs/superpowers/specs/2026-11-14-rpg-monorepo-design.md`

## Global Constraints

- O ambiente local usa RabbitMQ para mensageria e MiniStack para as APIs S3 e DynamoDB.
- O endpoint AWS é `http://ministack:4566` no Compose e `http://localhost:4566` na máquina hospedeira.
- Credenciais de desenvolvimento são fictícias e nenhuma credencial real é versionada.
- Cada futuro serviço preservará seu próprio Dockerfile, manifesto e dados; não criar serviços de negócio vazios nesta etapa.
- Contratos usam o envelope com `messageId`, `correlationId`, `type`, `version`, `occurredAt` e `payload`.
- A inicialização deve ser idempotente e todo ambiente deve subir com `pnpm dev`, que delega a `docker compose up --build`.

## Review Focus

- Arquivo `.env` ausente: `docker compose config` deve aceitar apenas valores seguros declarados em `.env.example`; validado na Task 2.
- MiniStack ainda inicializando: o inicializador deve aguardar o health check antes de chamar S3/DynamoDB; validado na Task 3.
- Segunda inicialização: criação do bucket deve ser segura quando ele já existe; validado na Task 3.
- Evento sem um dos seis campos obrigatórios: a validação do contrato deve falhar; validado na Task 1.
- Execução no host em vez da rede Compose: o comando de smoke deve usar `localhost:4566`, não o nome do serviço Docker; validado na Task 4.

---

### Task 1: Inicializar o monorepo e o contrato de evento

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `contracts/events/event-envelope.schema.json`
- Create: `contracts/examples/event-envelope.valid.json`
- Create: `contracts/examples/event-envelope.invalid.json`
- Create: `contracts/README.md`
- Create: `scripts/validate-contracts.mjs`

**Interfaces:**
- Consumes: arquivos JSON de `contracts/examples/`.
- Produces: `pnpm validate:contracts`, `pnpm dev`, `pnpm dev:detached` e `pnpm down`. A validação encerra com status 0 somente quando o exemplo válido passa e o inválido falha na validação contra `event-envelope.schema.json`; `dev` chama Compose anexado e `dev:detached` chama Compose em segundo plano aguardando health checks.

- [ ] **Step 1: Escrever os exemplos de contrato e a asserção de validação que devem falhar**

Criar o exemplo válido com os seis campos do envelope e payload objeto; criar o inválido sem `messageId`; fazer `scripts/validate-contracts.mjs` emitir erro enquanto o esquema não existir.

- [ ] **Step 2: Executar a validação para confirmar a falha**

Run: `pnpm validate:contracts`

Expected: FAIL indicando que o esquema do envelope não foi encontrado ou que o exemplo não é validável.

- [ ] **Step 3: Implementar o esquema e a configuração raiz**

Criar o JSON Schema draft 2020-12 que exige `messageId`, `correlationId`, `type`, `version`, `occurredAt` e `payload`; `messageId` e `correlationId` são strings UUID, `occurredAt` é date-time, `version` é inteiro positivo e `payload` é objeto. Configurar `package.json` com `packageManager: "pnpm@11.25.0"`, `turbo@2.11.11`, `ajv`, `validate:contracts`, `dev` (`docker compose up --build`), `dev:detached` (`docker compose up --build --detach --wait`) e `down` (`docker compose down`); declarar `apps/*` e `packages/*` no workspace sem incluir `services/*`.

- [ ] **Step 4: Executar a validação do contrato e a tarefa Turbo**

Run: `pnpm install --frozen-lockfile && pnpm validate:contracts && pnpm turbo run validate:contracts`

Expected: PASS; o exemplo válido passa, o inválido é rejeitado e Turbo executa a tarefa raiz.

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json contracts scripts/validate-contracts.mjs
git commit -m "chore: initialize monorepo tooling and event contract"
```

### Task 2: Declarar a infraestrutura Docker local

**Files:**
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `infra/rabbitmq/README.md`
- Create: `infra/ministack/README.md`

**Interfaces:**
- Consumes: variáveis de `.env` com defaults seguros de `.env.example`.
- Produces: serviços Compose `rabbitmq`, `ministack` e `aws-init`; RabbitMQ fica disponível em `localhost:5672`/`localhost:15672`, e MiniStack em `localhost:4566`.

- [ ] **Step 1: Escrever a verificação Compose antes da definição**

Criar a chamada documentada `docker compose --env-file .env.example config --quiet` e executá-la antes de existir `docker-compose.yml`.

- [ ] **Step 2: Executar a verificação para confirmar a falha**

Run: `docker compose --env-file .env.example config --quiet`

Expected: FAIL porque a definição Compose e/ou o arquivo de ambiente ainda não existe.

- [ ] **Step 3: Implementar os serviços e variáveis do Compose**

Definir RabbitMQ Management com volume nomeado, usuário de desenvolvimento, health check `rabbitmq-diagnostics -q ping` e portas parametrizadas. Definir MiniStack com imagem `ministackorg/ministack`, volume nomeado, health check que chama a AWS CLI interna contra `http://localhost:4566`, e a porta `MINISTACK_PORT` com default `4566`. Definir `aws-init` como contêiner AWS CLI de execução única, dependente do health do MiniStack e que chama `infra/ministack/init-resources.sh`. Declarar explicitamente as redes e os volumes de projeto.

- [ ] **Step 4: Validar a definição Compose**

Run: `docker compose --env-file .env.example config --quiet`

Expected: PASS sem variáveis não resolvidas; `rabbitmq`, `ministack` e `aws-init` aparecem em `docker compose config --services`.

- [ ] **Step 5: Commit**

```bash
git add .env.example docker-compose.yml infra/rabbitmq/README.md infra/ministack/README.md
git commit -m "infra: add local rabbitmq and ministack compose stack"
```

### Task 3: Inicializar recursos AWS emulados de forma idempotente

**Files:**
- Create: `infra/ministack/init-resources.sh`
- Create: `infra/ministack/test-init-resources.sh`

**Interfaces:**
- Consumes: `AWS_ENDPOINT_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e `RPG_ASSETS_BUCKET`.
- Produces: bucket S3 `RPG_ASSETS_BUCKET`; retorna sucesso em inicializações repetidas; confirma que a API DynamoDB responde a `list-tables`.

- [ ] **Step 1: Escrever o teste idempotente que deve falhar**

Criar `test-init-resources.sh` para executar duas vezes o inicializador contra o endpoint configurado, verificar o bucket com `s3api head-bucket` e verificar DynamoDB com `dynamodb list-tables`; fazê-lo falhar enquanto o inicializador não existir.

- [ ] **Step 2: Rodar o teste para confirmar a falha**

Run: `docker compose run --rm aws-init /work/infra/ministack/test-init-resources.sh`

Expected: FAIL porque `init-resources.sh` ainda não existe.

- [ ] **Step 3: Implementar `init-resources.sh`**

Implementar um script POSIX com `set -eu` que usa AWS CLI e `--endpoint-url "$AWS_ENDPOINT_URL"`; usar `head-bucket` antes de `create-bucket`, tolerando somente o caso de bucket já existente. Ao final, chamar `aws dynamodb list-tables` para comprovar a API. Não criar tabela de domínio enquanto não houver um serviço proprietário.

- [ ] **Step 4: Subir e repetir a inicialização**

Run: `docker compose up -d --wait rabbitmq ministack && docker compose run --rm aws-init && docker compose run --rm aws-init`

Expected: PASS nas duas execuções; o bucket aparece em `aws s3api list-buckets` e `aws dynamodb list-tables` responde no MiniStack.

- [ ] **Step 5: Commit**

```bash
git add infra/ministack/init-resources.sh infra/ministack/test-init-resources.sh docker-compose.yml
git commit -m "infra: initialize ministack resources idempotently"
```

### Task 4: Expor a interface de desenvolvimento e documentar o bootstrap

**Files:**
- Create: `Makefile`
- Create: `scripts/smoke-local.sh`
- Create: `README.md`

**Interfaces:**
- Consumes: a pilha definida em `docker-compose.yml` e os valores de `.env`.
- Produces: `make bootstrap`, `make up`, `make down`, `make logs`, `make verify`, `make smoke` e `make reset-local`; `up` delega a `pnpm dev:detached`, `down` delega a `pnpm down`, e `reset-local` remove somente os volumes nomeados do Compose deste projeto.

- [ ] **Step 1: Escrever o smoke test que deve falhar**

Criar `scripts/smoke-local.sh` que testa o endpoint de saúde do RabbitMQ em `localhost`, executa AWS CLI em contêiner contra `http://localhost:4566`, confere o bucket e chama DynamoDB `list-tables`; fazê-lo falhar enquanto Makefile e Compose ainda não expõem a interface.

- [ ] **Step 2: Executar o smoke test para confirmar a falha**

Run: `make smoke`

Expected: FAIL com alvo inexistente ou dependência indisponível.

- [ ] **Step 3: Implementar Makefile, smoke e README**

Fazer `bootstrap` criar `.env` somente se inexistente, a partir de `.env.example`; `up` delegar a `pnpm dev:detached`; `down` delegar a `pnpm down`; `verify` executar validação Compose e `pnpm validate:contracts`; `smoke` executar o script de smoke; `reset-local` executar `docker compose down --volumes --remove-orphans` e deve ser documentado como destrutivo. Documentar `pnpm dev` como entrada principal anexada e `pnpm dev:detached` como variante em segundo plano, além de pré-requisitos, primeiro uso, portas, variáveis e a separação entre endpoint host/Compose.

- [ ] **Step 4: Executar a verificação completa**

Run: `make bootstrap && make verify && pnpm dev:detached && make smoke && pnpm down`

Expected: PASS; o comando único inicia a pilha, RabbitMQ responde, o bucket existe e MiniStack atende S3 e DynamoDB pelo endpoint local.

- [ ] **Step 5: Commit**

```bash
git add Makefile README.md scripts/smoke-local.sh .env.example
git commit -m "docs: add local development workflow"
```

### Task 5: Revisar reprodutibilidade e preparar o repositório Git

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`
- Modify: `docs/superpowers/specs/2026-11-14-rpg-monorepo-design.md`

**Interfaces:**
- Consumes: todos os comandos e recursos entregues nas Tasks 1 a 4.
- Produces: repositório Git inicializado, árvore limpa após `make down`, e instruções que permitem a outra pessoa reproduzir a base.

- [ ] **Step 1: Fazer a auditoria de arquivos versionáveis**

Run: `git init && git status --short && find . -maxdepth 2 -name '.env' -o -name 'node_modules' -o -name '.turbo'`

Expected: `.env`, dependências e caches não aparecem como arquivos a versionar.

- [ ] **Step 2: Ajustar instruções de reprodução quando a auditoria encontrar lacunas**

Documentar qualquer requisito adicional descoberto durante o smoke e garantir que `.env`, `node_modules`, `.turbo` e dados locais estejam ignorados.

- [ ] **Step 3: Repetir a verificação de clone limpo**

Run: `git status --short && make verify && docker compose --env-file .env.example config --quiet`

Expected: PASS e nenhuma configuração local/segredo aparece no status.

- [ ] **Step 4: Commit**

```bash
git add README.md .gitignore docs/superpowers/specs/2026-11-14-rpg-monorepo-design.md
git commit -m "chore: document reproducible local setup"
```

## Self-review

1. **Cobertura da especificação:** a Task 1 cobre monorepo, Turbo e contratos; Tasks 2 e 3 cobrem Compose, RabbitMQ, MiniStack, S3, DynamoDB, variáveis e inicialização; Task 4 cobre a interface local, verificação e documentação; Task 5 cobre reprodução e higiene Git. Serviços e decisões de domínio permanecem corretamente fora de escopo.
2. **Granularidade:** cada tarefa entrega um componente validável e cada etapa tem uma ação e resultado verificável.
3. **Consistência:** todos os consumidores usam `AWS_ENDPOINT_URL`, `RPG_ASSETS_BUCKET` e os serviços Compose `rabbitmq`, `ministack` e `aws-init` definidos nesta ordem.
4. **Review Focus:** os cinco riscos enumerados têm testes nas Tasks 1 a 4.
5. **Proporção:** o plano fixa interfaces, arquivos, variáveis e comandos sem antecipar a implementação dos serviços de negócio.
