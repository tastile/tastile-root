data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

resource "aws_kms_key" "sops_env" {
  for_each = var.environments

  description             = "Tastile sops envelope key for ${each.key}"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  multi_region            = false

  policy = jsonencode({
    Version = "2012-10-17"
    Id      = "tastile-sops-${each.key}"
    Statement = [
      {
        Sid    = "RootAccountManage"
        Effect = "Allow"
        Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "DecryptForSSO"
        Effect = "Allow"
        Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/aws-reserved/sso.amazonaws.com/ap-northeast-1/*" }
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = "*"
      },
      {
        Sid    = "DecryptForEC2"
        Effect = "Allow"
        Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/tastile-ec2-instance-profile" }
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_kms_alias" "sops_env" {
  for_each = var.environments
  name          = "alias/tastile-sops-${each.key}"
  target_key_id = aws_kms_key.sops_env[each.key].key_id
}
