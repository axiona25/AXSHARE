variable "project" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allowed_sg_id" { type = string }
variable "db_name" {
  type    = string
  default = "axshare"
}
variable "db_username" {
  type    = string
  default = "axshare"
}
variable "db_password" {
  type      = string
  sensitive = true
}
variable "instance_class" {
  type    = string
  default = "db.t3.micro"
}
variable "multi_az" {
  type    = bool
  default = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-${var.environment}"
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "rds" {
  name   = "${var.project}-${var.environment}-rds-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.allowed_sg_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "main" {
  identifier                = "${var.project}-${var.environment}"
  engine                    = "postgres"
  engine_version            = "16.1"
  instance_class            = var.instance_class
  allocated_storage         = 20
  max_allocated_storage     = 100
  storage_encrypted         = true
  db_name                   = var.db_name
  username                  = var.db_username
  password                  = var.db_password
  db_subnet_group_name      = aws_db_subnet_group.main.name
  vpc_security_group_ids    = [aws_security_group.rds.id]
  multi_az                  = var.multi_az
  backup_retention_period   = 7
  backup_window             = "03:00-04:00"
  maintenance_window        = "Sun:04:00-Sun:05:00"
  deletion_protection       = var.environment == "production"
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${var.project}-${var.environment}-final" : null

  tags = {
    Environment = var.environment
    Project     = var.project
  }
}

output "endpoint" { value = aws_db_instance.main.endpoint }
output "port" { value = aws_db_instance.main.port }
output "db_name" { value = var.db_name }
output "db_username" { value = var.db_username }
