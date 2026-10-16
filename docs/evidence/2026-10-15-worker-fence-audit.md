# 全 driver 共通 drain に向けた ownership の調査

2026-10-15、Core `1ccca27ad94106093aeb35b72aa068b7a7286dfb` を
`git show` で固定して read-only 検査した。Root は
`864d0aff137a8308c5cd238acb0263dcb11da2d2`。対象は Core #202 の
確定済み `docs/plans/2026-10-07-worker-drain.md` に含まれる storage の
claim / completion / retry と、既存 worker caller。検査 agent は
`/root/g10_dispatcher_plan`、fence は `generation14-global-fence-audit-1`、
`actual_model=null`。この調査では compile、DB 実行、provider / cloud 変更を行っていない。

## 調査で生じた問い

各 driver を単一 deadline に接続する際、`Ok(())` を一律に completed と数えてよいか。
また、期限切れの旧処理が失敗したとき、その retry が新 claimant の lease を解除しないか。

## 固定 source で確認した事実

| 対象 | ownership / outcome の事実 | 共通 report への制約 |
| --- | --- | --- |
| `source_lifecycle_repo::execute_claimed_source_work` (451–563 行) | entry は id / worker / live lease / source active を検査する。entry 不成立の経路 (473–483 行) は id / worker だけの DELETE の後に `Ok(())` を返す。main と未接続の `source_tick.rs` は Ok を completed とログする。 | stale / not-owned と成功を分ける必要がある。既存 Ok 全件を completed にできない。 |
| source failure (572–602 行) | retry は id / worker に限定するが、claim 世代や lease の一致を検査しない。 | 同一 worker id で再取得した lease と旧処理を区別する根拠が必要。 |
| `execution_flow_work_repo::retry` (306–309 行) | work item id だけで worker / lease / failure state を更新する。main は execute Err のたびに呼ぶ。 | 旧エラー処理が新 claimant の lease を解除し得る。共通 adapter から無条件 retry を追加できない。 |
| `execution_runtime_repo::execute_due_work` (257–324 行) | Complete は fenced completion、Rescheduled も Ok。Err は id だけで更新する `mark_failed` に進む。 | completed / rescheduled を分ける必要がある。failure transition も新 claimant を fence する必要がある。 |
| relation dependency (172–275 行) | entry / final UPDATE は id / worker / state / lease を検査し、更新一件以外は Err。 | 現行 Ok は完了。失敗は処理中 lease の期限切れから回復する。 |
| source decision publish (211–263 行) | id / occurrence / worker / unpublished / lease の UPDATE。true は published、false は stale。 | false を成功にしない。既存 caller は false で終了する。 |
| relation decision publish / retry (992–1062 行) | publish / retry とも claim identity / worker / unpublished / lease を検査し bool を返す。 | bool の意味を保持する。caller は publish false の場合だけ既存 retry を行う。 |
| decision evaluation (439–628 行、completion は 92–123 行) | completion は id / worker / lease を検査して consumed を更新する。 | エラー時の既存 lease recovery を保持する。追加の generic retry を発明しない。 |

primary main は行ごとに現在 UTC を取得して claim / execute する。未接続の
`source_tick.rs` は渡された固定 UTC で claim する別実装である。共通 pass への抽出で
二重の実装を残すと、cadence / clock / retry / report が分岐する。

## 次の実装で必要な検証

旧 claim を保った expiry → 新 claim の後に、旧 completion / retry / failure を実行し、
新しい worker / lease / attempt / state が変化しないことを実 PostgreSQL で観測する。
同一 worker id を再利用する場合も区別できること、stale を completed にしないこと、
item / global timeout で既知の report が失われず、期限後に新 query を開始しないことを
共通 pass の acceptance に含める。

これらは修正前の source に対する findings であり、修正済み・全 driver drain 完成の
証跡ではない。現在別スライスで変更中の delivery 8 ファイルは、この audit の対象外。
