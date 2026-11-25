# Stack operations runbook (compose project 誤爆防止, root#183)

2026-11-25 に発生したインシデント: agent が `deploy/verify-stack` で project 名
既定値（`verify-stack`）のまま `docker compose up` を実行し、稼働中の
`tastile-acc`（acceptance harness 用 verify instance）のコンテナを一時
recreate した。compose の project 名・container 名・port・volume・image
tag が env 依存で暗黙的だったことが原因。

**以後、compose stack の操作は必ず `scripts/stack.sh` 経由で行う。**
`scripts/stack.sh <stack-id> <cmd> [args]` は `deploy/stacks.tsv` の registry
から project 名・env file・期待 port・期待 image を一意に解決し、preflight
を通過した場合だけ compose を実行する。直接 `docker compose` を叩く手順は
この文書と各 README から排除する。

## registry (`deploy/stacks.tsv`)

| id | dir | project | class | 用途 |
| --- | --- | --- | --- | --- |
| `verify` | deploy/verify-stack | `tastile-verify` | verify | 既定のローカル検証 instance |
| `acc` | deploy/verify-stack | `tastile-acc` | verify | acceptance harness 用（証跡 pin: `acc-533bcbec`） |
| `verify-145` | deploy/verify-stack | `verify-stack` | verify | NF04-R05 資源制限検証（project label は dir 既定値のまま。下記「既知の drift」参照） |
| `w03` | deploy/verify-stack | `tastile-w03` | verify | worktree-03 検証 instance |
| `prod-acc` | deploy/prod-stack | `tastile-prod-acc` | prod-equiv | prod-equivalent 受入 stack |
| `prod` | deploy/prod-stack | `tastile-prod` | prod | 本番 VM 上の実 stack |

`class` が `prod-equiv` / `prod` の stack への破壊的操作（`down -v` /
`--volumes`、`rm -v` / `--volumes`）は
`TASTILE_STACK_DESTRUCTIVE_OK=<stack-id>` が必須。`--force` では回避できない。

## preflight の検査項目

`up` / `down` / `restart` / `rm` / `exec` / `run`（mutating）で実行され、
`ps` / `logs` / `config` / `images` / `ls`（read-only）では identity のみ
警告として報告する。

1. **config 解決**: `docker compose config` が env 解決に成功すること
   （失敗 = env file / 変数不足 → mutating は refuse、read-only は警告で継続）。
2. **allowlist**: `TASTILE_STACK_ALLOW=id1,id2` が設定されている場合、
   対象 id を含まなければ refuse。
3. **identity**: resolved config の `container_name` を持つ container が
   期待 project / working_dir に属すること。逆方向（同 project label で
   別 dir の container）も検査する。config が解決できない場合は
   `<prefix>-(db|api|worker|web|caddy|cloudflared)` の fallback 一致。
   これが 2026-11-25 インシデントの再発検知に相当する。
4. **ports**（`up` のみ）: registry の期待 host port を、他 project の
   container が publish していないこと。
5. **volumes**（mutating）: compose が宣言する volume を、他 project の
   container が mount していないこと。
6. **images**（`up` のみ）: `images` 列の期待 ref（`repo` または
   `repo:tag` 完全一致）が resolved config に存在し、`tastile-*` image が
   local に存在すること（`--build` / `build` / `pull` 時は build/pull 前提で許容）。

refuse 時は原因を stderr に列挙する。`--force`（**stack id と cmd の前**に
置く leading option）は preflight を override するが、必ず
`.tmp/stack/ops.jsonl` に記録される。破壊的操作の prod 系ゲートは
`--force` では回避できない。

## 使い方

```bash
cd <workspace>/tastile-root
./scripts/stack.sh list                 # registry 一覧
./scripts/stack.sh acc doctor           # up 相当の preflight のみ実行
./scripts/stack.sh acc ps               # 稼働確認
./scripts/stack.sh acc logs --tail=50 api worker
./scripts/stack.sh acc exec api psql "$TASTILE_DATABASE_URL" -c '\dt'
./scripts/stack.sh acc up -d            # 事前に doctor が PASS であること
./scripts/stack.sh acc down             # volume は保持
./scripts/stack.sh acc down -v          # volume 削除。証跡確定後のみ
```

- env file は registry の `env_file` 列（gitignore 済み `.tmp/` 配下）から
  自動注入される。`prod` のように registry が `-` の stack は
  `TASTILE_STACK_ENV_FILE=<rendered.env>` で Infisical 由来の env を追加指定する。
- 全操作は `.tmp/stack/ops.jsonl`（gitignore）に JSONL で記録される。

## 既知の drift: verify-145 の project label

`tastile-verify-145-*` container は bring-up 時に `-p` を付けず、project label
が dir 既定値 `verify-stack` のままである。registry はこの実態を pin している
（project 列 = `verify-stack`）。verify-145 は保護対象のため再作成しない。
**`deploy/verify-stack` ディレクトリで bare `docker compose` を実行すると
project `verify-stack` を対象に verify-145 の container を掴む** — 必ず
`stack.sh verify-145 ...` を使うこと。canonical な一意 project 名への改名は
container 再作成を伴うため別 Issue で扱う。

## 直接 `docker compose` が必要な場合の例外

harness（`acceptance/harness`）の A-AT15 backup/restore のように、registry 外の
一時 project（`acc-restore-*` 等）を作る検証専用の使い捨て stack は registry の
対象外とする。その場合も以下を守る:

- project 名に run / baseline 識別子を含める（`acc-restore-<run>` 等）
- `down -v` で畳むまで volume・port を専用にする
- 証跡に project 名と prefix を記録する

## 関連

- `deploy/verify-stack/README.md` — verify stack の構成と並行 instance
- `deploy/prod-stack/README.md` — prod-equivalent stack
- `acceptance/README.md` — harness の ops 注入と env file
- `docs/runbooks/disk-resource-management.md` — VHDX compact の safe window
