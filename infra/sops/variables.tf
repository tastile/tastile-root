variable "region" {
  type        = string
  default     = "ap-northeast-1"
  description = "AWS region for KMS keys + IAM principals"
}

variable "github_org" {
  type        = string
  default     = "tastile"
  description = "GitHub org for OIDC subject restriction"
}

variable "sso_instance_arn" {
  type        = string
  description = "AWS SSO instance ARN (existing)"
}

variable "ec2_instance_profile_names" {
  type        = list(string)
  default     = ["tastile-web-prod"]
  description = "Production EC2 instance profile names that need kms:Decrypt"
}

variable "environments" {
  type    = set(string)
  default = ["development", "staging", "production"]
}
