variable "aws_endpoint_url" {
  description = "Endpoint das APIs AWS. No Compose é o MiniStack (http://ministack:4566); no host, http://localhost:4566."
  type        = string
  default     = "http://localhost:4566"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_access_key_id" {
  description = "Credencial fictícia do emulador."
  type        = string
  default     = "test"
}

variable "aws_secret_access_key" {
  description = "Credencial fictícia do emulador."
  type        = string
  default     = "test"
  sensitive   = true
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

variable "table_characters" {
  type    = string
  default = "characters"
}

variable "table_inbox" {
  type    = string
  default = "character_inbox"
}

variable "table_outbox" {
  type    = string
  default = "character_outbox"
}

variable "table_read_model" {
  type    = string
  default = "character_read_model"
}
