# T13 — v2 local runtime → Web adapter → typed result → Web display

Date: 2026-11-14
Campaign: root #105 (local-first 実用化)。T12 中間報告 (同 Issue コメント 2026-11-14) の結論を引き継ぐ。

## 目的と範囲

T12 で確認済みの **typed option scheduler artifact** (`examples/scheduler-option-producer`,
WIT `tastile:contract@0.2.0`, v1 `plan_step_occurrences` と 9/9 fixture 一致) を、
検証 Web から **adapter 経由で v2 local runtime を呼び、typed result を Web に表示**する
最小経路を実装する。

- v1 経路を既定 (default) とし、本経路は **明示 opt-in** のみで有効化する
- v2 呼出の失敗時は **v1 fallback または typed fallback result** を返し、UI を壊さない
- 検証は隔離 verify-stack + 合成 fixture のみ。**運用 stack・実データ・外部依存には触れない**
- T14/T15 (shadow 比較・本番接続) は本計画の対象外 (未承認)

## T12 からの引き継ぎ

- 再利用するのは既存 `scheduler-option` artifact/composition であり、scheduler の再実装はしない
- 等価性は Step planner (ミリ秒 fixture) に限定。anchor lookup・DB materialization・
  placement 解決・worker 挙動は artifact の範囲外 → adapter も同範囲に留める
- 証拠 SHA: core `origin/main` `39919003` / `origin/v2/general-computation` `b8b66d9`
- **注意**: `crates-v2` は `origin/main` に存在するが `release-1-1-0` には未取り込み
  (placeholder のみ)。v2 は additive/independent workspace であり、release branch への
  取り込みは本 T13 のスコープ外。adapter が必要とするのは `tastile-v2` バイナリと
  artifact/lock ファイルであり、core release のコードには依存しない

## アーキテクチャ判断

### 候補

1. **BFF adapter (採用)**: tastile-web の server-side route (`/api/...`) が
   `tastile-v2` CLI を subprocess として起動し、JSON 結果を typed 化して返す
2. v2 専用 HTTP sidecar サービスを新設 — 新規常駐プロセス・port・監視が必要で過剰
3. crates-v1 api への v2 endpoint 追加 — v1 workspace への v2 依存混入、
   「v2 は v1 に依存しない」境界の運用を濁す

### 採用理由

- secret・内部 runtime 詳細を browser に出さない (BFF/server-side が境界)
- v2 runtime は capability-default-deny の pure local 評価であり、常駐化の必然性がない
- `tastile-v2 run <lock> --input PORT=VALUE` は既に typed JSON + exit code
  (0..7) を返す CLI 契約を持ち、adapter は薄い写像層で済む
- 失敗時 fallback を adapter 内で完結できる

### adapter 契約 (案)

- Route: `POST /api/v2/scheduler/evaluate` (仮。web 側命名規約に合わせて確定)
- Request: `{ opt_in: true, input: {…scheduler-option の PORT=VALUE 群…} }`
- Server 処理:
  1. `TASTILE_V2_ENABLED` (server env) と request `opt_in` の両方が true のときのみ v2 経路
  2. `TASTILE_V2_CLI` (binary path), `TASTILE_V2_STORE` (store dir),
     `TASTILE_V2_LOCK` (事前 compose 済み lock file) を env から解決
  3. `tastile-v2 run <lock> --input k=v …` を timeout 付きで spawn
  4. stdout JSON + exit code を typed result に正規化:
     `{ engine: "v2", ok: true, occurrences: [...], diagnostics: {...} }`
     `{ engine: "v2", ok: false, error: { code, message } }`
  5. 失敗時 (spawn 失敗 / timeout / 非 0 exit / JSON parse 失敗) は
     `{ engine: "fallback", ok: false, fallback_reason: "..." }` を返す。
     v1 経路の計算結果をここで再計算はしない (v1 default は別経路が担うため、
     adapter は typed fallback を返すに留める)
- opt-in なし / env 未設定の要求は `{ engine: "disabled" }` を返すか 404/403 で拒否
  (実装時に web のエラー規約へ合わせる)

## 変更対象 (予定)

### tastile-web

- `src/app/api/v2/scheduler/evaluate/route.ts` (新規 BFF route)
- `src/shared/api/v2/` または `src/lib/v2-adapter/` に adapter client/型
- 検証 UI: 最小の表示面。候補は create-tile 系の schedule preview に
  「v2 (opt-in)」トグルを足すか、検証用ページを新設するか — 実装計画の
  第2段で web の既存 preview コンポーネントを確認して決める
- `.env.example` に `TASTILE_V2_*` key 名を追加 (値は書かない)

### tastile-core (最小)

- 原則コード変更なし。`tastile-v2` binary の build 手順と、scheduler-option の
  composition → lock 生成手順を `crates-v2/` の docs または verify-stack 側に記録
- 必要なら adapter が使う固定 lock/artifact を verify 用に seed する手順を文書化

### tastile-root

- 本 plan 文書 (docs/plans/)
- 検証証跡は `tastile-core/docs/evidence/` または `tastile-web/docs/evidence/` の
  慣例に従う

## 受け入れ条件 (T13)

1. verify-stack (Web dev + core verify + `tastile-v2` binary) で
   opt-in 要求 → v2 typed result が Web に表示される (実ブラウザまたは
   API trace + screenshot)
2. opt-in なしの同一画面/経路は従来どおり v1/default 動作 (リグレッションなし)
3. `tastile-v2` 不在 / timeout / 不正入力で typed fallback が返り UI が壊れない
4. golden vector (`examples/vectors/scheduler-option.json`) との一致を
   adapter 経路でも確認 (少なくとも代表ケース)
5. `bun run check` (web) / fmt・clippy (触れた Rust があれば) が clean
6. 証跡に固定 SHA・コマンド・exit code・secret を含まないことを記録

## 非目標

- scheduler 以外の artifact の Web 接続
- v1 worker/pipeline への v2 結果の注入 (shadow/T14 以降)
- `release-1-1-0` への crates-v2 取り込み判断
- 運用 stack・実データ・外部 IdP/課金クラウドの利用

## リスク / 未決事項

- **lock/artifact の配布**: adapter が必要とする composition lock をどこに置き、
  どう version 固定するか (web repo 同梱 vs verify 環境 seed)。実装段階で決める
- **binary の所在**: verify では host build の `tastile-v2` を `TASTILE_V2_CLI` で
  指す。将来の配布形態 (container 同梱等) は T13 では決めない
- **Web 側の表示面**: 「予定計算結果の表示」として最も自然な既存 UI を
  web checkout で確認してから確定する (QuickCreate preview / schedule draft /
  専用検証ページのいずれか)
- **timeout / resource limit**: `tastile-v2 run` の `--fuel`/`--memory-mb`/
  `--timeout` 相当を adapter で必ず設定し、暴走を防ぐ
