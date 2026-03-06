# Backend remoto per state Terraform.
# Prima di abilitare:
# 1. aws s3 mb s3://axshare-terraform-state --region eu-west-1
# 2. aws dynamodb create-table --table-name axshare-terraform-locks \
#      --attribute-definitions AttributeName=LockID,AttributeType=S \
#      --key-schema AttributeName=LockID,KeyType=HASH \
#      --billing-mode PAY_PER_REQUEST --region eu-west-1
#
# Poi decommentare il blocco sotto e usare -backend-config se necessario.
# Per ogni ambiente (staging/production) il key va impostato in backend.tf
# nella rispettiva cartella environments/<env>/.

# terraform {
#   backend "s3" {
#     bucket         = "axshare-terraform-state"
#     key            = "axshare/terraform.tfstate"
#     region         = "eu-west-1"
#     dynamodb_table = "axshare-terraform-locks"
#     encrypt        = true
#   }
# }
