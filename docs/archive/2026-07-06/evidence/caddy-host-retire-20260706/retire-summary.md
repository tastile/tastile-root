# Caddy host retirement — 2026-07-06

## Decision

**`i-026c215cacda95559` (Name=tastile-web, EIP 35.79.255.34)** is decommissioned.

CF origin moved to `i-0ec20b65596468a79` (Name=tastile-web-server, 52.194.61.218)
on 2026-07-06 11:05–11:20 UTC for all three A records
(`tastile.app`, `app.tastile.app`, `api.tastile.app`).

## Actions taken (in order)

1. **2026-07-06 11:05 UTC** — `app.tastile.app` CF A record → `52.194.61.218`
2. **2026-07-06 11:05 UTC** — `tastile.app` CF A record → `52.194.61.218`
3. **2026-07-06 11:20 UTC** — `api.tastile.app` CF A record → `52.194.61.218`
4. **2026-07-06 ~11:23 UTC** — nginx config on `52.194.61.218`: 4× `127.0.0.1:3140` typos → `127.0.0.1:31400`, `nginx -t` pass, reload OK
5. **2026-07-06 ~11:25 UTC** — Evidence snapshot of Caddy host saved (see `Caddyfile`, `caddy.service`, `tastile-web.service`, `releases.txt`, `last_build_id.txt`, `instance.txt` in this directory)
6. **2026-07-06 ~11:27 UTC** — `systemctl stop/disable caddy.service tastile-web.service` on the Caddy host
7. **2026-07-06 ~11:28 UTC** — EIP `eipalloc-0b3c43f03674e9af9` (35.79.255.34) disassociated and released
8. **2026-07-06 ~11:29 UTC** — `aws ec2 stop-instances i-026c215cacda95559` (state: stopping → stopped)

## Rollback procedure

If nginx host fails within the next week and we need to bring Caddy back:

1. Allocate a new EIP and associate with the stopped instance
   ```bash
   aws ec2 allocate-address --region ap-northeast-1 --domain vpc
   aws ec2 associate-address --region ap-northeast-1 \
     --instance-id i-026c215cacda95559 --allocation-id <new-eipalloc>
   ```
2. Start the instance
   ```bash
   aws ec2 start-instances --region ap-northeast-1 --instance-ids i-026c215cacda95559
   ```
3. Start services
   ```bash
   aws ssm send-command --instance-ids i-026c215cacda95559 --document-name AWS-RunShellScript \
     --parameters 'commands=["sudo systemctl start caddy.service tastile-web.service"]' \
     --region ap-northeast-1
   ```
4. Repoint CF A records back to that EIP (via `cf dns records update`)
5. Don't forget the nginx typo patch — that fix lives on `52.194.61.218` only

## Pending follow-up

- [ ] **#29**: refresh CF OAuth token + add `cache:purge` scope so we can purge edge cache after deploys without waiting 30s for natural propagation
- [ ] Decide whether to fully terminate `i-026c215cacda95559` after a stable week on nginx host. Currently stopped (~$2.40/month EBS only). Terminate when confidence is high.