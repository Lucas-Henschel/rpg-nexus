variable "aws_region" {
  type    = string
  default = "us-east-1"
}

# Credenciais fictícias de cada serviço no próprio MiniStack (CAMPAIGNS_AWS_ACCESS_KEY_ID etc.).
variable "campaigns_access_key_id" {
  description = "Credencial do S1 Campanhas no MiniStack dele."
  type        = string
}

variable "campaigns_secret_access_key" {
  description = "Segredo do S1 Campanhas no MiniStack dele."
  type        = string
  sensitive   = true
}

variable "characters_access_key_id" {
  description = "Credencial do S2 Personagens no MiniStack dele (DynamoDB e bucket dos retratos)."
  type        = string
}

variable "characters_secret_access_key" {
  description = "Segredo do S2 Personagens no MiniStack dele."
  type        = string
  sensitive   = true
}

variable "inventory_access_key_id" {
  description = "Credencial do S3 Inventário no MiniStack dele."
  type        = string
}

variable "inventory_secret_access_key" {
  description = "Segredo do S3 Inventário no MiniStack dele."
  type        = string
  sensitive   = true
}

variable "identity_access_key_id" {
  description = "Credencial do S4 Identidade (e do identity-validator) no MiniStack dele."
  type        = string
}

variable "identity_secret_access_key" {
  description = "Segredo do S4 Identidade no MiniStack dele."
  type        = string
  sensitive   = true
}

# Endpoint de cada MiniStack. No Compose, o nome do contêiner na rede de dados do serviço.
variable "campaigns_endpoint_url" {
  description = "MiniStack do S1 (CAMPAIGNS_AWS_ENDPOINT_URL), ex.: http://ministack-campaigns:4566."
  type        = string
}

variable "characters_endpoint_url" {
  description = "MiniStack do S2 (CHARACTERS_AWS_ENDPOINT_URL), ex.: http://ministack:4566."
  type        = string
}

variable "inventory_endpoint_url" {
  description = "MiniStack do S3 (INVENTORY_AWS_ENDPOINT_URL), ex.: http://ministack-inventory:4566."
  type        = string
}

variable "identity_endpoint_url" {
  description = "MiniStack do S4 (IDENTITY_AWS_ENDPOINT_URL), ex.: http://ministack-identity:4566."
  type        = string
}

variable "assets_bucket" {
  description = "Bucket dos retratos (RPG_ASSETS_BUCKET)."
  type        = string
  default     = "rpg-assets"
}

variable "cors_allowed_origin" {
  description = "Origem do front-end liberada no CORS do bucket."
  type        = string
  default     = "http://localhost:5173"
}

variable "rabbitmq_management_url" {
  description = "API de gerenciamento do RabbitMQ. No Compose é http://rabbitmq:15672."
  type        = string
  default     = "http://localhost:15672"
}

variable "rabbitmq_user" {
  description = "Credencial fictícia do RabbitMQ local (RABBITMQ_USER)."
  type        = string
  default     = "dev"
}

variable "rabbitmq_password" {
  description = "Credencial fictícia do RabbitMQ local (RABBITMQ_PASSWORD)."
  type        = string
  default     = "dev"
  sensitive   = true
}
