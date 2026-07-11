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

- **web と android を完全に完成させる** ことが最優先
- desktop / ios / mac は後続

### 3-3. 仕様の正本

- `tastile-core/v1/` 配下の 15 ファイルが唯一の正本
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
| tastile-core | 開発中 (v1 Phase A-D 完了) | **最高** |
| tastile-web | 開発中 | **高** — 完全な完成が目標 |
| tastile-android | 開発中 | **高** — 完全な完成が目標 |
| tastile-desktop | 開発中 (動作可能) | 中 — 後続 |
| tastile-brands | 安定 | 維持 |
| tastile-ios / tastile-mac | 未着手 | 低 — 将来 |

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
                    │  認証   │  ← Cognito (アカウント認証)
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

### 6-1. クラウドサーバー構成 (3 台)

| サーバー | 役割 | 詳細 |
| --- | --- | --- |
| **アプリサーバー** | tastile-core API の稼働 | アプリのみが機能する。Linux バイナリが直接動く |
| **データベースサーバー** | PostgreSQL によるデータ永続化 | **アプリサーバーからのみアクセス可能** (セキュリティ境界) |
| **Web 汎用サーバー** | Web アプリの公開・LP 公開・API ドキュメント公開・Desktop アプリデータの配置・認証コールバックの受け口 | 幅広い公開用途 |

### 6-2. 最終デプロイ先

| リポジトリ | デプロイ先 |
| --- | --- |
| tastile-core | AWS (アプリサーバー) |
| tastile-web | AWS (Web 汎用サーバー)。**Vercel は廃止** |
| tastile-android | Google Play Store |
| tastile-desktop | Web サーバーにアプリを配置し、ダウンロード・アップデート配信 (Microsoft Store 配信は未定) |
| tastile-ios | Apple App Store (将来) |
| tastile-mac | Apple App Store (将来) |

### 6-3. デプロイ経路

- すべてのリポジトリで **GitHub Actions** によるデプロイ経路を持つ
- 加えて **直接デプロイも可能な経路** を維持する
- 基本的にすべてのデプロイが **CLI で完結** する
- Docker は使わない。**開発環境でも本番環境でも Linux バイナリが直接動く**

### 6-4. env 管理

- `.env` に含まれる項目すべてを **`.env.example`** として残す (値は空)
- 実際の値は `.env` (ローカル) と **GitHub Secrets** (CI) に保存
- `.env` ファイルは `.gitignore` で除外

---

## 7. 認証モデル

認証は **2 系統** あり、それぞれ **独立して** 動作する。

### 7-1. アカウント認証 — AWS Cognito

- ユーザーのログイン / サインアップに使用
- Google OAuth を Cognito Hosted UI で連携
- 認証のコールバックは Web 汎用サーバーに返る

### 7-2. API 認証 — API トークン (Bearer)

- **API に接続できるのは API トークンのみ**
- API トークンはアプリのあるローカルに保存される
- Cognito の認証トークンとは別系統

```
ユーザー → Cognito Hosted UI → アカウント認証完了
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

- **WSL container** を使用し、Linux バイナリを動かす
- **Docker は使わない** (開発でも本番でも)
- tastile-core.wslc は WSL 内での core クローン

### 9-4. 本番環境

- Linux バイナリが直接動く
- Docker は使わない

---

## 10. 正本の所在 (Source of Truth)

| 対象 | 正本の場所 |
| --- | --- |
| プロジェクト全体方針・全体設計 | **tastile-root/docs/HARNESS.md** (本ドキュメント) |
| ドメインモデル・不変条件・仕様 | tastile-core/v1/*.md (15 ファイル) |
| 実装ハーネス (バックエンド詳細) | tastile-core/HARNESS.md |
| API 仕様 | tastile-core/v1/14-read-model-and-endpoint.md |
| ブランドアセット | tastile-brands/ (コピーして使用) |
| Web 実装詳細 | tastile-web/AGENTS.md |
| Android 実装詳細 | tastile-android/README.md |
| Desktop 実装詳細 | tastile-desktop/README.md, tastile-desktop/CLAUDE.md |

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
| デプロイ・インフラの変更 | 本ドキュメント §6 + 各リポジトリの deploy/ | tastile-core, 対象リポジトリ |
| 認証フローの変更 | 本ドキュメント §7 + tastile-core/v1/14 | tastile-core, 対象クライアント |
| 新規クライアント (iOS/Mac) の追加 | 本ドキュメント §4 | 新リポジトリ作成 |
| 課金機能の実装 | 本ドキュメント §8-3 + Stripe docs | tastile-core, tastile-web |

---

## 12. 禁止事項 (ワークスペース横断)

- **旧 v7 語彙を使わない**: `6軸 enum` / `TickOutput` / `Arbiter` / `Materializer` / `v7_tiles` 等
- **archive を改変しない**: `docs/archive/` 配下は不変
- **tastile-brands を相対パスで参照しない**: 必要なときにコピーして使用
- **フロントエンドにビジネスロジックを置かない**: すべて tastile-core API 経由
- **Docker を使わない**: 開発でも本番でも Linux バイナリ直接実行
- **PostgreSQL の enum 型を使わない**: `smallint` + アプリ Registry
- **JSONB を正本に保存しない**: 子テーブルへ正規化
- **env の値をリポジトリにコミットしない**: `.env.example` に項目のみ残す
- **存在しない外部ドキュメントを参照しない**: `pomodoroom/CORE_POLICY.md` / `tastile_docs_bundle/` 等の旧参照は禁止

---

## 13. 現在のステータスと次のマイルストーン

### 13-1. リポジトリ別ステータス (2026-07-10 時点)

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
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile full -KeepGoing -ResultPath .\artifacts\workspace-check.json

# 一時的失敗だけを最大3回まで再試行
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile full -KeepGoing -MaxAttempts 3
```

- 終了コード `0`: 選択した gate がすべて通過
- 終了コード `1`: コード、テスト、ビルドの失敗
- 終了コード `2`: DB、JDK、リポジトリ欠落など外部前提による BLOCKED
- 停止条件: 全通過、再試行上限、または外部前提の不足。BLOCKED を成功として扱わない
- core full gate には `TASTILE_DATABASE_URL` または `DATABASE_URL` で到達可能な PostgreSQL が必要

### 13-3. Agent commit review loop

Claude Code、Codex、OpenCode は `tastile` 直下から起動する。各agentのネイティブ tool hook は、agentが単一の直接 `git -C <repo> commit ...` を実行する直前に共通エンジンを起動する。

- Git hookではない。人間の通常commitには作用しない
- fast gateと別CLI agent reviewの両方が必須
- gate、skill、reviewerはHEADへcommit予定patchだけを適用した一時snapshot上で動く
- Claude→Codex、Codex→Claude、OpenCode→Codexとして自己レビューを禁止
- project固有基準は各child repoの `.agents/skills/tastile-precommit-review/SKILL.md`
- Critical / Important のみblocking。approvalはキャッシュしない
- CLI不在、認証不足、timeout、判定不能、曖昧なshell形式はfail-closed
- 実装・対応形式・テストは `.agent-loop/README.md` を正本とする

### 13-4. 次のマイルストーン

1. **web と android の完全な完成**
2. 通知機能の実装
3. 課金機能の実装 (Stripe)
4. Phase 5: 旧 v0 撤去
