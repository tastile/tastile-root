// Stub for Task 2 — Task 1 (Terraform) is not yet applied, so the real per-env
// KMS key ARNs are not known. Task 3 will replace these placeholders with the
// real values pulled from `terraform apply` outputs at tastile-root/infra/.
export type SopsEnvConfig = {
  kmsKeyArn: string;
  awsRegion: string;
  sourceFiles: string[];
  targetFiles: string[];
  check: boolean;
};

export const config: Record<string, SopsEnvConfig> = {
  development: {
    kmsKeyArn: "arn:aws:kms:ap-northeast-1:000000000000:key/PLACEHOLDER-DEV",
    awsRegion: "ap-northeast-1",
    sourceFiles: [".env.development.sops"],
    targetFiles: [".env.development"],
    check: false,
  },
  staging: {
    kmsKeyArn: "arn:aws:kms:ap-northeast-1:000000000000:key/PLACEHOLDER-STG",
    awsRegion: "ap-northeast-1",
    sourceFiles: [".env.staging.sops"],
    targetFiles: [".env.staging"],
    check: false,
  },
  production: {
    kmsKeyArn: "arn:aws:kms:ap-northeast-1:000000000000:key/PLACEHOLDER-PRD",
    awsRegion: "ap-northeast-1",
    sourceFiles: [".env.production.sops"],
    targetFiles: [".env.production"],
    check: false,
  },
};
