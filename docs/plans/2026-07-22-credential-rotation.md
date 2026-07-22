# 2026-07-22 — Credential Rotation Runbook (open-sourcing prerequisite)

## Why this doc exists

`docs/HARNESS.md` §13 requires a written runbook before destructive infra
operations. This plan rotates secrets that were already committed
(`tastile-web/.env.product`, `tastile-web/.env.dev`) **before**
`git filter-repo` rewrites history. Without rotation, the rewritten history
is moot — anyone with the original commits retains the secrets until they
expire.

This plan is bound to the open-sourcing plan
`C:\Users\rebui\.claude\plans\ui-web-android-desktop-apace-license-2-0-snazzy-cray.md`
Steps "Critical pre-conditions" and Step 6.

---

## Secrets to rotate

| # | Secret | Where it lives (committed + runtime) | Owner action |
|---|---|---|---|
| S1 | `STRIPE_SECRET_KEY=sk_live_51TAQy0…` | `tastile-web/.env.product` (committed) + systemd `tastile-web.env` on EC2 | Disable at Stripe dashboard; issue new test-mode key |
| S2 | `STRIPE_WEBHOOK_SECRET=whsec_ikrJKE…` | same | Rotate at Stripe dashboard; update webhook endpoint |
| S3 | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…` | same + GitHub `tastile-web` repo secrets | Issue test-mode publishable key; replace runtime + rebuild |
| S4 | `STRIPE_PRO_MONTHLY_PRICE_ID=price_1Tq81X…` | same | Issue new test-mode prices at dashboard |
| S5 | `STRIPE_PRO_YEARLY_PRICE_ID=price_1Tq82E…` | same | same |
| S6 | `TASTILE_WEB_BRIDGE_SECRET=E5S…Ng4d` | `tastile-web/.env.dev` + `.env.product` + systemd `/etc/tastile/demo.env` on EC2 | Generate fresh; deploy to all host EC2 systemd files |
| S7 | Cognito app client secret for `ap-northeast-1_buh6oWoQ2` | Not committed (correct), but rotate to be safe | Rotate via `aws cognito-idp update-user-pool-client` |
| S8 | `tastile-core` GitHub PAT (`CORE_REPO_READ_TOKEN`) | `tastile-desktop/.env` (empty value, not actually set) | Revoke at GitHub Settings → Developer settings → PAT |
| S9 | Google Web OAuth client secret for `639871096587-…apps.googleusercontent.com` | Not committed, used at runtime | Rotate via Google Cloud Console → APIs & Services → Credentials |
| S10 | `GOOGLE_WEB_CLIENT_ID` value in `tastile-android/gradle.properties` | committed | Replace value with one issued against the new demo Google Cloud project |
| S11 | AWS access keys for `tastile-github-actions` IAM role | Not used — role uses OIDC. No static keys. | Skip |
| S12 | Slack/Linear/PagerDuty API tokens (not in repo per inventory) | n/a | Verify with `git log -p | gitleaks detect` after Step 5 |

---

## Pre-flight checks

```bash
# Verify AWS CLI auth as an admin who can mutate the relevant services.
aws sts get-caller-identity --query Arn --output text

# Confirm the production Cognito user pool is intact (we are NOT deleting it,
# only opening self-service on a NEW pool for the demo).
aws cognito-idp describe-user-pool \
  --user-pool-id ap-northeast-1_buh6oWoQ2 \
  --query 'UserPool.Name'
# Expected output: "tastile-v1-app"

# Confirm production RDS is reachable (so we can re-deploy the daemon env
# AFTER rotating secrets).
aws rds describe-db-instances \
  --db-instance-identifier tastile-v1-postgres \
  --query 'DBInstances[0].DBInstanceStatus'
# Expected: "available"
```

---

## Stripe dashboard operations (browser)

Step-by-step in the Stripe dashboard (https://dashboard.stripe.com):

1. Switch to **Live mode** (top-right toggle).
2. **Developers → API keys**: Roll the `Secret key` and `Publishable key`.
   Copy the new `sk_live_…` and `pk_live_…` somewhere temporary.
3. **Developers → Webhooks**: For each endpoint, "Roll secret" — copy the new
   `whsec_…`.
4. **Products → Pro monthly / Pro yearly**: Recreate (or archive + create)
   the two recurring prices; copy the new `price_…` IDs.
5. Switch to **Test mode**; perform the same four steps above and keep the
   test-mode values for the demo (S3).
6. **Audit log → Activity**: scan the last 90 days for any
   `payment_intent.succeeded` or `charge.succeeded` calls that you did NOT
   initiate. If any exist, escalate to security review before proceeding.

After Step 6, both live and test-mode secrets are freshly issued; the
historical exposed values cannot be used to move money.

---

## AWS CLI operations (this Windows host)

### Cognito: rotate app-client secret for the existing pool

```bash
# List app clients for the prod pool.
aws cognito-idp list-user-pool-clients \
  --user-pool-id ap-northeast-1_buh6oWoQ2

# Capture the ClientId of the public SPA client (the plan mentions
# 3f14cs42nkc0v3qf6k57gthlfe).
CLIENT_ID=3f14cs42nkc0v3qf6k57gthlfe
USER_POOL_ID=ap-northeast-1_buh6oWoQ2

# Generate a new client secret. AWS does not expose "rotate" for the
# SPA client (GenerateSecret=false), so this is a no-op for SPA — but if
# you have a backend client with a secret, it applies.
aws cognito-idp describe-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --query 'UserPoolClient.{GenerateSecret:GenerateSecret,Name:ClientName}'
# Expected: "GenerateSecret": false (SPA).
# → No secret rotation possible for this client. Move on.
```

### EC2: write the new bridge secret to systemd EnvironmentFile

```bash
# List running web instances.
aws ec2 describe-instances \
  --filters 'Name=tag:Project,Values=tastile-web' \
  'Name=instance-state-name,Values=running' \
  --query 'Reservations[].Instances[].{ID:InstanceId,EIP:PublicIpAddress,ENV:Tags[?Key==`Name`]|[0].Value}'

# For each instance, run a shell command via SSM to update the env file.
# Replace the placeholders before running.
NEW_BRIDGE_SECRET=__REPLACE_WITH_NEW_VALUE__
INSTANCE_IDS="i-0123 i-0456"  # space-separated
ENV_FILE_PATH="/etc/tastile/tastile.env"   # currently
NEW_ENV_FILE_PATH="/etc/tastile/demo.env"  # target demo env file

for INSTANCE_ID in $INSTANCE_IDS; do
  aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters commands=(
      "sudo cp $ENV_FILE_PATH $ENV_FILE_PATH.bak-\$(date -u +%Y%m%dT%H%M%SZ)"
      "sudo sed -i 's|^TASTILE_WEB_BRIDGE_SECRET=.*|TASTILE_WEB_BRIDGE_SECRET=$NEW_BRIDGE_SECRET|' $ENV_FILE_PATH"
      "sudo systemctl restart tastile-web.service"
      "echo ROTATED \$(date -u +%FT%TZ)"
    ) \
    --output text --query 'Command.CommandId'
done

# Verify the env var landed.
for INSTANCE_ID in $INSTANCE_IDS; do
  aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters commands="sudo grep ^TASTILE_WEB_BRIDGE_SECRET $ENV_FILE_PATH" \
    --output text
done
```

### Cognito: create the new "tastile-demo" pool (self-service sign-up)

```bash
USER_POOL_NAME=tastile-demo
USER_POOL_ID_NEW=$(aws cognito-idp create-user-pool \
  --pool-name "$USER_POOL_NAME" \
  --auto-verified-attributes email \
  --username-attributes email \
  --policies 'PasswordPolicy={MinimumLength=12,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true}' \
  --admin-create-user-only 'false' \
  --schema '[{Name=email,Required=true,Mutable=true},{Name=name,Required=false,Mutable=true}]' \
  --email-configuration 'EmailSendingAccount=DEVELOPER,From=auth-noreply@tastile.app' \
  --mfa-configuration 'OPTIONAL' \
  --query 'UserPool.Id' --output text)

echo "Created pool: $USER_POOL_ID_NEW"

# Create a user-pool domain for Hosted UI.
aws cognito-idp create-user-pool-domain \
  --domain tastile-demo \
  --user-pool-id "$USER_POOL_ID_NEW"

# Create the SPA client (no secret).
CLIENT_ID_NEW=$(aws cognito-idp create-user-pool-client \
  --user-pool-id "$USER_POOL_ID_NEW" \
  --client-name tastile-demo-web \
  --generate-secret false \
  --allowed-o-auth-flows 'code' \
  --allowed-o-auth-scopes 'openid email profile' \
  --allowed-o-auth-flows-user-pool-client true \
  --callback-urls '["https://app.demo.tastile.app/auth/cognito/callback"]' \
  --logout-urls '["https://app.demo.tastile.app/"]' \
  --supported-identity-providers '["Google","SignInWithApple","COGNITO"]' \
  --query 'UserPoolClient.ClientId' --output text)

echo "Created client: $CLIENT_ID_NEW (user pool $USER_POOL_ID_NEW)"

# Attach lambda trigger for sign-up confirmation email.
# (Pre-condition: create-custom-message lambda already deployed via
# docs/superpowers/specs/2026-07-06-cognito-aws-hardening-design.md.)
# aws cognito-idp update-user-pool \
#   --user-pool-id "$USER_POOL_ID_NEW" \
#   --lambda-config 'CustomMessage=arn:aws:lambda:ap-northeast-1:ACCOUNT:function:tastile-demo-custom-message'
```

### RDS: new demo database

```bash
# Subnet group
aws rds create-db-subnet-group \
  --db-subnet-group-name tastile-demo-subnets \
  --db-subnet-group-description "tastile-demo subnets" \
  --subnet-ids subnet-REPLACE subnet-REPLACE

# Security group
aws ec2 create-security-group \
  --group-name tastile-demo-rds \
  --description "tastile-demo RDS" \
  --vpc-id vpc-REPLACE
aws ec2 authorize-security-group-ingress \
  --group-id sg-REPLACE \
  --protocol tcp --port 5432 \
  --source-group sg-REPLACE-EC2

# RDS instance
aws rds create-db-instance \
  --db-instance-identifier tastile-demo-postgres \
  --db-instance-class db.t4g.micro \
  --engine postgres --engine-version 16.4 \
  --allocated-storage 20 --storage-type gp3 \
  --master-username tastile \
  --master-user-password "$DEMO_DB_PASSWORD" \
  --db-subnet-group-name tastile-demo-subnets \
  --vpc-security-group-ids sg-REPLACE-RDS \
  --no-multi-az --no-publicly-accessible \
  --backup-retention-period 7 \
  --query 'DBInstance.DBInstanceArn' --output text
```

### EIP + EC2 for the demo daemon

```bash
# Allocate EIP
EIP_ALLOC=$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text)
# Attach to a running demo instance
aws ec2 associate-address --instance-id i-REPLACE --allocation-id "$EIP_ALLOC"
```

### Domain (Cloudflare)

```bash
# Add A records for the demo subdomains.
for SUBDOMAIN in app api download; do
  curl -X POST "https://api.cloudflare.com/client/v4/zones/ZONE_ID/dns_records" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"$SUBDOMAIN.demo\",\"content\":\"$DEMO_EIP\",\"ttl\":300,\"proxied\":false}"
done
```

### S3 + EC2 for desktop download

```bash
aws s3 mb s3://tastile-demo-download --region ap-northeast-1
aws s3api put-bucket-encryption \
  --bucket tastile-demo-download \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSE":"AES256"}}]}'
aws s3api put-public-access-block \
  --bucket tastile-demo-download \
  --public-access-block-configuration '{"BlockPublicAcls":true,"IgnorePublicAcls":true,"BlockPublicPolicy":true,"RestrictPublicBuckets":true}'
```

---

## Billing alarm + kill-switch

```bash
# CloudWatch alarm: kill the demo EC2 if monthly cost > $30.
aws cloudwatch put-metric-alarm \
  --alarm-name tastile-demo-cost-cap \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 21600 \
  --evaluation-periods 1 \
  --threshold 30 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:ap-northeast-1:ACCOUNT:tastile-demo-alarms \
  --dimensions Name=Currency,Value=USD

# Billing alarm at $50: email.
aws cloudwatch put-metric-alarm \
  --alarm-name tastile-demo-billing-alert \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 21600 \
  --evaluation-periods 1 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:ap-northeast-1:ACCOUNT:tastile-demo-billing

# SNS topic for the kill-switch
TOPIC_ARN=$(aws sns create-topic --name tastile-demo-killswitch --query 'TopicArn' --output text)
# Lambda that stops the EC2 on receipt — covered by infra elsewhere.
```

---

## Verification

After all rotations:

```bash
# 1. Verify no live Stripe keys remain in any EC2 env file.
for INSTANCE_ID in $INSTANCE_IDS; do
  aws ssm send-command --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters commands="sudo grep -RE 'sk_live_|pk_live_|whsec_ikrJKE' /etc/tastile/ || echo CLEAN"
done

# 2. Confirm the new demo Cognito pool is reachable.
aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID_NEW" \
  --query 'UserPool.{Id:Id,Name:Name,AdminCreateUserOnly:AdminCreateUserConfig.AllowAdminCreateUserOnly}'

# 3. Browser-side smoke test: open https://app.demo.tastile.app → click
#    "Sign up" → enter a new email → confirm OTP works.
```

---

## Rollback

If the kill-switch fires before we know the demo is stable:

```bash
# Stop the demo instances.
for INSTANCE_ID in $DEMO_INSTANCE_IDS; do
  aws ec2 stop-instances --instance-ids "$INSTANCE_ID"
done

# Disable billing alarms so they don't page.
aws cloudwatch disable-alarm-actions \
  --alarm-names tastile-demo-cost-cap tastile-demo-billing-alert

# Re-enable later.
aws cloudwatch enable-alarm-actions \
  --alarm-names tastile-demo-cost-cap tastile-demo-billing-alert
```

---

## Out of scope for this runbook

* Removing the user-sub UUID-v5 derivation logic in `crates/v1/api/src/handlers/common.rs` — that lives in `tastile-core` and is the source of truth for owner identity; do not change here.
* `tastile-brands` content — already scrubbed in plan Step 7.
* Production Cognito policy changes — done out-of-band; see `feedback_cognito_emailotp_misconfigured_20260706.md` and `project_cognito_mfa_setup_flow.md` for prior recipes.
