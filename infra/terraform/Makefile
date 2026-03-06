ENV ?= staging

init:
	cd environments/$(ENV) && terraform init

plan:
	cd environments/$(ENV) && terraform plan -var-file=terraform.tfvars

apply:
	cd environments/$(ENV) && terraform apply -var-file=terraform.tfvars

destroy:
	cd environments/$(ENV) && terraform destroy -var-file=terraform.tfvars

fmt:
	terraform fmt -recursive .

validate:
	cd environments/$(ENV) && terraform init -backend=false && terraform validate

output:
	cd environments/$(ENV) && terraform output

# Uso:
# make plan ENV=staging
# make apply ENV=staging
# make plan ENV=production
