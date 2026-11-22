# S4 - Identidade e historico

Serviço 4 responsável por cadastro, autenticação e histórico. Usa Fastify,
TypeScript, DynamoDB e consome do RabbitMQ os resultados das aquisições para
montar a linha do tempo de cada campanha sem duplicar reentregas. A dependência externa
instável da Saga de compra fica no contêiner `identity-validator` (veja abaixo).

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/auth/register` | Cria usuário `USER` e inicia uma sessão. |
| `POST` | `/auth/login` | Autentica por e-mail ou nome de usuário. |
| `POST` | `/auth/refresh` | Rotaciona o refresh token e emite novo acesso. |
| `POST` | `/auth/logout` | Revoga a sessão; a operação é idempotente. |
| `GET` | `/auth/me` | Retorna o usuário do access token. |
| `GET` | `/campaigns/{campaignId}/history` | Lista eventos da campanha para participantes autenticados. |
| `GET` | `/health` | Verifica o processo HTTP. |
| `GET` | `/ready` | Verifica o acesso ao DynamoDB e ao RabbitMQ. |

O access token usa `HS256`, com `sub=userId`, `username`, `email` e
`globalRole=USER`, além de `iss`, `aud`, `iat` e `exp`. Os demais serviços devem
validar assinatura, algoritmo, emissor, audiência e expiração. O segredo deve ser
compartilhado por variável segura e nunca enviado ao navegador.

A leitura de histórico exige JWT válido e participação projetada na campanha.

O histórico do S4 é a **linha do tempo completa** da campanha. O S1 mostra, na página da campanha,
só um resumo (últimas 20 atividades e itens por participante); os dois consomem os mesmos eventos
de compra, cada um para a sua tela.

## Tracing distribuído

O S4 e o contêiner `identity-validator` exportam spans OpenTelemetry para o endpoint OTLP/HTTP
definido em `OTEL_EXPORTER_OTLP_ENDPOINT` (no Compose, Jaeger). O nome do serviço é `identity` no
processo de autenticação/histórico e `identity-validator` no consumidor da validação externa.
`TRACING_ENABLED` controla a instrumentação; o Compose a habilita pelo `backend-env`.

As rotas Fastify e operações do DynamoDB geram spans. Os consumidores extraem `traceparent` e
`tracestate` dos headers AMQP. O validador guarda esses headers junto à resposta pendente na outbox;
quando o relay publica a resposta, abre um span filho do processamento original e propaga o novo
contexto no AMQP. O contexto fica nos headers e não é adicionado ao envelope dos contratos. `/health`
e `/ready` são ignorados para evitar traces de sondagens.

Os testes em `test/tracing/` e `test/repositories/validation-repository.test.ts` cobrem a continuidade
HTTP/AMQP, o contexto gravado e recuperado pela outbox e os spans de acesso ao DynamoDB. Para
inspecionar no ambiente Compose, abra Jaeger em
`http://localhost:16686` e filtre pelos serviços `identity` e `identity-validator`. O trace completo
da compra também depende de S3/Inventário propagar o contexto na sua mensagem de saída.

## Validação externa simulada

O contêiner `identity-validator` (porta interna 3003, ponto de entrada `src/validator.ts`) usa a
mesma imagem do S4, mas roda separado: se ele ficar lento ou cair, login e histórico continuam
no ar. Ele consome `actions.validation-requested.v1`, espera um intervalo configurável e
publica `ExternalValidationSucceeded` ou `ExternalValidationFailed`. A solicitação
e a resposta são persistidas atomicamente em inbox/outbox; reentregas não criam
novas decisões. As variáveis `VALIDATION_MIN_DELAY_MS`,
`VALIDATION_MAX_DELAY_MS` e `VALIDATION_FAILURE_RATE` permitem demonstrar
latência, falha e expiração sem alterar o código. O valor padrão da taxa é zero,
para que o uso normal local não falhe aleatoriamente.

Senhas são armazenadas com `scrypt`, salt aleatório e comparação em tempo
constante. Cinco falhas de login dentro de 15 minutos bloqueiam temporariamente o
identificador por 15 minutos; as chaves persistidas são hashes e expiram por TTL. Refresh tokens são opacos, rotacionados a cada uso e persistidos apenas
como SHA-256. Senhas, access tokens e refresh tokens são removidos dos logs HTTP.

## Auditoria de segurança

O S4 grava eventos append-only na tabela DynamoDB `identity_audit`, criada pelo
Terraform a partir de `TABLE_AUDIT` em `services/identity/.env.example`. A
auditoria cobre cadastro, login bem-sucedido ou falho, bloqueio temporário,
tentativa de login de usuário inativo, renovação de sessão aceita ou rejeitada e
logout. Ela é armazenamento interno; não há endpoint HTTP para consultar os
eventos.

Cada registro contém um identificador, ação, resultado, horário e, quando
aplicável, `userId`, `sessionId`, motivo ou hash SHA-256 do identificador tentado
no login. E-mail, username, senha, hash de senha, access token e refresh token
não são copiados para o registro de auditoria. A aplicação também redige senha,
refresh token e cabeçalho `Authorization` dos logs HTTP; tokens retornados no
corpo da resposta não são registrados pelo logger do Fastify.

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

### Teste de integração no Compose

Com a pilha completa ativa e saudável, execute dentro de `services/identity`:

```sh
npm run test:integration
```

O teste usa S4, S1, DynamoDB e Docker para conferir sessões, bloqueio de login,
auditoria, histórico e ausência de segredos nos
registros do S4. Cada execução cria dois usuários e uma campanha. Os nomes usam identificadores aleatórios. Os dados permanecem no ambiente local e o teste não os apaga automaticamente.
As URLs podem ser sobrescritas com `S4_URL`, `S1_URL` e `AWS_ENDPOINT_URL`.

### Teste isolado da DLQ

Com o RabbitMQ acessível, execute `npm run test:dlq`. O teste cria filas duráveis
com nomes aleatórios, testa `inspect` e `replay` com uma mensagem válida
selecionada, outra válida não selecionada e envelopes inválidos, valida cada mensagem contra os JSON Schemas dos contratos, e verifica o que foi
reenviado ou preservado e apaga somente as duas filas temporárias criadas pelo
teste. A DLQ real `actions.history.v1.dlq` não é consumida.
