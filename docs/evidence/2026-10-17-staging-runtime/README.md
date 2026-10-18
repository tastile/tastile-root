# Core staging 接続の部分証拠

Core f0c1ffc の image 8a2b466f は実 OCI の3binaryを抽出・hash照合し、独立 baseline 9b3f8b5 の API/worker に対する rollback compatibility を実PGで証明した。Cloud Build32a11cf1は565.161秒で成功、owned DB残0。staging migrator jmgx2 完了後に API と worker を配備した。

R2 は Infisical staging の API path だけに credential を保持する。bucket object PUT/GET/DELETE、public CDN の同一内容200、所有probe削除、指定originのpreflight204/別origin403を観測した。これはAPI avatar journeyの成功ではない。

実利用の未成立条件: 新規 USER profile GET404（Core修正中）、worker Flow timeout/unknown（Scheduler停止）。worker一時診断Jobは削除・不存在確認。Web・Android利用可能とは判定しない。

公開domainの設定はoperator承認済み。r2.devは無効。minimum TLSはCloudflare UI既定1.0の表示が残り、1.2へ変更したとは主張しない。

追加の通常設定診断 root50-g22-worker-sampled-probe-8dd47 は Flow393件・1owner完了、timeout1/unknown1で未成立。DB待機観測器は統計snapshotを保持して空結果になり、後発のfresh観測も実行終了後だったため性能証拠として採用しない。実行reportと一時Job不存在だけを採用する。

generation 23 (Claude, 2026-10-18): Core `a06cf06` image `core@sha256:2ea0368…` (exact OCI rollback proof `6effbc1f` SUCCESS) を migrator `core-migrate-9ckmg` (pending0) → `core-api-00006-mn8`/`core-worker-00002-8jr` の順で配備。新規 bridge USER の profile GET は 200 (旧404解消)、avatar upload作成201・R2署名PUT200・commit200・CDN source hash一致・32/64/128 WebP variant・profile reset・所有R2 key5件の不存在を実確認 (`avatar-g23.json`、credential値は不記録)。worker Flow timeout は未成立のまま (Scheduler paused)。Web・Android利用可能とは判定しない。

generation 23 worker: `9a70bd6` (Flow replay 冪等化、Terra PASS、exact OCI rollback `6ec6a2cc` SUCCESS) を migrator `core-migrate-7nfqk` → `core-api-00007-k88`/`core-worker-00003-x8k` へ配備し、`ctl.staging-worker-replay-probe` の55秒drainを1回実行 (`worker-g23.json`)。execution_due64・outbox128・source4・prompt31は完了したが、Flowは owner2件中 timeout1/in_flight_unknown2/completed0 で**未成立**。一時Jobは所有UID照合後に削除・不存在確認、Schedulerはpaused維持。

原因調査 (local実PG、network無し、`flow-cost-local.txt`、1行目〜4行目が現行、5行目〜8行目が計測専用変更): 新規bridge ownerの初回Flow評価は [最古anchor, now+32日] に511件をemitし40.2秒 (replay 2.2秒、翌日分24件5.1秒)。per-item budget 29秒を単独で超える。`effective_busy_spans` はrange引数を受けながら owner の全open placement を毎materializeで実効span解決しており (O(N)/emit → 初回O(N²))、計測専用にbaseline範囲で絞ると同じ511件が17.1秒になった (約57%)。計測用変更は復元済みで source hash は `9a70bd6` と一致。partial progress は action ごとに commit されるため反復passで収束し得るが、Scheduler paused のため probe pass しか走らず、probe は新規 owner を追加する。修正方針は未決定。

generation 23c: busy span range 絞込み `3e735e6` (Terra PASS、full 1021/0/0、exact OCI rollback `f9103ae0` SUCCESS。初回 verifier は Cloud Logging 取込み遅延で marker 不在となり、build 不変のまま log 再取得後に通過) を migrator `core-migrate-29465` → `core-api-00008-kh2`/`core-worker-00004-lgl` へ配備し、`ctl.staging-worker-prefilter-probe` の55秒drainを1回実行 (`worker-g23c.json`)。Flow は timeout1/in_flight_unknown2/owners_completed0 で**未成立**のまま。local では初回40.2→16.3秒に短縮したが、staging (db-f1-micro) の 29 秒 item budget には収まらない。一時Jobは削除・不存在確認、Schedulerはpaused維持。

generation 23d 収束実測 (`ctl.staging-worker-convergence-window`): 現行 image (Core `3e735e6`、`core-worker-00004-lgl`) のまま常設 `core-worker-sweep` を OpenTofu で 05:11:45Z〜約05:27Z の15分だけ unpause し、同経路で paused へ戻して `PAUSED` を readback した。`/drain` の HTTP status は `failures=0`・unknown 無しの時だけ 200。12 pass 中、最初の1件 (05:12:01Z) のみ 200、以降11件は全て 503 で latency 55.0秒 (全体期限到達) (`worker-convergence-g23d.json`)。反復 pass でも Flow backlog は15分では収束しなかった。初回 200 は retry backoff 中で due owner が無かった可能性が高い (推測)。worker 成功とは判定しない。
