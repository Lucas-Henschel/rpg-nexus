# Instalação do Node.js

Necessário apenas para desenvolver os projetos JavaScript (serviços Node e front
React) ou validar os contratos fora do Docker. Para subir o sistema, basta o Docker.

Use **Node.js 24 LTS** (mínimo 22). O `npm` já vem junto.

## macOS e Linux (recomendado: nvm)

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

## Windows

Instale pelo `winget` (PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS
```

Ou baixe o instalador LTS em [nodejs.org](https://nodejs.org/). Feche e abra o
terminal após a instalação.

## Conferir

```sh
node --version   # v24.x (ou v22.x no mínimo)
npm --version
```

## Uso nos projetos

Cada projeto JavaScript é independente, com seu próprio `package.json` e
`package-lock.json`. Dentro da pasta do projeto:

```sh
npm ci      # instala exatamente as versões do lockfile
npm test
```

## Problemas comuns

- **`command not found: node`**: o terminal foi aberto antes da instalação. Abra
  um novo terminal. Com nvm, confira se `nvm use 24` está ativo.
- **`EACCES` ao instalar pacotes globais (Linux/macOS)**: o Node foi instalado
  pelo sistema. Prefira o nvm, que instala no diretório do usuário.
