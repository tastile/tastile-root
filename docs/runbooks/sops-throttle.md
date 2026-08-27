# KMS Throttling Incident Response

If CI fails with `ThrottlingException: KMS.Decrypt`:

1. **Confirm region + service quota**

   ```bash
   aws service-quotas get-service-quota --service-code kms --quota-code L-C2DCB1FB --region ap-northeast-1
   ```

   Default: 5500 req/s. If traffic is below quota, contact AWS support.

2. **Reduce decrypt frequency**

   sops decrypts each `.env.<env>.sops` once per CI job. Cache the decrypted
   file across jobs in the same workflow run via `actions/cache@v4` keyed on
   the sops file SHA256.

3. **Exponential backoff**

   The loader retries up to 3 times with exponential backoff (1s, 2s, 4s). If
   exhausted, the job fails.

4. **Quota increase**

   File via AWS Support Center; expected turnaround 24-48 hours. Provide
   workload description and region.