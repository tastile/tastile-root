# Evidence: platform price and capability facts (accessed 2026-09-29)

> Inputs to ADR-0014 / ADR-0015 / ADR-0018 / ADR-0020 and `deployment.yaml` cost estimates.
> "verified" = read from the official page on the access date; "estimate" = derived with the stated assumption.
> Prices change; re-verify before any budget decision and add a new dated file instead of editing this one.

## Google Cloud

| fact | value | source | status |
| --- | --- | --- | --- |
| Cloud Run Tier 1 regions | asia-northeast1 (Tokyo) is Tier 1 | https://cloud.google.com/run/pricing | verified |
| Cloud Run request-based active | $0.000024 / vCPU-s, $0.0000025 / GiB-s, $0.40 / M requests | same | verified |
| Cloud Run idle min-instance | $0.0000025 / vCPU-s, $0.0000025 / GiB-s; idle non-min instances are not charged | same | verified |
| Cloud Run free tier | 180,000 vCPU-s, 360,000 GiB-s, 2 M requests / month / billing account (applied as Tier 1 spend discount) | same + third-party calculator | verified (page) |
| 1 vCPU / 512 MiB min instance, 730 h idle | ≈ $9.9 / month | computed | estimate |
| Instance-based (always-on) 1 vCPU / 512 MiB | ≈ $50 / month | third-party calculator using official rates | estimate |
| Cloud Run domain mapping | Preview, "not production-ready"; asia-northeast1 has known high latency with custom domains | https://docs.cloud.google.com/run/docs/mapping-custom-domains, https://cloud.google.com/run/docs/known-issues | verified |
| Cloud SQL shared-core | db-f1-micro $0.0105 / h, db-g1-small $0.035 / h (us-central1 list); shared-core not covered by SLA | https://cloud.google.com/sql/pricing | verified (us price) |
| Cloud SQL Tokyo db-f1-micro | ≈ $10 / month (assumed ×1.3 regional uplift) | computed | estimate |
| Cloud Build free tier | 2,500 build-minutes / month / billing account on e2-standard-2 default pool; $0.006 / min after | https://cloud.google.com/build/pricing | verified |

## Managed PostgreSQL alternatives

| fact | value | source | status |
| --- | --- | --- | --- |
| Neon regions | no Tokyo; nearest aws-ap-southeast-1 (Singapore) | https://neon.com/docs/introduction/regions | verified |
| Supabase Pro | $25 / org + compute per project (Micro $10, $10 credit covers one); 2 projects on Micro ≈ $35 | https://supabase.com/pricing | verified |
| Supabase backups | daily, 7 days on Pro; PITR add-on $100 / month per 7 days retention per project | same | verified |
| Supabase Free | pauses after 1 week of inactivity (Tastile's project received an auto-pause notice on 2026-05-25) | same + raw corpus | verified |

## Email

| fact | value | source | status |
| --- | --- | --- | --- |
| Resend Free | 3,000 emails / month, 100 / day | https://resend.com/pricing | verified |
| Resend Pro | $20 / month for 50,000 | same | verified |
| Cloudflare Email Service sending | $0.35 / 1,000 on Workers Paid; sending API in beta with little deliverability history | https://emailforstartups.com/compare/cloudflare-email-vs-resend/ (2026-04-30) | secondary source |
| AWS SES for Tastile | production access request denied (sandbox) | raw corpus 2026-06-13〜18 | project history |

## Current AWS (not verifiable from this workspace)

AWS billing was not accessible (no credentials in this environment). The `deployment.yaml` current-node costs
(≈ $93 / month for EC2 ×2, RDS ×2, IPv4, misc) are list-price estimates from `deploy/aws/foundation/foundation.yaml`
defaults (t3.small, db.t4g.micro, 20 GB) and are marked `unverified`.

## Scoring summary used by ADR-0014

| option | Tokyo co-location | managed PITR | no VM ops | keyless identity | fixed cost (2 env) | background work without always-on | result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A AWS as-is | yes | yes (RDS) | **no** | partial (IAM + Infisical) | ≈ $93 (unverified) | yes (EC2) | reject |
| B AWS Fargate + RDS | yes | yes | yes | yes | ≈ $110+ (ALB, NAT/IPv4) | needs always-on task | reject |
| C Cloud Run + Cloud SQL | yes | yes (included) | yes | yes (SA + WIF) | ≈ $42 expected | yes (Scheduler sweep) | **adopt** |
| D Cloudflare-centric | not pinnable (Containers) | external DB needed | yes | partial | ≈ $5 + DB | immature | edge only |
| E Cloud Run + Supabase | yes | **$100/env** | yes | partial | ≈ $35 (no PITR) | yes | reject |
| F Tokyo VPS | yes | **self-managed** | **no** | no | ≈ $10–20 | yes | reject |
| G Neon | **no (Singapore)** | yes | yes | partial | low | n/a | reject |
