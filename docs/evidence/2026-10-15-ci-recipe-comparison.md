# Cloud Build 成功と #204 の計測対象の差

2026-10-15、固定 source と取得済み実行 log を read-only で比較した。
検査 agent: `/root/g10_dispatcher_plan`、fence:
`generation15-ci-recipe-comparison-1`、`actual_model=null`。
追加の build、compile、cloud mutation は実行していない。

| 対象 | Core #202 の既存 recipe | Core #204 の未統合 proposal |
| --- | --- | --- |
| commit | `1ccca27ad94106093aeb35b72aa068b7a7286dfb` | `6429407a09c671def29fee5c63783901adb8b256` |
| `cloudbuild/ci.yaml` SHA-256 | `2d3924444cd8c64b2042258f900848f7a94003566c74087b3085db8136edd3ce` | `1e2921e3f7b2661cf7dca51a849b3663054236bdde661fb72aba4eb976440539` |
| Cloud Build | `fbfb7c19-bbfa-4fb2-949d-c1a4665fc35a` SUCCESS | `6b9591df-7f6d-4843-859a-a98fc95ca91c` TIMEOUT |
| 実行内容 | clippy → v0 build → 通常の migrate_run → workspace tests | clippy → candidate no-run precompile → artifact seal / migrator → tests → 独立 baseline rollback |
| 観測 | 111 groups / 979 pass / 0 fail / 0 ignored。CI_DURATION 1388秒、build wall 24分42秒 | clippy494秒、precompile700秒、sealed migration1秒、tests275秒。rollback開始1479秒、全体1800秒内で完了せず |
| raw log SHA-256 | `690ad02279340d19fcf42a5aeb79bb90d4b4c255dd198ad4db501567048cb24b` | `e9f8efb38425e7096a3541189ccb09a5b8d7a78881ceb74ceb926001b0da1aae` |

jobs=2、Rust/profile flags、Cargo manifest / lock は比較対象で同じ。
既存 #202 Cloud Build recipe には、#204 proposal の isolated target、compiler-cache / artifact
contract、明示 no-run、sealed normal api / migrator、archive-pinned rollback phase が含まれない。
別 branch の未統合 proposal との差であり、#202 の変更がこれらの gate を削除したことを意味しない。

1ccc の log は通常 migrate_run の build / 実行を示すが、Cargo JSON artifact manifest はなく、
normal API / worker binary の reuse を立証しない。1ccc の GitHub Actions quality job は
別途 rollback compatibility step を持つ。Cloud Build 自体の所要時間へその検証時間を含めてはいない。
1ccc のローカル実PG17による独立 baseline rollback は、Core 側の別証跡で管理する。

したがって、この SUCCESS を #204 の recipe が1800秒内で完了した証明、cold10 の一回、
又は wrapper / source 変更による高速化の証明には使わない。各 invocation の freshness / cache key、
normal api / worker / migrator artifact の対応を含む同条件の比較は未実施。

次に検証すべき問いは、必須の archive-pinned rollback を保ったまま、phase timing と各 normal
binary の Cargo artifact identity を通して1800秒内で完了できるか。#204 TIMEOUT と既存 cold10
基準未達の記録を維持し、gate・hardware・timeout を緩める根拠にはしない。

## 既存 cache experiment の compiler input から生じた問い

同日の追加 read-only 検査は、既存の candidate `6429407` test `--no-run` と baseline
`9b3f8b5` ordinary API / worker build の記録だけを使った。新たな compile / Cloud Build は
実行していない。検査 fence は `generation15-ci-input-graph-1`。

`either` の candidate feature に `use_std` があり、baseline にはない。観測された
`--extern` の identity 差は `bytes-utils` → `aws-smithy-types` → `aws-config`、及び
`crossbeam-utils` → `crossbeam-queue` → `sqlx-core` → `sqlx` に伝播している。
`sqlx` / `aws-config` 自体の feature / profile は記録上同じである。個別入力と raw artifact の
全 SHA-256 は [固定した検査結果](2026-10-15-ci-input-graph.json) に記載する。

一つの具体案「baseline の package selection を `cargo build --workspace` に合わせる」
からは、dev target が要求する feature closure も揃うのか、という問いが生じた。
[Cargo の resolver 説明](https://doc.rust-lang.org/cargo/reference/features.html#feature-resolver-version-2)
では dev dependency の feature は、それを必要とする test / example target を build するときに
有効になる。workspace package selection の変更だけを、この差を解消する根拠にはできない。

次の成果物は、普通の API / worker artifact と独立した trusted baseline を維持しつつ、
どの既存 target がこの feature closure を要求するかを示す dependency graph とする。
現時点では全 resolve graph、91件の aggregate cache miss の crate ごとの原因、又は
この差を解消した場合の所要時間は立証していない。キャッシュ入力の説明と時間基準の達成を区別する。
