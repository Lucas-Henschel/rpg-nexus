output "dynamodb_tables" {
  description = "Tabelas DynamoDB de cada serviço."
  value = {
    campaigns = [
      aws_dynamodb_table.campaigns.name,
      aws_dynamodb_table.campaign_members.name,
      aws_dynamodb_table.campaign_activity.name,
      aws_dynamodb_table.campaign_operations.name,
      aws_dynamodb_table.campaign_inbox.name,
    ]
    characters = [
      aws_dynamodb_table.characters.name,
      aws_dynamodb_table.inbox.name,
      aws_dynamodb_table.outbox.name,
      aws_dynamodb_table.read_model.name,
    ]
  }
}

output "assets_bucket" {
  description = "Bucket dos retratos."
  value       = aws_s3_bucket.assets.bucket
}

output "rabbitmq_queues" {
  description = "Filas declaradas no RabbitMQ."
  value       = sort(keys(rabbitmq_queue.this))
}
