# Recursos de nuvem do S2 Personagens, espelhando infra/manifests/characters.json.
# Um `terraform apply` em ambiente vazio recria tudo: quatro tabelas DynamoDB e o bucket S3 com CORS.

# Fichas (sk = PROFILE) e reservas da Saga (sk = HOLD#{operationId}) sob a mesma chave de partição.
resource "aws_dynamodb_table" "characters" {
  name         = var.table_characters
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
    type = "S"
  }

  # Índice esparso: só as fichas têm gsi1pk, então "listar por campanha" não varre as reservas.
  global_secondary_index {
    name            = "byCampaign"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }
}

# Idempotência (R1): uma linha por messageId já processado; expira sozinha pelo TTL.
resource "aws_dynamodb_table" "inbox" {
  name         = var.table_inbox
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

# Outbox transacional: eventos gravados junto com o efeito e publicados depois pelo relay.
resource "aws_dynamodb_table" "outbox" {
  name         = var.table_outbox
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "messageId"

  attribute {
    name = "messageId"
    type = "S"
  }

  attribute {
    name = "pendingKey"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  # Índice esparso só com os eventos ainda não publicados, em ordem de criação.
  global_secondary_index {
    name            = "pending"
    hash_key        = "pendingKey"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# Modelo de leitura (CQRS): um resumo por personagem; "painel da campanha" é uma Query pela chave primária.
resource "aws_dynamodb_table" "read_model" {
  name         = var.table_read_model
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

# Retratos dos personagens: characters/{characterId}/portrait.
resource "aws_s3_bucket" "assets" {
  bucket = var.assets_bucket
}

# O navegador envia e lê o retrato direto no S3 por URL pré-assinada.
resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = [var.cors_allowed_origin]
    allowed_headers = ["*"]
    max_age_seconds = 300
  }
}
