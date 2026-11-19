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
