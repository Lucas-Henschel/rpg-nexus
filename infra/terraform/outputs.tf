output "dynamodb_tables" {
  description = "Tabelas do S2 Personagens."
  value = [
    aws_dynamodb_table.characters.name,
    aws_dynamodb_table.inbox.name,
    aws_dynamodb_table.outbox.name,
    aws_dynamodb_table.read_model.name,
  ]
}

output "assets_bucket" {
  description = "Bucket dos retratos."
  value       = aws_s3_bucket.assets.bucket
}
