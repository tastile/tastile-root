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

### adapter 契約 (確定)

CLI 契約は core `origin/main` `39919003` の `tastile-v2 run --help` で実測確認済み:

```
tastile-v2 run [OPTIONS] <LOCK>
  --input <PORT=VALUE>        repeatable。str=raw、その他=JSON
  --store <DIR>               store dir (default .tastile-v2)
  --no-cache                  memo cache bypass
  --fuel <FUEL>               per-node fuel budget
  --memory-mb <MEMORY_MB>     per-node memory limit (MiB)
  --timeout-ms <TIMEOUT_MS>   per-node wall-clock limit (ms)
```

stdout は typed JSON (`status`, `root` の provides 値, `nodes` diagnostics)、
exit code は 0 (success) または 1..8 の typed `ErrorKind`
(Validation=1, NotFound=2, Unsupported=3, ResourceLimit=4,
ExecutionError=5, Conflict=6, Internal=7, Undecided=8)。
adapter はこの契約だけに依存する。

- Route: `POST /api/v2/scheduler/evaluate` (web 側 `/api/...` BFF 規約に合わせる)
- Request (Zod 検証): `{ opt_in: true, input: { step_ms, span_ms, origin?,
  bounds_start?, bounds_end?, range_start_ms, range_end_ms } }`
  - `option<int>` port は `null` または整数。int port は整数のみ
  - port 名は scheduler-option の 7 入力に allowlist。未知 port・型不一致は
    adapter が 400 で拒否し subprocess を起動しない
- Server 処理:
  1. `TASTILE_V2_ENABLED=true` (server env) と request `opt_in` の両方が true の
     ときのみ v2 経路。どちらか欠ければ `{ engine: "disabled" }` を返す
     (opt-in なし要求を v2 成功と偽装しない)
  2. env から `TASTILE_V2_CLI` (binary path), `TASTILE_V2_STORE` (store dir),
     `TASTILE_V2_LOCK` (pre-built lock file) を解決。未設定は typed failure
  3. `tastile-v2 run <lock> --store <store> --fuel <F> --memory-mb <M>
     --timeout-ms <T> --input k=v …` を spawn。resource limit は **CLI option で
     per-node に強制**し、さらに adapter 側で subprocess 全体の wall-clock
     timeout (既定 10s、env で変更可) と concurrency 上限 (semaphore、既定 2)
     を設ける。上限値は adapter 定数として固定し request からは変更不可
  4. stdout JSON + exit code を typed result に正規化:
     `{ engine: "v2", ok: true, occurrences: [...], count: n, diagnostics: {...} }`
     `{ engine: "v2", ok: false, error: { code, message } }`
  5. 失敗時 (env 未設定 / spawn 失敗 / timeout / kill / 非 0 exit /
     stdout JSON parse 失敗 / provides 型不一致) は
     `{ engine: "fallback", ok: false, fallback_reason: "<code>" }` を返す。
     **v1 経路の計算結果をここで再計算して v2/fallback 成功と偽装しない**。
     v1 default は別経路 (既存 API) が担う
- 認証・認可: 既存 BFF route と同じ session 認証を要求し、未認証は既存規約の
  401/redirect に従う。v2 評価自体は owner データを読まない pure 関数評価だが、
  BFF 面としての認証境界は維持する
- 運用経路なし: 本 route は verify/dev 環境専用。`TASTILE_V2_ENABLED` を
  設定しない環境では常に disabled を返し、運用 stack の配備物・設定には
  一切追加しない

## 変更対象 (予定)

### tastile-web

- `src/app/api/v2/scheduler/evaluate/route.ts` (新規 BFF route、session 認証は
  既存 `/api/events/*` route と同じ規約)
- `src/lib/v2-adapter/` に adapter 実装 (subprocess spawn, Zod schema,
  semaphore, timeout, typed result 正規化) + Vitest
- `fixtures/v2/scheduler-option.composition.json`: scheduler-option artifact
  1 node の passthrough composition (artifact 登録・lock build の入力)。
  core repo は変更しない
- `scripts/v2-seed-store.sh`: `TASTILE_V2_CORE_DIR` の core checkout から
  `examples/scheduler-option-producer/artifact.json` と
  `examples/generated/scheduler-option.wasm` を読み、store へ登録 →
  composition 登録 → `compose build` で lock を生成する verify 用 seed
  手順 (lock/binary の version 固定は env path + commit SHA 記録で担保)
- 検証 UI: `src/app/app/v2-scheduler/` に最小の opt-in 評価ページを新設
  (既存 schedule preview への組込みは影響範囲が大きいため T13 では分離。
  実ブラウザ受入はこのページで行う)
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

## リスク / 未決事項 (解消済み)

- **lock/artifact の配布**: composition fixture は tastile-web に commit。
  store への artifact 登録と lock build は `scripts/v2-seed-store.sh` が
  verify 時に行い、lock path を `TASTILE_V2_LOCK` で固定する。lock 内容は
  artifact/wasm の digest に依存するため、seed 時の core checkout SHA を
  証跡に記録する
- **binary の所在**: verify では host build の `tastile-v2` を
  `TASTILE_V2_CLI` で指す。web dev server も host 実行のため container
  同梱は不要。将来の配布形態は T13 の対象外
- **Web 側の表示面**: 既存 preview への組込みは v1 default 経路への影響が
  読めないため、T13 は専用 opt-in ページ `/app/v2-scheduler/` で受入する。
  実用 UI への統合は T13 受入後の別 ticket
- **resource limit**: `tastile-v2 run` の `--fuel` / `--memory-mb` /
  `--timeout-ms` (per-node) を adapter が固定値で必ず付与し、さらに
  subprocess 全体の wall-clock timeout と concurrency semaphore を
  adapter 側で強制する (request からは変更不可)
