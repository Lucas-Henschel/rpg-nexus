# Instalação do Node.js e do pnpm

O monorepo usa **Node.js 24 LTS** (mínimo 22) e o **pnpm** na versão fixada no
campo `packageManager` do `package.json` (atualmente `pnpm@11.25.0`).

## 1. Node.js

### macOS e Linux (recomendado: nvm)

O [nvm](https://github.com/nvm-sh/nvm) permite instalar e alternar versões do
Node sem `sudo`.

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

Feche e abra o terminal (ou rode `source ~/.zshrc` / `source ~/.bashrc`) e então:

```sh
nvm install 24
nvm use 24
nvm alias default 24
```

> Alternativa no macOS: `brew install node@24`.

### Windows

Instale pelo `winget` (PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS
```

Ou baixe o instalador LTS em [nodejs.org](https://nodejs.org/). Feche e abra o
terminal após a instalação.

### Conferir

```sh
node --version   # v24.x (ou v22.x no mínimo)
npm --version
```

## 2. pnpm

Instale a mesma versão declarada no `package.json`:

```sh
npm install --global pnpm@11.25.0
```

> Alternativa: `npm install --global corepack && corepack enable`. O Corepack lê o
> campo `packageManager` e usa automaticamente a versão correta do pnpm.

### Conferir

```sh
pnpm --version   # 11.25.0
```

## 3. Instalar as dependências do projeto

Na raiz do repositório:

```sh
pnpm install --frozen-lockfile
pnpm test
```

`pnpm test` deve imprimir `PASS` para os dois exemplos de contrato.

## Problemas comuns

- **`command not found: pnpm` ou `node`**: o terminal foi aberto antes da
  instalação. Abra um novo terminal. Com nvm, confira se `nvm use 24` está ativo.
- **`EACCES` ao instalar pacotes globais (Linux/macOS)**: o Node foi instalado
  pelo sistema. Prefira o nvm, que instala no diretório do usuário.
- **Versão do pnpm diferente**: rode novamente
  `npm install --global pnpm@11.25.0`.
