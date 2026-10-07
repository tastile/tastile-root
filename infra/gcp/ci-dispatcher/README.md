# Private Core CI dispatcher

This is the trusted control-plane process for private `tastile-core` CI.

It exists because the project requires both:

- zero GitHub-hosted paid runner minutes for Core heavy CI; and
- no long-lived development / CI / deploy credential outside Infisical.

## Credential flow

1. The private request-billed Cloud Run service runs as `sa-ci-dispatcher`.
2. It requests a Google-signed ID token from the metadata server with the
   Infisical machine-identity ID as the audience.
3. It exchanges that token at `/api/v1/auth/gcp-auth/login`.
4. It reads only `GITHUB_CI_APP_PRIVATE_KEY` from its permitted Infisical path.
5. It creates a GitHub App JWT in memory and exchanges it for a short-lived
   installation token.
6. The installation token is used only for Core PR discovery, source download,
   and commit-status reporting.

The private key, Infisical access token, GitHub App JWT and installation token
are never written to disk or passed into Cloud Build.

## GitHub App permissions

Install the Tastile CI GitHub App only on `tastile/tastile-core`:

- Contents: Read
- Pull requests: Read
- Commit statuses: Read & write

No webhook is configured.

## Infisical machine identity

Configure GCP Auth on a dedicated identity:

- type: `gce`
- allowed service account: `sa-ci-dispatcher@tastile-dev.iam.gserviceaccount.com`
- project/environment/path access: only the CI secret location
- secret required: `GITHUB_CI_APP_PRIVATE_KEY`

For Cloud Run, the allowed service account email is the effective GCP Auth
restriction. Infisical's allowed-project check applies only to GCE instances.
The self-hosted Free plan requires either a valid license or the bounded
development/testing overlay in ADR-0022 for custom project role assignment.
The overlay applies only to the declared development/staging evaluation projects.
Verify reads outside the CI path are denied before using a dedicated identity.
Production licensed RBAC remains a separate prerequisite.

The dispatcher uses the machine identity ID as the GCP ID-token audience,
matching Infisical's current GCP Auth verifier contract.

## 呼び出し

ADR-0023はrequest課金、min0/max1、internal ingress、`sa-ci-dispatcher`だけのIAM呼び出しを採用する。
Cloud Schedulerが毎分、空bodyの`POST /dispatch`をOIDCで送る。
audienceはpathを除くcanonical service URL。
`CI_DISPATCHER_MODE=http`を明示し、Cloud Runが提供する`PORT`を必須にする。
単発実行は`CI_DISPATCHER_MODE=once`を明示する。
Jobには空振りでもinstanceごとに最低1分課金があるため、毎分の常時pollには使わない。

## Build isolation

The dispatcher uploads source to the private 7-day GCS source bucket and
submits `cloudbuild/ci.yaml` from the exact PR archive.

Cloud Build runs as `sa-cloud-build-ci`, which has no Infisical, GitHub App,
Artifact Registry write, or deployment authority.

A GCS generation-fenced lock at `locks/<head-sha>` prevents concurrent submissions.
The GitHub status context is `tastile/cloud-build-ci`.
The dispatcher accepts only the approved 30-minute timeout, Cloud Logging-only
option, and a small set of step fields from the PR archive. Source, service
account, tags, resource settings, artifacts, and destinations are fixed by the
dispatcher. Each scheduler run submits new builds and reconciles earlier builds
by the build ID in their pending GitHub status, so a queued build may outlive one
Cloud Run Job invocation. If the create response or status update was lost, the
next run recovers the build from Cloud Build tags containing the exact head SHA.
A preparation lease abandoned for five minutes can be reclaimed by generation
precondition. The owner must transition the lock to `submitting` before calling
Cloud Build. An uncertain submission is never automatically repeated, because
the create API has no idempotency key; if no build can be found for 45 minutes,
the status becomes an explicit error and a new commit can retry.

## Trusted rollback baseline

既存の Core recipe は `rollback_baseline` を宣言しない限り従来経路を維持する。
信頼済み baseline 経路を使う recipe は、top-level に
`rollback_baseline: pull-base` を厳密に宣言する。dispatcher は PR の base commit
SHA を必須とし、固定された `GITHUB_REPOSITORY` からその commit を取得して、同じ
private source bucket の `baselines/<sha>.tar.gz` へ保存する。

source と baseline の archive は create-only object とする。object が既に存在する
場合は、固定 generation の metadata と bytes を読み、保存済み bytes の SHA-256 を
今回取得した bytes と比較する。digest の不一致、generation の欠落、recovery の失敗
があれば response body を公開せず submission を停止する。

opt-in recipe では、dispatcher が Cloud SDK image と read-only の
`gcloud storage cp` を使う固定 `rollback-baseline-download` step を先頭へ追加する。
unique な `rust-quality` step には `BASE_SHA`、
`BASE_ARCHIVE_PATH=.tmp/rollback-baseline.tar.gz`、`BASE_ARCHIVE_SHA256` を注入する。
PR がこれらの予約済み environment name や step ID を指定した場合は拒否する。
Cloud Build に渡す envelope は固定の 1800 秒・Cloud Logging-only・default 2 CPU
のままとし、
dispatcher 内だけで使う `rollback_baseline` field は submission 前に除去する。

archive と recipe の resource bound は次のとおり固定する。

- GitHub / GCS から受け取る archive bytes は 32 MiB 以下。現在の trusted Core archive は約 7.6 MiB である。
- tar listing は 2 MiB 以下かつ 20,000 entry 以下。`cloudbuild/ci.yaml` の抽出結果は 128 KiB 以下。
- HTTP request の fetch と tar process は 15 秒 timeout、stdout / stderr は上記の bounded buffer を使う。
- archive parse は毎回一意な temporary directory を作り、`finally` で削除する。同じ SHA の同時 parse は共有 path を使わない。

median cohort の `stepsDigest` は Cloud Build API から取得した resolved recipe の識別子として維持する。
`submissionStepsDigest` は request JSON 用に `$` を `$$` へ変換した recipe の識別子であり、`stepsCount` と
relationship description を cohort JSON に保存する。collector は cohort の count を優先し、旧 cohort では sample 1
の resolved recipe から count を導出して、実際の step 数と image digest 数を比較する。
