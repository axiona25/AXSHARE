variable "project" { type = string }
variable "environment" { type = string }
variable "region" { type = string }

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "files" {
  bucket = "${var.project}-${var.environment}-files-${random_id.bucket_suffix.hex}"
  tags   = { Environment = var.environment, Project = var.project }
}

resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

output "bucket_name" { value = aws_s3_bucket.files.id }
output "bucket_arn" { value = aws_s3_bucket.files.arn }
