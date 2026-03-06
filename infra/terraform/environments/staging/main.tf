provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "axshare"
      Environment = "staging"
    }
  }
}

module "vpc" {
  source      = "../../modules/vpc"
  project     = "axshare"
  environment = "staging"
  azs         = ["${var.aws_region}a", "${var.aws_region}b"]
}

module "alb" {
  source         = "../../modules/alb"
  project        = "axshare"
  environment    = "staging"
  vpc_id         = module.vpc.vpc_id
  public_subnets = module.vpc.public_subnets
}

module "rds" {
  source         = "../../modules/rds"
  project        = "axshare"
  environment    = "staging"
  vpc_id         = module.vpc.vpc_id
  subnet_ids     = module.vpc.private_subnets
  allowed_sg_id  = module.alb.backend_sg_id
  db_password    = var.db_password
  instance_class = "db.t3.micro"
  multi_az       = false
}

module "elasticache" {
  source        = "../../modules/elasticache"
  project       = "axshare"
  environment   = "staging"
  vpc_id        = module.vpc.vpc_id
  subnet_ids    = module.vpc.private_subnets
  allowed_sg_id = module.alb.backend_sg_id
}

module "s3" {
  source      = "../../modules/s3"
  project     = "axshare"
  environment = "staging"
  region      = var.aws_region
}

module "ecs" {
  source           = "../../modules/ecs"
  project          = "axshare"
  environment      = "staging"
  vpc_id           = module.vpc.vpc_id
  private_subnets  = module.vpc.private_subnets
  backend_sg_id    = module.alb.backend_sg_id
  target_group_arn = module.alb.target_group_arn
  backend_image    = var.backend_image
  frontend_image   = var.frontend_image
  database_url     = "postgresql+asyncpg://${module.rds.db_username}:${var.db_password}@${module.rds.endpoint}:${module.rds.port}/${module.rds.db_name}"
  redis_url        = "rediss://${module.elasticache.primary_endpoint}:6379"
  secret_key       = var.secret_key
  s3_bucket        = module.s3.bucket_name
  aws_region       = var.aws_region
}
