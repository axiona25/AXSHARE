variable "project" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allowed_sg_id" { type = string }
variable "node_type" {
  type    = string
  default = "cache.t3.micro"
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project}-${var.environment}"
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "redis" {
  name   = "${var.project}-${var.environment}-redis-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
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

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "${var.project}-${var.environment}"
  description                = "Redis for ${var.project} ${var.environment}"
  node_type                  = var.node_type
  num_cache_clusters         = var.environment == "production" ? 2 : 1
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  automatic_failover_enabled = var.environment == "production"
  auto_minor_version_upgrade = true

  tags = {
    Environment = var.environment
    Project     = var.project
  }
}

output "primary_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}
output "port" { value = 6379 }
