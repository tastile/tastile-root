---
id: adr.root.0023
status: Accepted
date: 2026-10-06
scope: private Core CI control plane
relates: [adr.root.0020, adr.root.0022]
gated_by: [poc.cloud-build-ci]
---

# ADR-0023: 毎分 CI dispatcher を request 課金の非公開 service にする

## Context

dispatcher の元の node 見積もりは「毎分 Job が free tier 内で月0〜1ドル」だった。
Cloud Run Jobs は各 instance に最低1分の課金があり、短い空振りでも減らない。
月43,800回・1vCPUなら最低2,628,000 vCPU秒になり、この見積もりは成立しない。

根拠: [Cloud Run pricing](https://cloud.google.com/run/pricing) の Jobs billing specification。
毎分 cadence、private Core、Infisical唯一のsecret SoT、build accountの権限分離を維持して費用を抑える。

## Decision

- `tastile-ci-dispatcher` は dev project の request 課金 Cloud Run service とする。
  cpu idle、min instances0/max1、concurrency1、internal ingress、1vCPU/512Mi、timeout300s。
- 同じ project の Cloud Scheduler から毎分 `POST /dispatch`（空body）を送る。
  caller は `sa-ci-dispatcher`、短命OIDCのaudienceはpath/queryを除くcanonical service URL。
  service-level `roles/run.invoker` はこのSAだけ。allUsers/allAuthenticatedUsersは許可しない。
  Scheduler service agentの既定roleを保持し、agentをjob identityには使わない。
- Cloud Run ingress/IAM が caller/audience を検証する。アプリ入口は method/path/empty body を検証し、
  dispatcherが認証・処理を完了してから200を返す。認証やtop-level処理失敗は503で成功にしない。
  Scheduler attempt deadline320s、retry_count0。処理の再試行とlost-response回復は既存GCS generation fencingを使う。
- 同じ image は明示 `CI_DISPATCHER_MODE=once` で単発実行もできる。
  HTTP運用は `CI_DISPATCHER_MODE=http` とCloud RunのPORTを必須にする。
- GitHub App鍵とtokenはmemory内のみ。PR code実行は別 `sa-cloud-build-ci`、publishは別SA。
  production App/secret/権限を変更しない。CI評価identityはADR-0022のdev scopeに限る。

## Verification / cost

local実HTTPでmethod/path/body、成功時だけdispatch、callback失敗503を確認する。
devでSchedulerのOIDC成功、未認証/未許可callerの401/403、実metadata token→Infisical→GitHub App、
exact Core PR headのCloud Build結果/status reportingを確認する。

node estimateは平均3秒/pollで131,400vCPU秒/月、free tierなしでもexpected3.5ドルを予約する。
upper仮定10秒/pollでは438,000vCPU秒×0.000024ドル + 219,000GiB秒×0.0000025ドル +
43,800request×0.40ドル/百万 ≈11.08ドル、余裕を入れて12ドルとする（egress別）。
これは仮定付き予測でありhard capではない。
平均時間と請求は実測前の仮説でありfreeと断定しない。Jobsを常時毎分起動する旧見積もりは撤回する。
単発Jobの検証費用を毎分service運用の費用証跡にしない。
`poc.cloud-build-ci` の10回中央値・status・credential isolationが揃うまでm2を完了扱いにしない。

## Rollback

Schedulerをpauseし、serviceを前image digestへ戻す。初回導入を撤回する場合はservice/当該invoker/schedulerだけを削除する。
既存state bucket、source bucket、artifact registry、既存SAとInfisical secretを保存する。
評価identityの撤回はADR-0022のassignment/role cleanupを先に行う。
