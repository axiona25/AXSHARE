variable "aws_region" {
  type    = string
  default = "eu-west-1"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "secret_key" {
  type      = string
  sensitive = true
}

variable "backend_image" {
  type    = string
  default = "ghcr.io/axshare/backend:staging"
}

variable "frontend_image" {
  type    = string
  default = "ghcr.io/axshare/frontend:staging"
}
