output "kms_key_arns" {
  value     = { for k, v in aws_kms_key.sops_env : k => v.arn }
}

output "gh_oidc_role_arns" {
  value     = { for k, v in aws_iam_role.gh_oidc : k => v.arn }
}

output "sso_developers_permission_set_arn" {
  value = aws_ssoadmin_permission_set.developers.arn
}

output "ec2_policy_arns" {
  value = { for k, v in aws_iam_policy.ec2_sops_decrypt : k => v.arn }
}
