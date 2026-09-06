// Stub for Task 2 — Task 1 (Terraform) is not yet applied, so the real per-env
// KMS key ARNs are not known. Task 3 will replace these placeholders with the
// real values pulled from `terraform apply` outputs at tastile-root/infra/.
export type IdentityHint = "sso" | "oidc" | "instance-profile";

export type SopsEnvConfig = {
  kmsKeyArn: string;
  awsRegion: string;
  pairs: { source: string; target: string }[];
  identityHint: IdentityHint;
};

export const config: Record<string, SopsEnvConfig> = {
  development: {
    kmsKeyArn: "arn:aws:kms:ap-northeast-1:000000000000:key/PLACEHOLDER-DEV",
    awsRegion: "ap-northeast-1",
    pairs: [
      { source: ".env.development.sops", target: ".env.development" },
      { source: ".env.dev.sops", target: ".env.dev" },
    ],
    identityHint: "sso",
  },
  staging: {
    kmsKeyArn: "arn:aws:kms:ap-northeast-1:000000000000:key/PLACEHOLDER-STG",
    awsRegion: "ap-northeast-1",
    pairs: [
      { source: ".env.staging.sops", target: ".env.staging" },
    ],
    identityHint: "oidc",
  },
  production: {
    kmsKeyArn: "arn:aws:kms:ap-northeast-1:000000000000:key/PLACEHOLDER-PRD",
    awsRegion: "ap-northeast-1",
    pairs: [
      { source: ".env.production.sops", target: ".env.production" },
      { source: ".env.product.sops", target: ".env.product" },
    ],
    identityHint: "instance-profile",
  },
};
