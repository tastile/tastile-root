# ADR-0013: 製品別独立バージョン管理と root 統合正本

- 日付: 2026-11-19
- 状態: Accepted
- 対象: Tastile workspace 全体 (tastile-core / tastile-web / tastile-android /
  tastile-desktop / tastile-ios / tastile-mac / tastile-cli / tastile-openapi /
  tastile-root)
- 関連 issue: tastile-root#130
- canonical policy: [Constitution](../../constitution/CONSTITUTION.md)、
  [Operating Model](../../organization/profiles/release-driven-solo.md)

## Context

Tastile は単一プロダクトではなく、独立してリリースされる複数の製品
(Core daemon/API、Web、Android、Desktop、CLI、契約スナップショット) の
集合である。現状、バージョン番号の所有権と正本が暗黙のまま運用されており、
次の問題が確認された (2026-11-19 時点の実測)。

- **Core の製品バージョン**は `crates-v1/Cargo.toml [workspace.package] version`
  (= `1.0.2`) が正本で、`CARGO_PKG_VERSION` 経由で `/v1/version`、`/v1/health`、
  CLI `--version` に流れる。一方 `crates-v2` workspace version (`0.1.0`) は
  内部実装バージョンであり、製品バージョンと混同され得る。
- **Web** は `package.json#version` (`1.0.2`) と git tag (最新 `v1.0.4`) が
  drift している。
- **Android** は `versionName 0.6.0` / `versionCode 33`、release branch は
  `release-0-7-0` (次期目標版を示唆する命名規則)。
- **Desktop (WinUI)** は csproj `<Version>0.6.0.0` の 4 桁独自形式。
- **OpenAPI** は独立 SemVer (tag `v3.7.0`) を持つが、doc 内の
  `info.version: 1.1.0` は API 契約版であり、spec リリース版・Core 製品版の
  3 軸が未文書化。
- **iOS / macOS** は `Package.swift` stub のみで dormant (2026-03 以降無更新)。
- **root** には「どの製品のどの SHA・契約・成果物・受入状態を統合対象とするか」
  を固定する機械可読な正本が存在しない。

このままでは、(a) 一つの製品だけを更新した際に他製品の版変更や不要な
再リリースを誘発する連鎖が起き得る、(b) Core の v1 実用化 RC と v2 意味論
リリースの版系列の区別がつかない、(c) OpenAPI 契約版と Core 製品版の
互換性がバージョン番号の一致に誤って依存し得る。

## Decision

### 1. 製品別独立 SemVer 系列

各製品 repository は **独自の Semantic Versioning 系列** を持つ。
共通バージョン番号は存在しない。`release-x-y-z` branch 名と `vX.Y.Z` tag は
各 repository 内でその製品の目標/リリース版を表す。

| 製品 | Repo | 製品バージョン正本 | 版系列 |
| --- | --- | --- | --- |
| Core (daemon/API/engine + 同梱 CLI) | tastile-core | `crates-v1/Cargo.toml [workspace.package] version` → `CARGO_PKG_VERSION` → `/v1/version`・`/v1/health`・`--version` | 独立 SemVer |
| Web (dashboard/PWA) | tastile-web | `package.json#version` + build 時 `NEXT_PUBLIC_APP_VERSION` | 独立 SemVer |
| Android | tastile-android | `app/build.gradle.kts` の `versionName` / `versionCode` | 独立 SemVer (versionCode は Play 連番) |
| Desktop (Windows/WinUI) | tastile-desktop | `src/TastileDesktop/TastileDesktop.csproj` `<Version>` | 独立 SemVer。csproj は .NET 慣例の 4 桁 (`0.7.0.0`) を維持し、製品 SemVer としては `0.7.0` と解釈する (tag・workflow_dispatch version は csproj 値と完全一致が必須) |
| CLI (standalone) | tastile-cli | `Cargo.toml` workspace `version` | 独立 SemVer |
| OpenAPI 契約 | tastile-openapi | git tag `vX.Y.Z` + `CHANGELOG.md` | 独立 SemVer (wire format の互換性で bump 判定) |
| iOS / macOS | tastile-ios / tastile-mac | 未確立 (dormant) | 系列未開始 |
| Root | tastile-root | **なし** — 製品バージョンを持たない | — |

### 2. 3 つの版軸を混同しない

| 軸 | 意味 | 例 |
| --- | --- | --- |
| 製品バージョン | 各 repo のリリース単位 | Core `2.0.0`、Web `1.1.0` |
| API 契約版 | wire format の互換性版 | OpenAPI `info.version` (`1.1.0`)、spec tag `v3.7.0` |
| 内部実装バージョン | crate/workspace 内部の版 | `crates-v2` workspace `0.1.0` |

- Core の `crates-v1` workspace version は **Core 製品バージョンそのもの**
  (バイナリが報告する版) として扱う。`crates-v1` という名前は v1 API 世代
  (テーブル接頭辞・`/v1/` パス) を指し、製品バージョンとは別概念である。
- `crates-v2` workspace version は内部実装バージョンであり、製品
  バージョンの bump に連動しない。
- OpenAPI の `info.version` は API 契約版であり、Core 製品バージョンや
  spec リリース tag (`v3.x`) のいずれとも一致を要求しない。

### 3. Root は統合正本を持つが共通バージョンを持たない

`docs/releases/version-matrix.json` を機械可読な統合正本とし、各製品の
`version` / `tag` / `commit SHA` / `契約 pin (OpenAPI spec 版・consumer SHA)` /
`受入状態` を記録する。root 自身は製品バージョンを持たず、release branch
も製品版を共有しない。連携が必要な場合も単一版番号を共有せず、この
マトリクスで統合対象を固定する。

### 4. Core 2.0.0 の位置付け

- Core の次期製品リリース目標版は **2.0.0** とする。対象は v2 意味論
  (registry/v2、P1–P6 の semantic preservation) を含む統合候補であり、
  `release-2-0-0` branch で管理する。
- 既存の `release-1-2-0` は `release-2-0-0` の起点として履歴を保持する
  (branch 名の rename ではなく、同一 head からの新規 branch 作成。
  既存 PR・履歴は破壊しない)。
- 既存 v1 実用化 RC (`release-1-1-0` → 製品版 1.1.0) は独立した系列として
  継続し、2.0.0 へ改名・統合しない。v1 RC は「v1 API 面の実用化」、
  2.0.0 は「v2 意味論保証を含む次期製品」として位置付けを分離する。
- 2.0.0 で提供・保証する機能と互換性の正本は tastile-core 側の
  `docs/product-versions.md` (同 ADR の実装 ticket で新設) に定義する。

### 5. OpenAPI は Core 版から独立

- OpenAPI spec の版 (tag `vX.Y.Z`) は wire format の互換性のみで決まり、
  Core 製品バージョンの一致を要求しない。
- 互換性は **契約検証** (Core `dump_openapi` からの再生成が byte-identical、
  consumer の型再生成と drift check) と **互換性マトリクス**
  (`tastile-openapi` の `docs/compatibility.md`) で保証する。
- `info.version` (API 契約版) も独立軸として管理し、Core 製品版への
  追従を要求しない。

### 6. 単一製品リリースの独立性

任意の一つの platform だけを更新しても、他製品の版変更・tag・再リリースは
発生しない。契約変更が必要な場合のみ、OpenAPI spec 版の bump → consumer
pin 更新 → root マトリクス更新という明示的な連鎖を踏む。

## Consequences

- 各 repo の `docs/operations/release-workflow.md` / `docs/release.md` /
  README は本 ADR を参照し、独立系列であることを明記する。
- version bump は各 release train の責務であり、本 ADR は版番号の
  *所有権と対応関係* のみを固定する。実際の bump タイミングは従来通り
  release branch 上で行う。
- `release-* → main` の統合は従来通り明示承認を必要とする (本 ADR は
  変更しない)。
- iOS / macOS は系列未開始のため、matrix では `dormant` と記録し、
  有効化時に個別 ADR で正本を確立する。

## Alternatives considered

- **workspace 共通バージョン (monorepo 的統一版)**: 却下。製品ごとに
  リリース周期・互換性・配布経路が異なり、無関係な製品の再リリースを
  強制する。
- **root が全製品版を強制管理**: 却下。root は shell repository であり、
  製品の実装・配布を所有しない。統合対象の *記録* に留める。
- **OpenAPI 版 = Core 版の一致**: 却下。契約の互換性は wire format で
  決まり、Core の内部実装版や製品版とは独立に進化する。

## Verification

- `docs/releases/version-matrix.json` が全 active 製品を網羅し、
  各 `version_sot` が実ファイルの実値と一致することを確認する
  (本 ADR の実装 ticket で script 化を検討)。
- Core `release-2-0-0` で `crates-v1` workspace version = `2.0.0`、
  `/v1/version` が `2.0.0` を返すことを test で pin する。
- 単一製品のみの branch/tag 操作で他 repo に diff が出ないことを
  手順上確認する (matrix は記録であり強制機構ではない)。
