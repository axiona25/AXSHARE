# Sbloccare dopo aver creato bucket S3 e tabella DynamoDB.
# terraform {
#   backend "s3" {
#     bucket         = "axshare-terraform-state"
#     key            = "axshare/production/terraform.tfstate"
#     region         = "eu-west-1"
#     dynamodb_table = "axshare-terraform-locks"
#     encrypt        = true
#   }
# }
