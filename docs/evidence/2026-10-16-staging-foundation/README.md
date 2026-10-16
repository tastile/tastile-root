# Core staging の基盤と未成立条件

2026-10-16、tastile-staging/asia-northeast1 に Cloud SQL POSTGRES17のtastile-staging-pgと空のtastile_core/tastile_authを作成した。SQL connector必須、authorized networksなし、削除保護/PITR/backupを維持する。停止NEVER/STOPPEDと再開ALWAYS/RUNNABLEを実操作で確認した。

Infisical stagingにAPI/worker/migrator別のGCP-native identityとread-only service role、DB credential/delivery key正本とreferenceを配置した。値はInfisicalとRAMのみ。identity metadataは実workload認証成立の証拠ではない。

実SQL connector経由でapp roleのDML/read/delete成功、DDLとauth DB接続の拒否、migratorのschema所有/DDLを確認した。roleはいずれもsuperuser/createDB/createRole/replication/bypassRLSを持たず、接続上限13/2。専用probe tableは0に戻した。operatorのSET権限はtransaction内だけ有効化し、最後にSET FALSEへ戻した。

Macの最初の接続試行にはschema-owner/default-privilegeの42501と一時的なupstream3307 timeoutがあり、成功扱いしていない。再開後のfresh connectorで最終role-proof exit0を観測した。

この段階でapp schema/migration、Cloud Run API/worker、Scheduler、R2/provider、restore、Web/client利用は未成立。Root runtime IaCはdigest/bootstrap/IAM/SQL mountを固定し、実migration前にrelease rollbackを要求する。Core9b097f4のLinux/実PG全1011テストとdebug rollbackも、実staging利用や実OCI releasebinary proofの代用にはしない。
