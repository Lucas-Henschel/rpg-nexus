# Tabelas DynamoDB do S4 Identidade. Os nomes vêm de services/identity/.env.example (env.tf).

resource "aws_dynamodb_table" "identity_users" {
  name         = local.identity_env["TABLE_USERS"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }
}

# Reserva atômica dos e-mails e nomes de usuário normalizados.
resource "aws_dynamodb_table" "identity_unique_identifiers" {
  name         = local.identity_env["TABLE_IDENTITIES"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "identityKey"

  attribute {
    name = "identityKey"
    type = "S"
  }
}

# Refresh tokens ficam somente como hash; o DynamoDB remove sessões expiradas pelo TTL.
resource "aws_dynamodb_table" "identity_sessions" {
  name         = local.identity_env["TABLE_SESSIONS"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sessionId"

  attribute {
    name = "sessionId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}


# Contadores e bloqueios temporários de login; as chaves são hashes, nunca e-mails ou usernames.
resource "aws_dynamodb_table" "identity_login_attempts" {
  name         = local.identity_env["TABLE_LOGIN_ATTEMPTS"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "throttleKey"

  attribute {
    name = "throttleKey"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

resource "aws_dynamodb_table" "action_history" {
  name         = local.identity_env["TABLE_HISTORY"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "campaignId"
  range_key    = "historyKey"

  attribute {
    name = "campaignId"
    type = "S"
  }

  attribute {
    name = "historyKey"
    type = "S"
  }
}

# Projeção de participantes usada para autorizar a leitura do histórico.
resource "aws_dynamodb_table" "action_history_memberships" {
  name         = local.identity_env["TABLE_HISTORY_MEMBERSHIPS"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "campaignId"
  range_key    = "userId"

  attribute {
    name = "campaignId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }
}

resource "aws_dynamodb_table" "action_history_inbox" {
  name         = local.identity_env["TABLE_HISTORY_INBOX"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "messageId"

  attribute {
    name = "messageId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# Auditoria de segurança do S4; eventos são append-only e não contêm credenciais.
resource "aws_dynamodb_table" "identity_audit" {
  name         = local.identity_env["TABLE_AUDIT"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "auditId"

  attribute {
    name = "auditId"
    type = "S"
  }
}


# Inbox idempotente e outbox transacional da dependência externa simulada.
resource "aws_dynamodb_table" "action_validation_inbox" {
  name         = local.identity_env["TABLE_VALIDATION_INBOX"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "messageId"

  attribute {
    name = "messageId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

resource "aws_dynamodb_table" "action_validation_outbox" {
  name         = local.identity_env["TABLE_VALIDATION_OUTBOX"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "messageId"

  attribute {
    name = "messageId"
    type = "S"
  }
}
