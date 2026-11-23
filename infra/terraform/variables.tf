variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "campaigns_access_key_id" { type = string }
variable "campaigns_secret_access_key" {
  type = string
  sensitive = true
}
variable "characters_access_key_id" { type = string }
variable "characters_secret_access_key" {
  type = string
  sensitive = true
}
variable "inventory_access_key_id" { type = string }
variable "inventory_secret_access_key" {
  type = string
  sensitive = true
}
variable "identity_access_key_id" { type = string }
variable "identity_secret_access_key" {
  type = string
  sensitive = true
}
variable "campaigns_endpoint_url" { type = string }
variable "characters_endpoint_url" { type = string }
variable "inventory_endpoint_url" { type = string }
variable "identity_endpoint_url" { type = string }

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
