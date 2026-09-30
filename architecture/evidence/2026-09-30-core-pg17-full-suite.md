# Evidence: Core full suite on vanilla PostgreSQL17 — 2026-09-30

この記録は実行証跡。判定の正本は architecture/model/pocs.yaml と roadmap.yaml。2026-09-29 の失敗記録は上書きしない。

## 固定入力

| 項目 | 値 |
| --- | --- |
| Core source | 433b1a7cefdb90c7ccbf379f65a714b244da1895 / PR209 |
| target release base | 253c470f0ae75855d7c432d60252d4e39aea7703 |
| build | 26bed60c-dbce-438f-8261-05bf7de6b534 |
| provider/project/region | Cloud Build / tastile-dev / asia-northeast1 |
| machine | default e2-standard-2（2 vCPU / 8GB） |
| runtime/toolchain | rust:1.97.1-bookworm / postgres:17-bookworm |
| execution identity | sa-cloud-build-ci（secret/GitHub App/Infisical/deploy権限なし） |
| source | exact GitHub commit archive / private GCS source bucket generation1790763360379760 |

## command と結果

repository-owned cloudbuild/ci.yaml を trusted dispatcher の allowlist parserで読み、operatorの短命tokenで検証buildを実行。GitHub App private key等をPR buildへ渡していない。Scheduler / Infisical machine identity からの自動起動の証跡ではない。

- PostgreSQL17 readiness: 成功
- PowerShell gate contract: 成功
- v1/v0 cargo fmt --check: 成功
- v1 cargo clippy --workspace --all-targets -- -D warnings: 成功
- v0 cargo build --workspace --jobs2: 成功
- v1 cargo test --workspace --jobs2 -- --test-threads=1: **934 passed / 0 failed / 0 ignored**（103 result groups）
- Cloud Build: SUCCESS、start2026-09-30T10:16:02Z / finish10:43:38Z
- rust-quality step: CI_DURATION_SECONDS=1546 / 25.76min
- full build elapsed: 27m36s

Cargo outputの全 result行を集計した。対象testは実DB接続必須で、DB不在のearly returnを成功証拠にしていない。前日のauth/scope失敗を解消し、provider固有workaroundを追加していない。fixtureは現在contractに有効なCondition/60s scheduleへ修正し、200/403期待値を維持。

log export SHA256: b2c9a65967e185e21e1eb7d57b817c3a6c470c303d0968a005dc2cb1c8ea2670

## 判定の範囲

Core real-PG17 full gate の成功を証明する。CI時間25.76minは25min目標を超える。10回中央値、40回/月換算、Infisical GCP-native / GitHub OIDC、拒否境界、自動GitHubstatus報告は未完了で、poc.cloud-build-ciは未達成。

poc.core-suite-vanilla-pg の8vCPU cold-target性能基準を、この2vCPU結果へ読み替えない。2026-09-29 の6.3minはhistorical evidenceとして残し、最新candidateの8vCPU再計測は未実施。API startup / latency / required extensionsのPoC結果をこのsuiteで更新しない。

GitHub Actionsはbudget制限でjob開始前に失敗。root ADR-0020§3の代替実DBfull evidenceを使用し、未実行checkをsuccessへ偽装していない。
