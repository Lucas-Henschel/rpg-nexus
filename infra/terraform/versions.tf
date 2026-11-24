terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }

    rabbitmq = {
      source  = "cyrilgdn/rabbitmq"
      version = "~> 1.8"
    }
  }

  # Estado local. No Compose o caminho vem de -backend-config (volume terraform-state).
  backend "local" {}
}

# O mesmo código serve para a AWS real e para o MiniStack: muda só o endpoint.
provider "aws" {
  alias      = "campaigns"
  region     = var.aws_region
  access_key = var.campaigns_access_key_id
  secret_key = var.campaigns_secret_access_key

  # Emulador local: sem conta AWS de verdade para validar.
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    dynamodb = var.campaigns_endpoint_url
    s3       = var.campaigns_endpoint_url
  }
}

provider "aws" {
  alias                       = "characters"
  region                      = var.aws_region
  access_key                  = var.characters_access_key_id
  secret_key                  = var.characters_secret_access_key
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true
  endpoints {
    dynamodb = var.characters_endpoint_url
    s3       = var.characters_endpoint_url
  }
}

provider "aws" {
  alias                       = "inventory"
  region                      = var.aws_region
  access_key                  = var.inventory_access_key_id
  secret_key                  = var.inventory_secret_access_key
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true
  endpoints {
    dynamodb = var.inventory_endpoint_url
    s3       = var.inventory_endpoint_url
  }
}

provider "aws" {
  alias                       = "identity"
  region                      = var.aws_region
  access_key                  = var.identity_access_key_id
  secret_key                  = var.identity_secret_access_key
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true
  endpoints {
    dynamodb = var.identity_endpoint_url
    s3       = var.identity_endpoint_url
  }
}

# Fala com a API de gerenciamento do RabbitMQ (a mesma do painel web).
provider "rabbitmq" {
  endpoint = var.rabbitmq_management_url
  username = var.rabbitmq_user
  password = var.rabbitmq_password
}
