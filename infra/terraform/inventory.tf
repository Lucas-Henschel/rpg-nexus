# Recursos de nuvem do S3 Inventário, espelhando infra/manifests/inventory.json: as tabelas
# DynamoDB com chave `id`. O prefixo vem de services/inventory/.env.example (env.tf), o mesmo que o
# serviço usa para montar o nome de cada tabela.
locals {
  inventory_tables = ["stocks", "inventory", "acquisition_sagas", "inventory_inbox", "inventory_outbox", "shops", "shop_items", "campaign_members", "saga_history"]
}

resource "aws_dynamodb_table" "inventory" {
  for_each = toset(local.inventory_tables)

  name         = "${local.inventory_env["INVENTORY_TABLE_PREFIX"]}${each.key}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}
