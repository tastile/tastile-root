# Cloud Build cold 計測の失敗証跡

Root #50 / Core #204、実行世代6。source と recipe が異なる2件の観測を分ける。

旧 source `4333400a0b64a623d6d2d289706e9249db98fbcb` の10回 cold cohort は、全 build SUCCESS、各106 groups / 942 pass / 0 fail / 0 ignored。中央値1580.56秒（26.3427分）は1500秒を超え、40回/月換算1053.71分も1000分を超える。時間条件は失敗。exact archive generation・recipe digest・各 build ID・件数は `2026-10-08-ci-duration.json`。

新 source `963383772cccf83e9dabc8e764600fa2425ca6f7` の自動 build `522a1288-0d7b-47e4-988c-31b3968ccac6` は TIMEOUT。trusted baseline の固定 GCS generation 取得・SHA-256照合は成功したが、1800秒以内に full / rollback recipe が完了しなかった。timeout 終盤は baseline の独立 target で Rust dependency compilation 中。provider の最終状態は `2026-10-08-ci-rollback-timeout.json`。

native heavy checks は保持する。cold source、既定2CPU、jobs2、必須gateを維持してコンパイル重複を調査する。旧 cohort を新 rollback recipe の成功証跡には使わない。m2 / #204 / migration 全体は未完了。
