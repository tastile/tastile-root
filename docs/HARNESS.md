# HARNESS — Tastile Project

> **プロジェクト全体のハーネス**。
> 新セッションで Tastile に触れるすべてのエージェント・開発者が、
> プロダクトの目的・全体方針・リポジトリ境界・インフラ構成・正本の所在を把握するための集約ドキュメント。
>
> 各リポジトリ固有の実装詳細はここには書かない。各リポジトリの HARNESS.md / CLAUDE.md / AGENTS.md を参照すること。

---

## 目次

1. [Tastile とは何か](#1-tastile-とは何か)
2. [プロジェクトの経緯](#2-プロジェクトの経緯)
3. [v1 era — 現在の全体方針](#3-v1-era--現在の全体方針)
4. [ワークスペース構成](#4-ワークスペース構成)
5. [アーキテクチャ概観](#5-アーキテクチャ概観)
6. [インフラ・デプロイ構成](#6-インフラデプロイ構成)
7. [認証モデル](#7-認証モデル)
8. [API 方針](#8-api-方針)
9. [開発環境・ツールチェイン方針](#9-開発環境ツールチェイン方針)
10. [正本の所在 (Source of Truth)](#10-正本の所在-source-of-truth)
11. [エージェント向けルーティング表](#11-エージェント向けルーティング表)
12. [禁止事項 (ワークスペース横断)](#12-禁止事項-ワークスペース横断)
13. [現在のステータスと次のマイルストーン](#13-現在のステータスと次のマイルストーン)

---

## 1. Tastile とは何か

### 1-1. ビジョン

**日常のスケジュール判断をシステムで吸収し、自己をロボットのように働かせるアプリ。**

テーマは **行動決定の効率最大化**。

日々のタスクを予定と通知に変換するアプリケーション。
カレンダーアプリ × 時計アプリ × タスク管理アプリ の交差点に位置する。

- **カレンダーアプリ** は「予定」を管理する
- **時計アプリ** は「実行」を管理する
- **タスク管理アプリ** は「やる事」を管理する

Google の提供するアプリケーション等で個々の機能領域は完成されているが、**記録を実行に移すまでの実際の人間の行動** にまではアプローチできていない。

Tastile はこの隙間をつなぎ、タスクを **分単位の予定** に落とし込んで、**実行までサポート** する。

### 1-2. コア機能

- 日常で思いついたアイデア・タスクが **瞬時に具体的な予定として配置** される
- 日常の習慣化をシステムがサポートする
- 朝の目覚ましアラートのような **強制力をすべてのタスク** に働かせる
- 予定と実際の実行のズレをシステムで吸収し、もとの予定に戻し、ずれた予定を調整する

### 1-3. ターゲットユーザー

想定するターゲットは、**勤務時間に縛られず、集中して仕事した量が成果に直結するフリーランサー**。

多くのユーザーに使われることを前提とし、メインの実行機能のほかに **ユーザー権限を用いたチームでのスケジュール管理機能** も提供する。

### 1-4. これはタスク管理ツールではない

Tastile は **実行制御システム** である。タスクの一覧管理が目的ではなく、「**今何をすべきか**」の判断コストを最小化し、予定通りの実行を強制的にサポートすることが目的。

---

## 2. プロジェクトの経緯

```
テスト週間に勉強効率化のためポモドーロタイマーの Web アプリを開発「pomodoroom」
  ↓
Web アプリでは常駐管理・実行が困難
  ↓
Tauri (Rust のマルチプラットフォームフレームワーク) でデスクトップアプリ化
  ↓
やりたいことが増え、タスク管理機能などが追加
  ↓
実行管理機能のアイデアを思いつくが、フレームワークの制約で低レイヤー実装が困難に
  ↓
アプリの分割を計画 → Tastile プロジェクト立ち上げ・ドメイン取得
  ↓
ローカル Rust アプリ + フロント用アプリの通信で実現する想定だったが実装に苦戦
  ↓
オンライン同期を考えたときにデータが混線し、実現したい機能から遠ざかる
  ↓
ソフトウェアアーキテクチャを勉強して感銘を受ける
  ↓
バックエンド中心にしてサービス化を決断 → Tastile プロジェクト本格始動
  (~ここまで半年~)
  ↓
v7 仕様で開発を進めるが複雑化 → 2026-06-24 に v1 era として仕様を白紙から再構築
```

---

## 3. v1 era — 現在の全体方針

2026-06-24 以降、プロジェクトは **v1 era** として以下の方針で進行する。

### 3-1. バックエンド中心

- **バックエンドがサービスの核** を担う
- フロントエンドは **薄いクライアント** として、タスクの入出力・通知・プロジェクト管理をプラットフォームネイティブに提供する
- ビジネスロジック・ドメインロジックは **一切フロントエンドに置かない**

### 3-2. 当面の目標

- **正式リリース計画 v0.4（tastile-root#141、ADR-0025）**: Desktop を日常利用の
  主力（P0）とし、Web・認証・Core・DB・CLI/Muse 連携を備えた正式リリースを、
  追加クラウド料金 0 円で成立させる。Web は必須。Android / iOS / macOS は後続
- 旧方針「web と android を完全に完成させることが最優先」は v0.4 で改訂済み

### 3-3. 仕様の正本

- `tastile-core/v1/` 配下の 16 ファイル（`v1/00-glossary.md` 〜 `v1/15-owner-and-profile.md`）が唯一の正本
- 旧 v7 仕様 (`docs/MOST_IMPORTANT_PLAN/` / `docs/architecture.md` / `docs/algorithm.md` 等) は archive 済み・**再導出禁止**
- `tastile-core/HARNESS.md` にドメイン・実装の詳細ハーネスがある

### 3-4. 段階的移行

```
Phase A: 核 (Tile / Plan / Recurring / Placement / Execution / Span / Window)  → 完了
Phase B: 条件と入れ子 (Condition AST / Reference / Frame / Gap)              → 完了
Phase C: 自動調整 (Metric / Flow / Candidate / ChangeSet 競合)               → 完了
Phase D: ユーザー判断 (DecisionRun / Session / Delivery)                     → 完了
Phase 5: 旧 v0 撤去 (全クライアント v1 移行後)                               → 未着手
```

---

## 4. ワークスペース構成

各リポジトリは **独立した Git リポジトリ** として管理される。`tastile-root` 配下にディレクトリとして並ぶが、それぞれ独自の `.git` を持つ。

| リポジトリ | 役割 | 備考 |
| --- | --- | --- |
| **tastile-root** | プロジェクト全体の並行開発のためのリポジトリ。全体方針・全体設計のドキュメントを残す | プロジェクト固有の実装詳細は書かない。各リポジトリに委譲 |
| **tastile-core** | **バックエンド全体**。このプロジェクトのメイン。バックエンドで動くすべてを担当 | Rust / axum / SQLx / PostgreSQL |
| **tastile-web** | Web フロントエンド (薄いクライアント) | Next.js / React / TypeScript |
| **tastile-android** | Android フロントエンド (薄いクライアント) | Kotlin / Jetpack Compose |
| **tastile-desktop** | Windows デスクトップフロントエンド (薄いクライアント) | C# / WinUI 3 / .NET |
| **tastile-brands** | Tastile のロゴデータ・ブランド情報 | 必要なときに **コピーして使用**。**相対パスで参照してはならない** |
| tastile-core.wslc | WSL clone (core の Linux ビルド用) | tastile-core の WSL 内クローン |

> **今後追加予定**: tastile-ios, tastile-mac

### 4-1. 各フロントエンドの役割

フロントエンドは **プラットフォームネイティブ** に以下を提供する薄いクライアント:

- タスクの入出力
- 通知機能
- プロジェクト管理機能の UI

**ビジネスロジックはフロントエンドに置かない。** すべて tastile-core の API を通じて処理する。

### 4-2. 現在の優先度

| リポジトリ | 状態 | 優先度 |
| --- | --- | --- |
| tastile-core | 開発中 (v1 Phase A-D 完了、v2 semantics 系列 release-2-0-0) | **最高** |
| tastile-desktop | 開発中 | **最高** — v0.4 の日常利用主力（P0） |
| tastile-web | 開発中 | **高** — 正式リリースで必須 |
| tastile-android | 開発中 | 中 — 後続（既存契約・作業は維持） |
| tastile-cli | 開発中 | 中 — Muse 連携・配布経路 |
| tastile-brands | 安定 | 維持 |
| tastile-ios / tastile-mac | 未着手 / stub | 低 — 将来 |

---

## 5. アーキテクチャ概観

```
┌─────────────────────────────────────────────────────────┐
│                    ユーザー / チーム                       │
└──────┬──────────┬──────────┬──────────┬─────────────────┘
       │          │          │          │
  ┌────▼────┐┌────▼────┐┌────▼─────┐┌──▼───────┐
  │  Web    ││ Android ││ Desktop  ││ iOS/Mac  │  ← 薄いフロントエンド
  │(Next.js)││(Compose)││ (WinUI)  ││ (将来)   │
  └────┬────┘└────┬────┘└────┬─────┘└──┬───────┘
       │          │          │          │
       └──────────┴──────┬───┴──────────┘
                         │
                ┌────▼────┐
                │  認証   │  ← BetterAuth (アカウント認証)
                │         │    + API トークン (Bearer 認証)
                └────┬────┘
                         │
                ┌────────▼────────┐
                │  tastile-core   │  ← Rust / axum / SQLx
                │  (API サーバー)  │     バックエンドのすべて
                └────────┬────────┘
                         │
                ┌────────▼────────┐
                │  PostgreSQL     │  ← データの永続化
                └─────────────────┘
```

### 5-1. バックエンドの核心原則

- **コマンド / イベント / リデューサーパターン** (Command/Event/Reducer)
- すべての書き込みはコマンド経由。直接 DB 更新禁止
- 識別子は UUIDv7。絶対時刻は UTC + offset_min
- 数値定数のみ。文字列 enum / JSONB / PostgreSQL enum 禁止
- 詳細は `tastile-core/HARNESS.md` および `tastile-core/v1/10-invariants.md`

---

## 6. インフラ・デプロイ構成

> **2026-11-14 改訂**: クラウドデプロイ運用は停止しており、再開しない
> (local-first)。core / web の deploy workflow・deploy script・deploy runbook は
> 各リポジトリで撤去済み (core `docs/plans/2026-11-14-retire-cloud-deploy-paths.md`、
> web PR #218)。以下の §6-1〜6-3 は **停止中の構成の記録** であり、現在の
> 開発・検証・利用はローカル実行 (host dev server + ローカル PostgreSQL +
> Core daemon) を前提とする。AWS リソースの復旧・再作成は開発目標に含めない。
> 既存のローカル運用データは保護し、未承認の移行・破壊的操作は行わない。
>
> **2026-11-24 改訂 (ADR-0025 / tastile-root#141)**: 正式リリース構成として、
> 既存 Windows マシン上の無償仮想化による隔離 Ubuntu LTS VM + Docker Compose
> (API/Worker/Web/PostgreSQL 16/Caddy) を採用し、公開は Caddy + Cloudflare
> Tunnel Free、製品サイトは Cloudflare Pages Free とする。追加クラウド料金は
> 0 円が上限で、Oracle Cloud は採用・調査・代替のすべてから除外する。
> 以下 §6-1〜6-4 は停止中の旧構成の記録であり、§6-5 が現行の採用構成である。

### 6-1. クラウドサーバー構成 (3 台) ※停止中の記録

| サーバー | 役割 | 詳細 |
| --- | --- | --- |
| **アプリサーバー** | tastile-core API の稼働 | アプリのみが機能する。Linux バイナリが直接動く |
| **データベースサーバー** | PostgreSQL によるデータ永続化 | **アプリサーバーからのみアクセス可能** (セキュリティ境界) |
| **Web 汎用サーバー** | Web アプリの公開・LP 公開・API ドキュメント公開・Desktop アプリデータの配置・認証コールバックの受け口 | 幅広い公開用途 |

### 6-2. 最終デプロイ先 ※停止中の記録 (現行はローカル実行)

| リポジトリ | デプロイ先 |
| --- | --- |
| tastile-core | AWS (アプリサーバー) |
| tastile-web | AWS (Web 汎用サーバー)。**Vercel は廃止** |
| tastile-android | Google Play Store |
| tastile-desktop | Web サーバーにアプリを配置し、ダウンロード・アップデート配信 (Microsoft Store 配信は未定) |
| tastile-ios | Apple App Store (将来) |
| tastile-mac | Apple App Store (将来) |

### 6-3. デプロイ経路 ※停止中の記録

- ~~すべてのリポジトリで **GitHub Actions** によるデプロイ経路を持つ~~ → 2026-11-14 に deploy workflow は全撤去。tag は release 統合の attestation のみ
- ~~直接デプロイも可能な経路~~ → deploy script は削除済み (git history に残る)
- ~~すべてのデプロイが **CLI で完結**~~ → 現行の build / test / 実行検証は各リポジトリの CLI (cargo / bun / scripts) でローカル完結
- Docker は使わない。**開発環境でも本番環境でも Linux バイナリが直接動く** (ローカル実行でも同様)

### 6-4. env 管理 ※廃止済み経路の記録 (現行は §6-5 / ADR-0025)

> **2026-11-25 改訂 (tastile-root#174)**: 本節の SOPS + AWS KMS + SSM 経路は
> **適用されず廃止** された。secret の編集正本 (SoT) は **Infisical** であり、
> 実行時は最小権限で供給する (§6-5 参照)。`infra/sops/` の Terraform は
> 未 apply (state なし) で、apply すると KMS key が $1/key/月の課金対象に
> なるため **apply 禁止** とする。`scripts/sops-decrypt.ts` /
> `scripts/sops.config.ts` は placeholder ARN の dead path として削除済み。
> 以下は歴史的経緯の記録であり、現行の手順として使わないこと。

- `.env` に含まれる項目すべてを **`.env.example`** として残す (値は空)
- (廃止) canonical として **`.env.<env>.sops`** (AWS KMS で暗号化された ciphertext) を commit し、起動時に bun loader (`scripts/sops-decrypt.ts`) が KMS Decrypt で `.env.<env>` へ復号する。KMS key policy は developer SSO / GitHub Actions OIDC role / EC2 instance profile の 3 principal category を allow する (旧 `kms:ViaService` condition は SSO 直接復号を誤って遮断していたため除去済み — 経緯は `docs/adr/0006-kms-viaservice-removal.md`、設計は `docs/superpowers/specs/2026-08-27-sops-env-decryption-design.md` を参照)
- (廃止) production の hot path は **AWS SSM Parameter Store / Secrets Manager** を並列維持し、systemd `EnvironmentFile=` 経由で配信する (SOPS 復号値と衝突しないよう、infra URL 類は SSM 側 / application secret は `.sops` 側で分担)
- 平文 `.env` / `.env.<env>` は `.gitignore` で除外 (loader が起動時に書き出す)

### 6-5. 採用構成 — Native-first 正式リリース (2026-11-24, ADR-0025 / #141)

> 正式リリース計画 v0.4 (tastile-root#141) で採用が確定した構成。詳細な
> タスク分解・受入条件・依存関係は #141 と配下の NF04-* Issue が正本。

- **実行ホスト**: 既存の常時稼働 Windows マシン + 既存無償仮想化 (購入不要)
- **サーバ環境**: 隔離 Ubuntu LTS VM + Docker Compose
  - API (Rust/axum)・Worker (Rust/Tokio)・Web (Next.js standalone)・
    PostgreSQL 16・Caddy reverse proxy を固定入力から再現可能に構成
- **公開経路**: Caddy + Cloudflare Tunnel Free (独立無料環境)。
  製品サイトは Cloudflare Pages Free の静的配信
- **配布**: Windows = Microsoft Store / MSIX、CLI = GitHub Releases。
  インストーラーを Tunnel/API で中継しない
- **Secret**: Infisical を編集正本、実行時は最小権限供給 (常時接続を必須にしない)
- **Backup**: 既存の別物理 Mac へ SSH 転送 + age 暗号化。別障害ドメインで復元実証
- **費用境界**: 追加クラウド料金 0 円。Oracle Cloud は採用・調査・代替・
  fallback のすべてから除外。有料経路の再開・新規課金契約・外部公開・
  DNS 移管・本番データ切替は明示承認が必要
- **隔離**: 現行 Muse 運用 SoT (実予定・認証・通知・自動化) とは DB/port/
  credential/通知先を分離し、許可なき操作を禁止。検証は #104 の verify-stack
  等の隔離環境で行う

---

## 7. 認証モデル

認証は **2 系統** あり、それぞれ **独立して** 動作する。

> 2026-08-22 ADR: アカウント認証を AWS Cognito から BetterAuth へ置き換え。
> 経緯と例外承認は `docs/decisions.md` の当該エントリを参照。

### 7-1. アカウント認証 — BetterAuth (tastile-web 内蔵)

- ユーザーのログイン / サインアップに使用
- better-auth を tastile-web (Next.js) の route handler で稼働
- email+password / Google・Apple OAuth / email OTP / TOTP MFA
- auth 用 table は同一 private RDS 内の専用 database + 最小権限 role
  (web サーバーからの接続は本決定で承認された例外。core domain table への権限はない)
- メール送信は SES 直接送信 (sendEmail hook)
- identity key は better-auth user id。core 側は `v1_subject.external_subject` として保持し、
  owner 導出 `Uuid::new_v5(NAMESPACE_OID, external_subject)` は不変

### 7-2. API 認証 — API トークン (Bearer)

- **API に接続できるのは API トークンのみ**
- API トークンはアプリのあるローカルに保存される
- アカウント認証のトークンとは別系統
- mobile / desktop は system browser で web login page を開き、better-auth bearer token を
  取得 → `/api/mobile/api-token` 形式で検証後に core API token を mint

```
ユーザー → web login page (BetterAuth) → アカウント認証完了
                                     ↓
                              API トークン発行
                                     ↓
アプリ → API トークン (Bearer) → tastile-core API
```

---

## 8. API 方針

### 8-1. バージョニング

- API ルートに **`/vN/`** を含める (例: `/v1/tiles`, `/v1/placements`)
- バージョンは **サーバー独立** で管理する
- 過去のバージョンの処理は **動き続ける** (後方互換を維持)
- 基本的にバージョンは **固定** され、作り直しレベルの大規模変更時にのみ上がる

### 8-2. データベース

- **PostgreSQL** を使用
- PostgreSQL の enum 型は使わない (`smallint` + アプリ Registry)
- JSONB を正本に保存しない (子テーブルへ正規化)

### 8-3. 課金

- 通知機能完成後に実装
- **Stripe** を使用

---

## 9. 開発環境・ツールチェイン方針

### 9-1. パッケージマネージャ

- **bun に統一** (フロントエンド・スクリプト類すべて)

### 9-2. 使用 CLI

| CLI | 用途 |
| --- | --- |
| `aws` | AWS リソース管理・デプロイ |
| `cf` | Cloudflare 公式 CLI |
| `gcloud` | Google Cloud CLI |
| `stripe` | Stripe CLI |
| `cargo` | Rust ビルド・テスト |
| `bun` | パッケージ管理・フロントエンドビルド |

### 9-3. Windows 開発環境

- **WSL container** を使用し、Linux バイナリを動かす (注: `wsl` サブシステムとは別系統。`wslc` が OCI ランタイム。WSL distro `Ubuntu` の `ext4.vhdx` がこのホストで `HCS/ERROR_PATH_NOT_FOUND` を返すため `wsl -d Ubuntu --exec ...` 経路は塞がれている。WSLC コンテナ (`tastile-db`, `tastile-api`, `tastile-worker`) は別ファイルシステムで独立稼働。)
- `tastile-core.wslc` は WSL distro `Ubuntu` 内の `tastile-core` クローン (`cargo build`/`cargo test` の Linux 実行用; `wsl -d Ubuntu` 依存)

### 9-4. 本番環境

- **2026-11-24 改訂 (ADR-0025)**: 本番相当環境は専用 Ubuntu LTS VM 上の
  Docker Compose (API/Worker/Web/PostgreSQL 16/Caddy) とする。旧来の
  「Docker は使わず Linux バイナリ直接実行」モデルは退役。開発・検証でも
  #104 の verify-stack (Colima/Compose) を隔離環境として利用する

---

## 10. 正本の所在 (Source of Truth)

| 対象 | 正本の場所 |
| --- | --- |
| プロジェクト全体方針・全体設計 | **tastile-root/docs/HARNESS.md** (本ドキュメント) |
| 製品別バージョン所有権・統合対象の固定 | **tastile-root/docs/releases/version-matrix.json** + [ADR-0013](adr/0013-independent-product-versioning.md) |
| ドメインモデル・不変条件・仕様 | tastile-core/v1/*.md (16 ファイル) |
| 実装ハーネス (バックエンド詳細) | tastile-core/HARNESS.md |
| API 仕様 | tastile-core/v1/14-read-model-and-endpoint.md |
| ブランドアセット | tastile-brands/ (コピーして使用) |
| Web 実装詳細 | tastile-web/AGENTS.md |
| Android 実装詳細 | tastile-android/README.md |
| Desktop 実装詳細 | tastile-desktop/README.md, tastile-desktop/CLAUDE.md |
| 正式リリース計画 v0.4 (NF04 全42タスク) | **tastile-root#141** + 配下の NF04-* Issue |

---

## 11. エージェント向けルーティング表

| やりたいこと | 読むべきドキュメント | 触るリポジトリ |
| --- | --- | --- |
| プロジェクト全体像の把握 | **本ドキュメント** | — |
| ドメインモデルの理解 | tastile-core/v1/02-core-entities.md | — |
| 不変条件の確認 | tastile-core/v1/10-invariants.md | — |
| バックエンド API の変更 | tastile-core/HARNESS.md → v1/14 | tastile-core |
| Web フロントエンドの変更 | tastile-web/AGENTS.md | tastile-web |
| Android フロントエンドの変更 | tastile-android/README.md | tastile-android |
| Desktop フロントエンドの変更 | tastile-desktop/CLAUDE.md | tastile-desktop |
| ロゴ・ブランドアセットの更新 | tastile-brands/README.md | tastile-brands |
| デプロイ・インフラの変更 | 本ドキュメント §6 (deploy 経路は停止中・local-first) + 各リポジトリの CI/ | tastile-core, 対象リポジトリ |
| 認証フローの変更 | 本ドキュメント §7 + tastile-core/v1/14 | tastile-core, 対象クライアント |
| 新規クライアント (iOS/Mac) の追加 | 本ドキュメント §4 | 新リポジトリ作成 |
| 課金機能の実装 | 本ドキュメント §8-3 + Stripe docs | tastile-core, tastile-web |

---

## 12. 禁止事項 (ワークスペース横断)

- **旧 v7 語彙を使わない**: `6軸 enum` / `TickOutput` / `Arbiter` / `Materializer` / `v7_tiles` 等
- **archive を改変しない**: `docs/archive/` 配下は不変
- **tastile-brands を相対パスで参照しない**: 必要なときにコピーして使用
- **フロントエンドにビジネスロジックを置かない**: すべて tastile-core API 経由
- **コンテナ利用は ADR-0025 の採用範囲に限定**: 専用 VM の本番 Compose と隔離 verify-stack (#104) では Docker Compose を使う。それ以外の環境でのコンテナ依存追加は ADR 改訂を要する
- **PostgreSQL の enum 型を使わない**: `smallint` + アプリ Registry
- **JSONB を正本に保存しない**: 子テーブルへ正規化
- **env の値をリポジトリにコミットしない**: `.env.example` に項目のみ残す。secret の SoT は Infisical (§6-5 / ADR-0025)。旧 `.env.<env>.sops` 経路は廃止 (§6-4 参照)
- **存在しない外部ドキュメントを参照しない**: `pomodoroom/CORE_POLICY.md` / `tastile_docs_bundle/` 等の旧参照は禁止

---

## 13. 現在のステータスと次のマイルストーン

### 13-1. リポジトリ別ステータス (2026-09-05 時点 — 最新は `check-workspace.ps1 -Profile full` で確認)

| リポジトリ | fast gate | full gate | 備考 |
| --- | --- | --- | --- |
| tastile-core | ✓ | BLOCKED | domain 149 件 Green。full は PostgreSQL 接続情報がない場合に終了コード 2 で停止 |
| tastile-web | ✓ | ✓ | Biome + ESLint + tsc + 316 tests + production audit + Next production build |
| tastile-android | ✓ | ✓ | JDK 21 を自動選択。verify + assembleDebug 通過 |
| tastile-desktop | ✓ | ✓ | 188 tests + default/win-x64 build 通過 |
| tastile-brands | ✓ | ✓ | 56 PNG + ICO を再生成・検証 |

### 13-2. 実行ハーネスと収束ループ

正本は `tastile-core`、`tastile-web`、`tastile-android`、`tastile-desktop`、`tastile-brands` の5リポジトリ。`*.wslc`、`*.avatar`、その他の複製クローンは対象外とする。

```powershell
# 日常の高速フィードバック
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing

# リリース相当。機械可読結果も保存
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile full -KeepGoing -ResultPath .\.tmp\workspace-check.json

# 一時的失敗だけを最大3回まで再試行
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile full -KeepGoing -MaxAttempts 3
```

- 終了コード `0`: 選択した gate がすべて通過
- 終了コード `1`: コード、テスト、ビルドの失敗
- 終了コード `2`: DB、JDK、リポジトリ欠落、ディスク空き容量不足（`-MinFreeGB`、既定 2 GiB）など外部前提による BLOCKED
- 停止条件: 全通過、再試行上限、または外部前提の不足。BLOCKED を成功として扱わない
- core full gate には `TASTILE_DATABASE_URL` または `DATABASE_URL` で到達可能な PostgreSQL が必要
- ディスク資源の監視・回収は `scripts/disk-hygiene.sh`（POSIX）と `docs/runbooks/disk-resource-management.md` が正本（root#170）。重いビルド前は `disk-hygiene.sh check`（既定 15 GiB floor）を通す

### 13-3. Agent commit review loop (deprecated 2026-09-29)

2026-09-29 付で per-commit reviewer loop (`.agent-loop/` + `tastile-precommit-review` Skill)
は廃止した (ADR-0012)。本節は運用履歴として残し、参照のみ。新しい binding verification
contract は `verify-tastile-change` Skill に統一する。

- per-repo fast gate はそれぞれ次の入口を使う: `pwsh -NoProfile -File scripts\check-agent-environment.ps1`
  (root)、`bun run check` (web / blogs)、`cargo test -p domain` (core)、
  `./gradlew verify --no-daemon` (android)、`pwsh scripts\check.ps1` (desktop)。
- critical / important の検査は project-init の `quality-gate` Skill が PR 前 binding
  evidence として吸収する。
- 削除された hook (`.claude/hooks/hook-dispatch.mjs` の `agent-loop-precommit-review` /
  `.codex/hooks.json` の `.agent-loop\Invoke-AgentHook.ps1`) は残存する
  `git-guard.mjs` / `tastile-command-guard.ps1` と並走しない (機能分離)。

旧 engine / Skill の evidence は git history に残っているため、必要に応じて
`git log --diff-filter=D -- .agent-loop/` および `git log --diff-filter=D -- '*.agents/skills/tastile-precommit-review/*'` で参照する。

### 13-4. 次のマイルストーン

正式リリース計画 v0.4 (tastile-root#141 / ADR-0025) の NF04-* Issue 群を完了し、
NF04-I07 の全 gate (Cost/Domain/Security/Usability/Recovery/Performance) を
達成して正式リリースする。#105 の個人実用化 gate (G3/G5) は NF04-I06 として
リリース受入へ接続する。
