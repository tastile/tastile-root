# Core staging のデータ基盤

Root `architecture/model/deployment.yaml` の `node.staging.db` を実装する。
既存 foundation が作成した project/API/service account を前提とする。

GCS state は `tastile-dev-tastile-tofu-state` の `staging` prefix。
DB instance/database と Cloud SQL client IAM のメタデータだけを管理する。
secret、DB password、Infisical session token を変数・plan・stateへ渡さない。
DB role の credential は Infisical のみを正本とする別の bootstrap 操作で適用する。
削除保護と `prevent_destroy` を保持し、reset/restore 時も既存 instance を自動破棄しない。

```bash
tofu init -backend-config=bucket=tastile-dev-tastile-tofu-state -backend-config=prefix=staging
tofu fmt -check
tofu validate
tofu plan
```

ローカルでは既存 gcloud login から得る短命 OAuth token を子プロセス環境の
`GOOGLE_OAUTH_ACCESS_TOKEN` へ渡せる。token を shell trace、引数、file に残さない。
配備・migration・traffic の gate は Root ADR-0020 と roadmap を参照する。

## 作業中と idle の停止・再開

`database_active` は operator が管理し、既定値は `false` (停止) とする。
初回は必ず `tofu plan -var=database_active=true -out=<plan>` → apply の順で
instance と2 databaseを稼働中に作成し、実状態を確認する。
検証作業中は true を明示する。作業終了時は Scheduler の起動を停止し、実行中の
API/worker/migration と DB 接続が終わったことを確認してから、
`tofu plan -var=database_active=false -out=<plan>` → apply で idle 停止する。
再開は true の plan/apply → SQL ready 確認 → caller 再開の順とする。
停止は data/database/backup/IAM を削除しない。restore や migration 実行中に停止しない。
停止後は provider の activationPolicy=NEVER、再開後は ALWAYS/RUNNABLE を readbackする。

25% 稼働・月$5は未計測の推計であり、停止操作の存在だけで費用適合とはしない。
常時稼働の上限見積は同tierのproduction相当の月$14としてSoTへ計上する。
実稼働時間・billing を確認し、停止せず継続する場合は費用と予算判断を更新する。

## Core の段階的な起動

`core_runtime_image` は共有 registry の `core@sha256:...` だけを受け付ける。
指定時に migration job と、その project の Cloud Run service agent に対する
repository 単位の image read 権限を作る。job の作成は migration を実行しない。
Cloud Run は常に `/app/infisical-bootstrap.sh` を command に指定し、API / worker HTTP /
migrator の実行ファイルを args に渡す。selector と非秘密設定だけを state に持つ。

最初に、migration を行わない command override で workload 認証と必要値の取得を確認する。
実 OCI の API/migrator と独立 baseline による rollback 証明、専用 migration の成功後に
`core_api_enabled=true` とする。API は診断中 IAM 認証を必須とし、sa-web だけに
service 単位の invoker を付ける。edge / application 認証の検証は別途必要。

`core_worker_enabled` は実 delivery provider の設定後に有効化し、internal ingress と
sa-scheduler の service 単位 invoker を使う。Scheduler は作成時の既定で paused。
実起動・OIDC・拒否条件を確認して `worker_sweep_paused=false` とする。
fake provider や CI 成功で実 staging の成立を代用しない。
