# S4 — Identidade

Parte inicial do Serviço 4 responsável por cadastro e autenticação. O serviço usa
Fastify, TypeScript e três tabelas DynamoDB próprias: usuários, identificadores
únicos e sessões.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/auth/register` | Cria usuário `USER` e inicia uma sessão. |
| `POST` | `/auth/login` | Autentica por e-mail ou nome de usuário. |
| `POST` | `/auth/refresh` | Rotaciona o refresh token e emite novo acesso. |
| `POST` | `/auth/logout` | Revoga a sessão; a operação é idempotente. |
| `GET` | `/auth/me` | Retorna o usuário do access token. |
| `GET` | `/health` | Verifica o processo HTTP. |
| `GET` | `/ready` | Verifica o acesso às tabelas. |

O access token usa `HS256`, com `sub=userId`, `username`, `email` e
`globalRole=USER`, além de `iss`, `aud`, `iat` e `exp`. Os demais serviços devem
validar assinatura, algoritmo, emissor, audiência e expiração. O segredo deve ser
compartilhado por variável segura e nunca enviado ao navegador.

Senhas são armazenadas com `scrypt`, salt aleatório e comparação em tempo
constante. Refresh tokens são opacos, rotacionados a cada uso e persistidos apenas
como SHA-256. Senhas, access tokens e refresh tokens são removidos dos logs HTTP.

## Desenvolvimento

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Com MiniStack disponível e as variáveis de `.env.example` carregadas:

```sh
npm run create-tables
npm start
```

No ambiente completo, use `docker compose up --build identity` na raiz.
