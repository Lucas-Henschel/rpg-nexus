terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Estado local. No Compose o caminho vem de -backend-config (volume terraform-state).
  backend "local" {}
}

# O mesmo código serve para a AWS real e para o MiniStack: muda só o endpoint.
provider "aws" {
  region     = var.aws_region
  access_key = var.aws_access_key_id
  secret_key = var.aws_secret_access_key

  # Emulador local: sem conta AWS de verdade para validar.
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    dynamodb = var.aws_endpoint_url
    s3       = var.aws_endpoint_url
  }
}
