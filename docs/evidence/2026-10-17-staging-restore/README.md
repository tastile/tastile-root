# staging PITR 復元検証

Generation21 の実行を generation22 で再照合。source は tastile-staging-pg、専用復元先 root50-g21-restore-20261017。選択時点 2026-10-16T16:18:17.082Z、clone intent 16:21:01.087Z。連続する API write/cancel を維持し、173 table の整列済み行 digest を復元先で比較した。

実際の execution ddlsl は succeeded=1、行一致、復元 API readiness 200。RPO 2.851分、completion を用いる保守的 RTO 56.554分。検査 image は以前に rollback 証明済みの 9b097f4 artifact であり、新 f0c1ffc image の機能証明には流用しない。

初回集計時に readiness log が未反映だったため collector は失敗した。再実行せず、同一 execution の実ログを取得し直して照合した。元の失敗記録を残している。owned Job と clone の削除後不存在を確認済み。source の削除保護は変更していない。

本証拠は復元の条件だけを成立させる。worker の Flow timeout、新規 profile/avatar、Web・端末の利用可能状態は別途未成立。秘密値、DSN、行データ本体は含めない。

## 合格条件の補完 (generation 24、review 指摘への対応)

仮説と method が要求する「restore 後に Core が ready」を独立 criterion `c4: restored_api_ready == true` として `architecture/model/pocs.yaml` に追加した (observed は `proof.json` の `restored_api_ready: true`)。`scripts/architecture/validate.ts` の `checkPocs` は `status: passed` に全 criterion の `result: pass` を要求するため、c4 を未実行 (`result` 無し) にした場合と `result: fail` にした場合の両方で `poc.restore-drill: passed requires every criterion to be executed and pass` により validate が失敗することを確認した (一時変更は元に戻し、本来の値で validate PASS)。
