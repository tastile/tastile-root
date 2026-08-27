# GitHub OIDC provider (existing or created once)
data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count = 0 # set to 1 if not already created elsewhere in the account
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

data "aws_iam_openid_connect_provider" "github_existing" {
  count = 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_arn = aws_iam_openid_connect_provider.github[0].arn
}

# Per-env GitHub OIDC role
resource "aws_iam_role" "gh_oidc" {
  for_each = var.environments
  name = "tastile-gh-oidc-${each.key}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.github_oidc_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/*:environment:${each.key}"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "gh_oidc_decrypt" {
  for_each = var.environments
  name   = "tastile-sops-decrypt-${each.key}"
  role   = aws_iam_role.gh_oidc[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "DecryptForEnv"
      Effect   = "Allow"
      Action   = ["kms:Decrypt", "kms:DescribeKey"]
      Resource = aws_kms_key.sops_env[each.key].arn
    }]
  })
}

# SSO developer permission set
resource "aws_ssoadmin_permission_set" "developers" {
  name         = "tastile-sso-developers"
  description  = "Tastile developers; KMS Encrypt + Decrypt for sops envs"
  instance_arn = var.sso_instance_arn
}

resource "aws_ssoadmin_managed_policy_attachment" "developers_kms" {
  instance_arn       = var.sso_instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.developers.arn
  managed_policy_arn = aws_iam_policy.developers_kms.arn
}

resource "aws_iam_policy" "developers_kms" {
  name        = "tastile-sso-developers-kms"
  description = "KMS Encrypt/Decrypt + sops key describe for developers"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:GenerateDataKey",
      ]
      Resource = [for k in aws_kms_key.sops_env : k.arn]
    }]
  })
}

# EC2 instance profile policy (assume existing instance profile is named)
resource "aws_iam_policy" "ec2_sops_decrypt" {
  for_each = toset(var.ec2_instance_profile_names)
  name     = "tastile-ec2-sops-decrypt-${each.key}"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["kms:Decrypt", "kms:DescribeKey"]
      Resource = [for k in aws_kms_key.sops_env : k.arn]
    }]
  })
}

# Attach to each named instance profile
resource "aws_iam_role_policy_attachment" "ec2_sops_attach" {
  for_each = toset(var.ec2_instance_profile_names)
  role     = each.key
  policy_arn = aws_iam_policy.ec2_sops_decrypt[each.key].arn
}
