# Runtime 移行前の責務と設定名の整理

2026-10-15、承認済み Core E plan と固定 source を read-only で照合した。
対象は Core `bba0cd7d50e8ecdf4ff3bd92a35d6d36b58a25f2`、Root
`864d0aff137a8308c5cd238acb0263dcb11da2d2`。調査 agent は
`/root/g10_core_binding`、fence は `generation15-e-responsibility-audit-1`、
`actual_model=null`。この文書は日時付きの調査結果であり、仕組みの正本は
`architecture/model/`、Core の runtime schema は Core が所有する。

## 責務を先に分ける

| 責務 | 所有者と命名の境界 | 具体的な扱い |
| --- | --- | --- |
| Infisical 自体の運営・ライセンス・人間の管理認証 | 複数 project で使う共通 secret control plane | 上流の `LICENSE_KEY` 等を Tastile 専用名へ置換しない。人間の管理 profile / SSH はアプリ runtime の設定に混ぜない。 |
| workload が secret を取得するための接続先・identity・project・環境・path | Root の deployment/security adapter | 既存 dispatcher の `INFISICAL_DOMAIN`、`INFISICAL_MACHINE_IDENTITY_ID`、`INFISICAL_PROJECT_ID`、`INFISICAL_ENVIRONMENT`、`INFISICAL_SECRET_PATH` は共通の非秘密 selector。Tastile を表すのはその選択値と ACL であり、Infisical の責務自体ではない。 |
| DB 接続・worker の予算・avatar の有効化など、アプリの動作 | Core の runtime schema と validation | 既存の `TASTILE_DATABASE_URL`、`TASTILE_WORKER__DEADLINE_MS`、`TASTILE_FEATURE_AVATAR_ENABLED` など。Core は渡された必須設定を検証し、Infisical の login/project 選択を解釈しない。 |
| 実行 platform の listener port | Cloud Run が供給し、Core transport が消費 | `PORT` を別の製品固有 secret 名にしない。local の port 方針と deployed mode の必須値を明示的に分ける。 |
| R2 に対する object 操作 | Core の `AvatarStorage` port と provider adapter。Root は環境別の権限を付与 | bucket/endpoint/credential の必須 field を Core で確定してから名前を付ける。Infisical selector と混ぜず、AWS default credential chain への fallback を作らない。 |
| HTTP drain とその呼び出し認可 | Core は HTTP の入力・結果、Root は Scheduler/OIDC/IAM/ingress | Core domain は GCP token を解釈しない。実 platform による認証・認可の検証を、CLI 成功で代用しない。 |

非秘密の selector は Cloud Run の deployment config に置ける。認証後に取得する secret
実値と session token は RAM だけで扱い、Infisical 以外に編集可能な store を増やさない。
未確定の R2 field 名や新しい共通 platform repository は、この調査では追加していない。

## 固定 source で残っている差

- Core API `main.rs:446-463` は avatar disabled の場合も AWS default config / client を
  初期化する。disabled implementation は provider を初期化せず、操作を要求されたら
  feature unavailable として拒否する必要がある。
- 同 `main.rs:1016-1029` は `TASTILE_API_PORT` / default `31400` を使い、Cloud Run の
  `PORT` を消費していない。
- Root `deployment.yaml:163-171` の staging sweep は5分・idle時停止の記載で、E plan の
  activeな1分 sweep による検証と一致していない。実装前に model を合わせる。
- staging worker への same-project `sa-scheduler`、path/query を除いた canonical service
  URL audience、service単位の `roles/run.invoker`、internal ingress、public principal拒否、
  Scheduler service-agent権限の保持を結ぶ model の記述が不足している。
- 固定 bba の worker は loop entrypoint で、E の provider-neutral `POST /drain` transport は
  未実装。D の mutable worktree はこの調査の判定対象にしていない。

元の調査 JSON は `.tmp/g15-e-responsibility-audit.json`、SHA-256
`f8aac70616e128a15c3eb0ea7ad45ecca6c1d75770ebec976df96a80a1cf69c5`。
元 JSON の「valuesをCloud Run metadataへ置かない」という広い表現は、非秘密 selector を
禁止する意味ではない。上の区分は同じ独立 inspector による追補を反映している。
compile / DB / cloud / secret の操作や、E の実装・staging 達成の検証は行っていない。
