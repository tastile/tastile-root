# ADR-0025: Native-first 正式リリース構成（ゼロ追加クラウド費用）

- 日付: 2026-11-24
- 状態: Accepted
- 対象: Tastile workspace 全体（実行ホスト・サーバ環境・クライアント・配布・secret・backup・監視）
- 関連 issue: tastile-root#141（計画 v0.4 正本）、tastile-root#48（architecture SoT）、
  tastile-root#102 / ADR-0024 系の有料インフラ凍結、tastile-root#105（個人実用化 gate）、
  tastile-root#104（隔離 verify-stack）
- 補足: ADR 番号は 0025 を採番する。stale line `release-0-7-0` にのみ存在する
  ADR-0014〜0024（内容は本 ADR と一部重複・一部別件）との番号衝突を避けるため。
  同 line の `architecture/` model と ADR 群の main への選択的取り込み・renumber は
  NF04-R01 の残作業として #48 で追跡する。

## Context

Tastile は「入力→予定化→実行→遅延時の再調整→継続」を支援する実行制御システムであり、
正式リリースにあたり次の制約が確定している。

- **費用**: 追加クラウド利用料金の上限は 0 円。#102 の有料インフラ凍結
  （AWS 全削除・GCP billing 解除）を維持し、AWS/GCP の有料経路を再開しない。
  **Oracle Cloud は採用・調査・代替・fallback のすべてから除外する。**
- **製品優先度**: Desktop を日常利用の主力（P0）とし、Web・認証・Core・DB・
  CLI/Muse 連携を備えた正式リリースを成立させる。Web は必須。初期の招待制・
  登録上限は正式リリースと両立する。Android/macOS/iOS は後続だが既存契約・作業を
  破棄しない。
- **既存資産の保護**: 現行 Muse 運用データ（実予定・認証・通知・自動化）の唯一の
  正本は保護する。許可なき read/write・移行・再起動・通知変更・公開・データ抽出を
  禁止し、実装・移行・検証は隔離環境で行う。
- **計画の正本**: tastile-root#141（v0.4）。全 42 タスク（NF04-R/C/D/W/I）と
  受入条件・依存関係は同 Issue と配下の追跡 Issue が正本。

## Decision

### 製品構成

Native-first / Server-authoritative / Local-assisted を採用する。正本・状態確定・
ドメインロジックは Core が所有し、端末は表示・通知・実行支援・ローカル記録を担当する。
将来の計算委譲に備えドメイン計算と HTTP/永続化を分離するが、全面 Local-first 化は
今回行わない。

| 責務 | 採用 |
| --- | --- |
| 実行ホスト | 既存の常時稼働 Windows マシン（既存無償仮想化、購入不要） |
| サーバ環境 | 隔離 Ubuntu LTS VM + Docker Compose |
| API / Worker | Rust / axum、Rust / Tokio、別実行単位 |
| 正本 DB | PostgreSQL 16 |
| Windows Desktop | C# / WinUI 3、SQLite Read Model・未確定操作記録、OS 通知・トレイ |
| Web / 認証 | 既存 Next.js standalone / Better Auth（全面書き換えを前提にしない） |
| ネイティブ認証 | システムブラウザ、Authorization Code + PKCE、スコープ付き Core API token |
| 同期 | SSE 変更通知 + 永続 cursor による差分 Sync / Snapshot 復旧 |
| 公開 | Caddy reverse proxy + Cloudflare Tunnel Free（独立無料環境） |
| 製品サイト | Cloudflare Pages Free の静的配信 |
| Windows 配布 | Microsoft Store / MSIX（適格性は NF04-D09/D10 で確認） |
| CLI / 補助配布 | GitHub Releases |
| Secret | 既存 Infisical を編集正本、実行時最小権限供給（常時接続を必須にしない） |
| バックアップ | 既存の別物理 Mac へ SSH 転送、age 暗号化、別障害ドメイン・復元実証 |
| ログ / メトリクス | journald 等の容量制限、Prometheus 形式・ローカル集計 |

公開サイト・動的 Web/API・Store/GitHub 配布は分離する。インストーラーを Tunnel や
API で中継しない。DB・Worker・内部管理 API は外部公開しない。Better Auth の専用
DB/role と Core の DB/role を分離し、既存 identity mapping と token 境界を維持する。
メール・有料画像/動画変換・R2・外部 Redis/Queue/Cron を必須依存にしない。既存
アカウントの利用・移行を無断で縮小しない。

### 費用・資源境界

- 追加クラウド利用料金の上限は 0 円。既存固定費（ドメイン・電気・回線・機器・
  共有契約）は別記する。予算アラートや遅延停止をハード上限とみなさない。
- 全課金台帳と否定試験を要求し、有料作成権限を通常 deploy に与えない。
  無料アカウントの分離と実契約・支払設定を確認し、未確認の経路は有効にしない。
- 初期割当: 登録 10 人、VM 4 vCPU / 8GB RAM / 64GiB ディスク上限、通常 API
  10MB/人/日（配布・バックアップ別）。RAM 目安: PG 3GB、API/Worker 1.5GB、
  Web/Auth 1GB、Caddy/Tunnel/監視 0.5GB、OS/余裕 2GB。
- 初期検証目標: API p95 300ms、主要 Command 受付 p95 500ms、キャッシュ表示
  100ms、通常同期/通知 5 秒。1/10/50/100 人の負荷モデルで評価し、登録上限は
  実証結果で決定する。復元目標 RPO 24h / RTO 4h を起点に見直す。
- 制限は監視だけでなく処理拒否・延期・停止として強制する。容量逼迫時に正本を
  破壊しない。

### アプリケーション契約（抜粋）

- Desktop のタイマー表示と予定通知は通信を必須にしない。確定済み予定の revision・
  有効期限・重複防止・変更時取消・切断時の古さを扱う。
- Snapshot と cursor の整合を保証し、SSE は変更通知だけを送る。差分を原子的・
  冪等に適用し、切断・欠落・重複・順序変更・cursor 期限切れ・認可失効を扱う。
  再接続は jitter 付き上限バックオフ、接続不可時は適応的ポーリング。
  認証済みデータの共有 CDN キャッシュは禁止。SSE 接続自体も認可・失効・
  接続数・heartbeat を制御する。
- Worker は Command 確定・評価期限到達・復旧走査で動作。永続 Outbox/期限・lease
  が正本、LISTEN/NOTIFY は wake-up ヒントのみ。変更範囲の増分評価・再評価条件の
  最適化・読み取り起因の不要計算と書き込み増幅の削減を優先し、未評価範囲・
  時間依存条件を見落とさず正しい Read Model を返す。
- オフライン操作は永続的に記録する。Observed at（端末申告）/ Received at（受信）/
  Committed at（確定）を区別し、未確定を確定済みと表示しない。現行のサーバー時刻・
  同一 Placement の実行中 Execution 最大 1 件・Command 冪等性・expectedRevision・
  正本/イベント/Outbox の原子的確定を保護する。安易な LWW や履歴削除は禁止。
- Core はドメイン計算の正本。正本と派生データを分類し、履歴の削除・TTL は意味論・
  参照・冪等性・再生/復旧への安全性を証明した場合にのみ採用する。

## 既存正本との関係（改訂点）

本 ADR は以下の現行記述を改訂する。詳細な文面更新は同 PR で実施する。

- `docs/HARNESS.md` §3-2「web と android を完全に完成させることが最優先」→
  **Desktop 主力 + Web 必須** の正式リリース構成へ。
- `docs/HARNESS.md` §4-2 優先度表 → Desktop を日常利用主力として位置づける。
- `docs/HARNESS.md` §9-4 / §12「Docker は使わない」→ **専用 VM 上の Docker
  Compose と隔離 verify-stack では container を採用**する。旧来の「開発でも
  本番でも Linux バイナリ直接実行」モデルは本構成で退役する（#104 の verify-stack
  が既に Compose を採用済みであり、実態に整合させる）。
- `docs/HARNESS.md` §6 → 停止中のクラウド記録（§6-1〜6-3）は履歴として維持し、
  本 ADR のローカル完結構成を現行デプロイ先として追記する。
- `docs/HARNESS.md` §10 → リリース計画の正本として tastile-root#141 を追加。
- `docs/HARNESS.md` §13 → 次のマイルストーンを #141 / NF04-I07 の正式リリース
  gate へ接続する。
- `tastile-desktop/AGENTS.md` の「AWS-hosted API / beta.tastile.app」既定値 →
  新デプロイ確定後に NF04-D01/D09 で接続先 contract を更新する（本 ADR では
  方針のみ確定）。

## Consequences

- Desktop が P0 の日常利用クライアントとなり、SQLite read model・PKCE 認証・
  MSIX/Store 配布が正式リリースの critical path に入る。
- Core は v2 semantics 系列（release-2-0-0）を継続し、Sync/SSE・増分評価・
  資源制限の強化（NF04-C01〜C10）が必要になる。
- Web は全面書き換えではなく standalone 化・Better Auth 整備・静的製品サイト・
  登録制御の追加で対応する。
- `release-0-7-0`（root）の `architecture/` model・ADR-0014〜0024 は stale line
  上の正本であり、main への選択的取り込みと renumber が必要（#48 / NF04-R01）。
  本 ADR はそれらを置き換えるものではなく、衝突回避のため 0025 を採番した。
- 承認境界は維持する: 追加課金契約・既存本番データ切替・DNS 移管・外部公開・
  release→main 統合は明示承認が必要。技術完成と承認待ちは区別する。

## Re-evaluation

- 採用ホストに具体的不成立（仮想化・回線規約・資源余力）が判明した場合は、
  当該コンポーネントの根拠と代替を ADR で改訂し、他レーンを止めない。
- 無料枠の提供条件変更・利用規約変更時は R04 の契約確認を再実施する。
- 登録上限・SLO は I04 の実測で改訂する。
