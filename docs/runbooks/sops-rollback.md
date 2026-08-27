# sops Rollback

If sops decryption fails in production and AWS SSM Parameter Store still works:

1. **Revert the loader deploy**

   ```bash
   git checkout <last-good-tag>
   ```

   Redeploy the prior artifact via the existing deploy script.

2. **Restore plain .env from SSM**

   ```bash
   aws ssm get-parameters --names /tastile/web/.env.production --with-decryption --query 'Parameters[*].Value' --output text > /opt/tastile-web/.env.production
   chmod 600 /opt/tastile-web/.env.production
   systemctl restart tastile-web
   ```

3. **Revoke KMS Decrypt permission**

   ```bash
   aws kms put-key-policy --key-id <prod-key-id> --policy file://deny-decrypt.json --policy-name default
   ```

   (Or remove the EC2 instance profile attachment in Terraform.)

4. **Disable CI decrypt job**

   In `.github/workflows/build.yml`, set the `decrypt` job to `if: false`.
   (Note: actual workflow file per repo is `ci.yml` / `quality.yml` / `deploy.yml` — see Task 6's per-repo mapping.)

5. **Disable the loader in systemd**

   Comment out the `ExecStartPre=` line in `ops/systemd/tastile-web.service.example`
   and `systemctl daemon-reload`.

## Note

The `.env.<env>.sops` ciphertext remains in git history; this is intentional.
Removing the file does not undo the leak; revoking KMS access does.