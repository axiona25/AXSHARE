# Sbloccare dopo aver creato bucket S3 e tabella DynamoDB (vedi infra/terraform/backend.tf).
# terraform {
#   backend "s3" {
#     bucket         = "axshare-terraform-state"
#     key            = "axshare/staging/terraform.tfstate"
#     region         = "eu-west-1"
#     dynamodb_table = "axshare-terraform-locks"
#     encrypt        = true
#   }
# }
