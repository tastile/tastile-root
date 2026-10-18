# Core staging 接続の部分証拠

Core f0c1ffc の image 8a2b466f は実 OCI の3binaryを抽出・hash照合し、独立 baseline 9b3f8b5 の API/worker に対する rollback compatibility を実PGで証明した。Cloud Build32a11cf1は565.161秒で成功、owned DB残0。staging migrator jmgx2 完了後に API と worker を配備した。

R2 は Infisical staging の API path だけに credential を保持する。bucket object PUT/GET/DELETE、public CDN の同一内容200、所有probe削除、指定originのpreflight204/別origin403を観測した。これはAPI avatar journeyの成功ではない。

実利用の未成立条件: 新規 USER profile GET404（Core修正中）、worker Flow timeout/unknown（Scheduler停止）。worker一時診断Jobは削除・不存在確認。Web・Android利用可能とは判定しない。

公開domainの設定はoperator承認済み。r2.devは無効。minimum TLSはCloudflare UI既定1.0の表示が残り、1.2へ変更したとは主張しない。

追加の通常設定診断 root50-g22-worker-sampled-probe-8dd47 は Flow393件・1owner完了、timeout1/unknown1で未成立。DB待機観測器は統計snapshotを保持して空結果になり、後発のfresh観測も実行終了後だったため性能証拠として採用しない。実行reportと一時Job不存在だけを採用する。

generation 23 (Claude, 2026-10-18): Core `a06cf06` image `core@sha256:2ea0368…` (exact OCI rollback proof `6effbc1f` SUCCESS) を migrator `core-migrate-9ckmg` (pending0) → `core-api-00006-mn8`/`core-worker-00002-8jr` の順で配備。新規 bridge USER の profile GET は 200 (旧404解消)、avatar upload作成201・R2署名PUT200・commit200・CDN source hash一致・32/64/128 WebP variant・profile reset・所有R2 key5件の不存在を実確認 (`avatar-g23.json`、credential値は不記録)。worker Flow timeout は未成立のまま (Scheduler paused)。Web・Android利用可能とは判定しない。
