# Core staging 接続の部分証拠

Core f0c1ffc の image 8a2b466f は実 OCI の3binaryを抽出・hash照合し、独立 baseline 9b3f8b5 の API/worker に対する rollback compatibility を実PGで証明した。Cloud Build32a11cf1は565.161秒で成功、owned DB残0。staging migrator jmgx2 完了後に API と worker を配備した。

R2 は Infisical staging の API path だけに credential を保持する。bucket object PUT/GET/DELETE、public CDN の同一内容200、所有probe削除、指定originのpreflight204/別origin403を観測した。これはAPI avatar journeyの成功ではない。

実利用の未成立条件: 新規 USER profile GET404（Core修正中）、worker Flow timeout/unknown（Scheduler停止）。worker一時診断Jobは削除・不存在確認。Web・Android利用可能とは判定しない。

公開domainの設定はoperator承認済み。r2.devは無効。minimum TLSはCloudflare UI既定1.0の表示が残り、1.2へ変更したとは主張しない。
