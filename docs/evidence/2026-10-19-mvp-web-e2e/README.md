# MVP Web E2E on staging (generation 24, 2026-10-18 UTC)

Playwright Chromium で新規ユーザーの一連の操作を検証した。
- 構成: staging Cloud Run `web` (image `web@sha256:6a34e344…`、Web `110fa521`) + `core-api`/`core-worker` (Core `108bf35`、image `core@sha256:7d4bb18c…`) + Cloud SQL `tastile-staging-pg`。
- 経路: ブラウザは `https://staging-app.tastile.app` を origin とし、operator 端末の local edge 代替が edge Worker と同じ header (edge assertion、forwarded host/proto) と operator の IAM token を付ける。公開 DNS・edge Worker は Cloudflare token の権限不足で未配備。
- 制約: staging `web` は IAM-only (allUsers なし)。direct request は IAM 403、edge assertion 無し・不一致は Web が 403 を返すことを確認した。

## 成立した操作 (同一の新規ユーザー)
| 手順 | 結果 | 証跡 |
| --- | --- | --- |
| email/password で新規登録 | dashboard へ遷移。`__Secure-better-auth.*` と `tastile_uid` を `staging-app.tastile.app` に設定 | — |
| タスク作成 (時刻指定) | `POST /api/proxy/v1/schedule-definitions` 200 → SourceTile。worker が PLACEMENT を生成。同じ枠の 2 件目は BLOCKED (上書きしない) | `task-created.png` |
| タスク作成 (時刻なし、30 分) | place-now の 24h 窓で、Core が 07:20–07:50 JST に配置 (既定の睡眠 23:00–07:00 の後) | `timeline-plan-and-actual.png` |
| 実行開始 | `POST /v1/tiles/{id}/start` 200、`POST /v1/placements/{id}/executions` 200。header に残り時間と一時停止・再開・終了 | `execution-running.png` |
| 再ログイン後の復元 | cookie の無い新しい context で login。実行中の execution と残り時間が復元された | `relogin-restored.png` |
| 実行完了 | `POST /v1/executions/{id}/finish` 200。DB で `state=2` (FINISHED_NORMAL)、`finished_at` 17:48:50Z。再読込後の header は「実行中のタスクはありません」 | `after-finish.png` |
| 予定と実績の表示 | 日表示に、予定 (07:20) と実行記録 (02:44–02:48 JST、完了マーク) が並ぶ | `timeline-plan-and-actual.png` |

## 見つけて修正したもの (Web branch 171)
- 新しい auth DB に BetterAuth schema が無かった。`auth:migrate` を追加して適用した (`f2f6f7b2`)。
- image build で `NEXT_PUBLIC_TASTILE_CORE_URL` を宣言していなかった (`110fa521`)。
- 期日を UTC 日付として解釈し、JST で 9 時間ずれていた (`3fc367bc`)。
- **security**: hydration 前に submit すると login/signup form が GET になり、email と password が URL・履歴・request log に残った。`method="post"` と回帰 test を追加した (`1afdc0ec`, `2fb01148`)。本検証の synthetic test account の password が staging Cloud Run の request log に 1 回記録された。test 専用 account で、実ユーザーの値は含まない。

## 未解決
- worker の Flow 再評価が DB を飽和させる (tastile-core#217)。sweep 稼働中は timeline API が 17–69 秒、停止中は 1.3 秒。42 分の window で drain は収束しなかった (全 pass 503)。window は stop file で終了し、`PAUSED` を readback した。
- `/api/me` が server 側で相対 URL を使い 502 を返す。profile header だけに影響する (tastile-web#186)。
- UX: task 一覧の Source 行は配置済みでも「未スケジュール」と表示し、完了マークも出ない。header の状態ラベルは実行中も「待機中」のまま。
- Android 実機・Web との同期、ズレ検出・再調整は未検証。
