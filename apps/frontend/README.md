# Frontend — RPG Nexus

React + TypeScript + Vite. É um cliente das APIs dos microsserviços, não um quinto serviço.

## Rodar

Precisa do Node.js 20 ou mais novo.

```
cd apps/frontend
npm install
npm run dev
```

Ou, pelo Docker, na raiz do monorepo: `docker compose up --build frontend` (o serviço `frontend` do
`docker-compose.yml` faz o build e serve em `http://localhost:5173`).

Abra `http://localhost:5173`. A porta é fixa porque é a origem liberada no CORS dos serviços.

Os endereços dos serviços vêm de variáveis `VITE_*`. Os padrões já apontam para as portas do plano
(Personagens em `http://localhost:8000`); para mudar, copie `.env.example` para `.env`.

## O que já funciona

| Área | Estado | Serviço |
|---|---|---|
| Início | pronto; mostra se cada serviço está no ar (`GET /health`) | todos |
| Personagens | pronto: listar por campanha, criar a partir de um modelo ou em branco, ficha livre em blocos, atributos, perícias, pontos de vida, mochila, retrato (S3), itens pedidos | S2 (P2) |
| Dados | pronto: bandeja de dados com animação, em qualquer tela; sorteio no navegador | (S4 depois, com `POST /rolls`) |
| Campanhas | página de espera com o que falta construir | S1 (P1) |
| Itens | página de espera | S3 (P3) |
| Histórico | página de espera | S4 (P4) |

Enquanto o serviço de Campanhas não existe, a campanha é um código digitado na tela de Personagens
(padrão `c1`), guardado no navegador.

## Ficha livre e dados

- **Modelos** (`src/sheet/templates.ts`): pontos de partida genéricos (em branco, fantasia, investigação,
  ficção científica, regras leves). Para criar outro, acrescente um item à lista `TEMPLATES`.
- **Blocos** (`src/features/characters/`): a ficha são duas colunas de blocos. Atributos, perícias, vida
  e mochila mostram dados da própria ficha; texto, contador, rolagens e lista guardam o conteúdo em
  `block.data`. "Organizar ficha" mostra os controles de mover, trocar de coluna, remover e adicionar.
  Tudo é salvo no campo `sheet` do personagem.
- **Dados** (`src/components/DiceTray.tsx`, `src/sheet/dice.ts`): `useDice()(rótulo, "2d6+3")` joga os
  dados de qualquer tela. As perícias rolam d20 + valor.

## Como completar a sua área

1. Crie o adaptador em `src/api/<area>.ts`, no modelo de `src/api/characters.ts`. As telas não chamam
   `fetch` direto; usam `request()` de `src/api/http.ts`, que já trata o formato de erro
   `{"error": {"code", "message"}}`.
2. Crie as telas em `src/features/<area>/` e troque a página de espera correspondente em
   `src/App.tsx` (as de espera ficam em `src/features/placeholders/pages.tsx`).
3. O endereço do serviço já está em `src/config.ts`.
4. Libere `http://localhost:5173` no CORS do seu serviço e exponha os headers que a tela precisar ler.

## Estrutura

```text
src/
├── api/            http.ts (cliente), characters.ts (S2), health.ts
├── components/     Header, Toast, Sheet (papel, barra de vida, mochila), StatsEditor
├── features/
│   ├── home/           página inicial
│   ├── characters/     lista, criação e ficha
│   └── placeholders/   Campanhas, Itens e Histórico, a construir
├── styles/         tokens.css (cores e fontes), base.css, sheet.css, pages.css
├── router.tsx      roteador pequeno sobre a History API
├── labels.ts       chave do serviço ("forca") ↔ rótulo ("Força")
└── config.ts       URLs dos serviços
```

## Visual

A tela é a mesa de jogo à noite (feltro verde-escuro, luz de abajur) e o que pertence ao jogador é
papel quadriculado sobre ela. Cores e fontes ficam em `src/styles/tokens.css`. Peças para reaproveitar:

- `Paper`: folha de papel; use para qualquer conteúdo "do jogador".
- `.button--brass` sobre o feltro, `.button--ink` sobre o papel.
- `.ink-input`: campo escrito na linha, para usar dentro do papel.
- `.notice`: estados vazios e de erro sobre o feltro.

Fontes: Alegreya (títulos e números) e Alegreya Sans (texto), carregadas do Google Fonts no `index.html`.

## Limitações

- O serviço guarda chaves de atributo sem acento. `src/labels.ts` devolve o acento só para nomes
  conhecidos ("forca" → "Força"); um nome novo com acento aparece sem ele.
- `npm run build` não roda a checagem de tipos; use `npm run typecheck`.
