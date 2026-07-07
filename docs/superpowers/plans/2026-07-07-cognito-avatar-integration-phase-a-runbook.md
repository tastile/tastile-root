# Phase 5 Runbook — Cognito Avatar Integration (Phase A)

> **Operator-driven E2E** for the 12-task avatar Phase A
> (backend handlers + S3/CloudFront infra + web `/api/me` BFF).
>
> Run on a workstation that has:
> - AWS CLI authenticated as `tastile-deploy` (or equivalent IAM
>   principal allowed to `cloudformation:*` + `s3:*` + `ssm:SendCommand`
>   on `tastile-foundation` + `i-09a0b66534f7c8c3e`)
> - `pwsh` 7+ (`brew install powershell` / Windows PowerShell 7)
> - A Cognito user in the staging pool — see "Bootstrap a test user"
>   below if you don't have one yet
> - The repos checked out at the Phase A tag/branch:
>   - `tastile-core` on branch `wslc-avatar` at HEAD `37086cf`
>     (last commit of Phase 3 CFN infra)
>   - `tastile-web` on branch `avatar-web-phase-a` at HEAD `9123f59`
>     (last commit of Phase 4 web BFF)

---

## 0. Pre-flight (no side effects)

```bash
# 0.1 verify you're on the right commit
cd "$(git rev-parse --show-toplevel)"   # tastile-core.wslc-avatar
git rev-parse HEAD                       # → 37086cf expected

# 0.2 verify AWS creds
aws sts get-caller-identity | jq -r '.Arn'

# 0.3 verify current foundation stack exists
aws cloudformation describe-stacks \
  --stack-name tastile-foundation --region ap-northeast-1 \
  --query "Stacks[0].StackStatus" --output text
# expected: UPDATE_COMPLETE / CREATE_COMPLETE

# 0.4 snapshot current stack outputs (for rollback reference)
aws cloudformation describe-stacks \
  --stack-name tastile-foundation --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='AppInstanceId' || OutputKey=='CognitoUserPoolId' || OutputKey=='AppPublicIp' || OutputKey=='DatabaseEndpoint'].{Key:OutputKey,Value:OutputValue}" \
  --output table
```

Expected:

| Key | Value |
| --- | --- |
| AppInstanceId | i-09a0b66534f7c8c3e |
| CognitoUserPoolId | ap-northeast-1_buh6oWoQ2 |
| AppPublicIp | 43.206.236.27 |
| DatabaseEndpoint | tastile-v1-postgres.ct0cqygo23kn.ap-northeast-1.rds.amazonaws.com |

### 0.5 Confirm AvatarBucket/AvatarCdn outputs are NOT yet present

```bash
aws cloudformation describe-stacks \
  --stack-name tastile-foundation --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?starts_with(OutputKey, 'Avatar')].OutputKey" \
  --output text
```

Expected: empty output (zero matches). If non-empty, the stack already
has Phase 3 resources — skip Step 1.

---

## 1. Deploy foundation stack (S3 + CloudFront)

> Creates 4 new resources behind the existing `tastile-foundation`
> stack: AvatarBucket (private, AES256, 1d pending lifecycle),
> AvatarOAI, AvatarBucketPolicy, AvatarDistribution
> (PriceClass_100, default *.cloudfront.net cert).
>
> CloudFront propagation takes **10–15 minutes** — the stack update
> itself completes in ~3 min, but the distribution status won't
> reach `Deployed` until DNS + edge propagation settles.  Cost:
> ~$0 for the bucket when idle, <$1/mo for PriceClass_100
> distribution, data transfer only on real traffic.

```bash
cd "$(git rev-parse --show-toplevel)"   # tastile-core.wslc-avatar
pwsh -File scripts/v1/deploy-foundation.ps1 -EnvironmentName v1
```

Expected:

```
== Tastile v1 foundation deploy ==
  ...
Final status: UPDATE_COMPLETE
```

### 1.1 Verify the new outputs exist

```bash
aws cloudformation describe-stacks \
  --stack-name tastile-foundation --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='AvatarBucketName' || OutputKey=='AvatarCdnDomain'].{Key:OutputKey,Value:OutputValue}" \
  --output table
```

Expected:

| Key | Value (example) |
| --- | --- |
| AvatarBucketName | tastile-v1-avatars |
| AvatarCdnDomain | d111111abcdef8.cloudfront.net |

### 1.2 Wait for CloudFront to deploy (manual)

```bash
DIST=$(aws cloudfront list-distributions-by-origin-access-identity \
  --query "DistributionList.Items[?Comment=='tastile-v1-avatars'].Id" \
  --output text)
echo "Distribution: $DIST"
aws cloudfront get-distribution --id "$DIST" \
  --query "Distribution.Status" --output text
# poll until "Deployed" (~10-15 min)
```

---

## 2. Deploy the v1-api binary

`deploy-core-v1.ps1` does three things Phase A needs:

1. Pull the current source (`wslc-avatar` HEAD `37086cf`) + build the
   `api` binary inside a Docker build container (Docker required on
   the workstation — `wslc` migration not yet landed per
   `tastile-root/CLAUDE.md`)
2. Upload the binary to `s3://tastile-deploy/tastile-api-<sha>`
3. SSM onto `i-09a0b66534f7c8c3e`:
   - swap the release symlink
   - **write TASTILE_AVATAR_BUCKET + TASTILE_AVATAR_CDN_BASE to
     `/etc/tastile/tastile.env`**, alongside TASTILE_WEB_BRIDGE_SECRET
     (committed in Phase 3, deploy-core-v1.ps1:75-103)
   - restart `tastile-api.service`

```bash
cd "$(git rev-parse --show-toplevel)"
pwsh -File scripts/v1/deploy-core-v1.ps1
```

Expected:

```
== Tastile v1 core (api) deploy ==
  ...
SSM command: <uuid>
SSM command: Success
```

### 2.1 Verify env vars landed on the instance

```bash
aws ssm send-command \
  --instance-ids i-09a0b66534f7c8c3e \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["sudo grep -E \"^TASTILE_AVATAR\" /etc/tastile/tastile.env"]' \
  --region ap-northeast-1 \
  --output text --query "Command.CommandId"
# then:
aws ssm get-command-invocation \
  --command-id <id> --instance-id i-09a0b66534f7c8c3e --region ap-northeast-1 \
  --query "StandardOutputContent" --output text
```

Expected:

```
TASTILE_AVATAR_BUCKET=tastile-v1-avatars
TASTILE_AVATAR_CDN_BASE=https://d111111abcdef8.cloudfront.net
```

### 2.2 Feature flag is OFF by default

```bash
ssh -i <key> ec2-user@43.206.236.27 \
  'sudo systemctl show tastile-api.service -p Environment'
```

Expected: no `TASTILE_FEATURE_AVATAR_ENABLED=1` in the dump.  The
handler returns `503 service_unavailable` while the flag is off —
this is the intended safe state.

To turn it on:

```bash
ssh ec2-user@43.206.236.27 \
  'echo "TASTILE_FEATURE_AVATAR_ENABLED=1" | sudo tee -a /etc/tastile/tastile.env
   sudo systemctl restart tastile-api.service
   sleep 2
   sudo systemctl is-active tastile-api.service'
```

---

## 3. Bootstrap a test user (if you don't have one)

```bash
POOL=ap-northeast-1_buh6oWoQ2
USER="avatar-test-$RANDOM@example.com"

# 3.1 create
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL" --username "$USER" \
  --user-attributes Name=email,Value="$USER" Name=email_verified,Value=true \
  --temporary-password "TempPass!2026" \
  --message-action SUPPRESS

# 3.2 set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL" --username "$USER" \
  --password "AvatarTest!2026" --permanent

# 3.3 log in and stash the JWT
JWT=$(curl -s -X POST \
  "https://cognito-idp.ap-northeast-1.amazonaws.com/$POOL/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=3f14cs42nkc0v3qf6k57gthlfe&username=$USER&password=AvatarTest!2026" \
  | jq -r '.id_token')

echo "$JWT" > /tmp/avatar-test.jwt
test -n "$JWT" && echo "JWT stashed at /tmp/avatar-test.jwt"
```

---

## 4. Smoke test the API

> Requires `TASTILE_FEATURE_AVATAR_ENABLED=1` on the instance (Step
> 2.2 above).  All curls target the API through CloudFlare (so
> `api.tastile.app`) — local IP works too if you skip CF for faster
> iteration, but the E2E contract is HTTPS through CloudFlare.

### 4.1 Look up owner_id from the JWT (mirrors /api/me logic)

```bash
SUB=$(jq -R 'split(".") | .[1] | @base64d | fromjson | .sub' < /tmp/avatar-test.jwt)
echo "sub=$SUB"
# uuidv5(NAMESPACE_OID, sub_bytes) — easiest to compute via the web
# BFF we just shipped:
OWNER_ID=$(curl -s -H "Cookie: id_token=$(cat /tmp/avatar-test.jwt)" \
  https://app.tastile.app/api/me | jq -r '.owner_id')
echo "owner_id=$OWNER_ID"
```

### 4.2 create_upload

```bash
curl -is -X POST https://api.tastile.app/v1/uploads/avatar \
  -H "Authorization: Bearer $(cat /tmp/avatar-test.jwt)" \
  -H "Content-Type: application/json" \
  -d "{\"target_kind\":0,\"target_id\":\"$OWNER_ID\",\"content_type\":\"image/webp\",\"byte_size\":1234}"
```

Expected:

```
HTTP/2 201
{"upload_id":"<uuid>","presigned_put_url":"https://tastile-v1-avatars.s3...","expires_at":"...","claim_token":"<jwt>"}
```

Stash the values:

```bash
RESP=$(curl -s -X POST https://api.tastile.app/v1/uploads/avatar \
  -H "Authorization: Bearer $(cat /tmp/avatar-test.jwt)" \
  -H "Content-Type: application/json" \
  -d "{\"target_kind\":0,\"target_id\":\"$OWNER_ID\",\"content_type\":\"image/webp\",\"byte_size\":46}")

UPLOAD_ID=$(echo "$RESP" | jq -r '.upload_id')
PRESIGNED=$(echo "$RESP" | jq -r '.presigned_put_url')
CLAIM=$(echo "$RESP" | jq -r '.claim_token')

echo "UPLOAD_ID=$UPLOAD_ID"
echo "PRESIGNED=$PRESIGNED"
```

### 4.3 PUT the source WebP

```bash
# 46-byte lossless 1×1 WebP (RIFF header + VP8L bitstream)
printf '\x52\x49\x46\x46\x1a\x00\x00\x00\x57\x45\x42\x50\x56\x50\x38\x20\x0e\x00\x00\x00\x30\x01\x00\x9d\x01\x2a\x01\x00\x01\x00\x02\x00\x34\x25\xa4\x00\x03\x70\x00\xfe\xfb\x94\x00\x00' \
  > /tmp/tiny.webp
wc -c /tmp/tiny.webp   # → 46

curl -is -X PUT --data-binary @/tmp/tiny.webp "$PRESIGNED"
```

Expected: `HTTP/1.1 200` from S3.

### 4.4 commit_upload

```bash
curl -is -X POST "https://api.tastile.app/v1/uploads/avatar/$UPLOAD_ID/commit" \
  -H "Authorization: Bearer $(cat /tmp/avatar-test.jwt)" \
  -H "Content-Type: application/json" \
  -d "{\"claim_token\":\"$CLAIM\"}"
```

Expected:

```
HTTP/2 200
{"owner_kind":0,"owner_id":"<uuid>","scope_kind":null,"scope_id":null,"avatar_url":"https://d111111abcdef8.cloudfront.net/committed/0/<uuid>/r<rev>/source.webp"}
```

The avatar_url format the api writes is
`<TASTILE_AVATAR_CDN_BASE>/committed/{kind}/{id}/r{rev}/source.webp`
— note the plan's `/avatar/v1/committed/...` path was wrong; the
actual format is `/committed/...` (commit `3d37dc7` upload_avatar.rs:222).

### 4.5 Fetch the committed avatar through CloudFront

```bash
AVATAR_URL=$(echo "$COMMIT_RESP" | jq -r '.avatar_url')
curl -sI "$AVATAR_URL"
```

Expected:

```
HTTP/2 200
content-type: image/webp
content-length: 46
```

### 4.6 Verify /api/me now exposes the avatar_url

```bash
curl -s -H "Cookie: id_token=$(cat /tmp/avatar-test.jwt)" \
  https://app.tastile.app/api/me | jq .
```

Expected: response includes
`"avatar_url":"https://<cdn>/committed/0/<owner_id>/r<rev>/source.webp"`.

---

## 5. Browser verification

1. Log into <https://app.tastile.app> as the test user
2. Open devtools → Network → filter `api/me`
3. Confirm the response body has `avatar_url` populated
4. Hard-reload the dashboard (CloudFlare caches HTML — see
   `project_cloudflare_cache_nginx_config.md`)
5. The top-right avatar (SiteHeader / Menu component) should now show
   the 1×1 WebP.  Once you upload a real image via the profile
   editor, it scales to the 32/64/128 variants on commit.

If the avatar doesn't appear, check the Network tab — a 401 on
`/api/me` means the id_token cookie isn't being set; a 502 means
the upstream API call failed (check `tastile-api` journalctl on the
instance).

---

## 6. Tag + push Phase A

```bash
# core
cd "$(git rev-parse --show-toplevel)"
git tag v0.x.0-phase-a-avatar-backend
git push origin wslc-avatar --tags

# web
cd /c/Users/rebui/Desktop/tastile/tastile-web.avatar
git tag v0.x.0-phase-a-avatar-bff
git push origin avatar-web-phase-a --tags
```

---

## 7. Rollback

If anything goes sideways in staging:

```bash
# 7.1 disable the feature flag (kills upload/commit + PATCH profile)
ssh ec2-user@43.206.236.27 \
  'sudo sed -i "/^TASTILE_FEATURE_AVATAR_ENABLED=/d" /etc/tastile/tastile.env
   sudo systemctl restart tastile-api.service
   sleep 2
   sudo systemctl is-active tastile-api.service'

# 7.2 (optional) roll back to the previous binary
ssh ec2-user@43.206.236.27 \
  'sudo ln -sfn /opt/tastile/api/releases/<previous-sha> /opt/tastile/api/current
   sudo systemctl restart tastile-api.service'

# 7.3 (last resort) remove the new CFN resources
# NOTE: deleting AvatarDistribution leaves a CloudFront "Disabled"
# distribution for ~1 hour before AWS purges the edge config.
# Don't delete AvatarBucket until you're sure no clients hold URLs.
aws cloudformation update-stack \
  --stack-name tastile-foundation \
  --template-body file://<(git show HEAD~1:deploy/aws/foundation/foundation.yaml) \
  --region ap-northeast-1
```

Re-enable is just the reverse: Step 2.2 sets the flag back, then
restart the service.

---

## 8. What "DONE" looks like

- [ ] Step 1: foundation stack update complete, `AvatarBucketName`
      and `AvatarCdnDomain` outputs present
- [ ] Step 2: api binary deployed, `tastile-api.service` active, env
      vars visible via `grep` in `/etc/tastile/tastile.env`
- [ ] Step 3: test user created + password set
- [ ] Step 4.2-4.6: all 5 curl checks return 2xx with the expected
      JSON shape
- [ ] Step 5: avatar visible in browser top-right
- [ ] Step 6: tags pushed for both repos
- [ ] No 500s in `journalctl -u tastile-api.service --since today`
- [ ] `audit/v1-outbox` shows a `kind=6` (SYNC_CHANGE_KIND_PROFILE_UPDATED)
      row with the test user's owner_id