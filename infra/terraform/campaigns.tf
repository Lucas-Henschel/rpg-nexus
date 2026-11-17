# Tabelas DynamoDB do S1 Campanhas. Os nomes vêm de services/campaigns/.env.example (env.tf).
# As mesmas tabelas são descritas em services/campaigns/src/db/setup.ts, usado nos testes e fora do Docker.

resource "aws_dynamodb_table" "campaigns" {
  name         = local.campaigns_env["TABLE_CAMPAIGNS"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "campaignId"

  attribute {
    name = "campaignId"
    type = "S"
  }
}

# Participantes de uma campanha.
resource "aws_dynamodb_table" "campaign_members" {
  name         = local.campaigns_env["TABLE_MEMBERS"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "campaignId"
  range_key    = "characterId"

  attribute {
    name = "campaignId"
    type = "S"
  }

  attribute {
    name = "characterId"
    type = "S"
  }
}

# Atividade de uma campanha, ordenada pela data (activityKey = occurredAt#operationId).
resource "aws_dynamodb_table" "campaign_activity" {
  name         = local.campaigns_env["TABLE_ACTIVITY"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "campaignId"
  range_key    = "activityKey"

  attribute {
    name = "campaignId"
    type = "S"
  }

  attribute {
    name = "activityKey"
    type = "S"
  }
}

# Operações já contadas (uma aquisição conta uma vez só, mesmo vinda em mensagens diferentes).
resource "aws_dynamodb_table" "campaign_operations" {
  name         = local.campaigns_env["TABLE_OPERATIONS"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "operationId"

  attribute {
    name = "operationId"
    type = "S"
  }
}

# Mensagens já processadas; o DynamoDB apaga cada uma quando passa o `expiresAt`.
resource "aws_dynamodb_table" "campaign_inbox" {
  name         = local.campaigns_env["TABLE_INBOX"]
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
