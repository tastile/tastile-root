# 共有 target 適用後の hosted TIMEOUT

Core6429407 / build6b9591df は、immutable source generation1791971291168666 で1800秒TIMEOUTとなった。clippy494秒、candidate-precompile700秒、seal・実migrator各1秒、PG17 full106groups942/0/0のtests275秒まで完了し、独立baseline compile中に期限を超えた。旧API/worker smoke、terminal cache stats、新cold10は未到達。[観測metadata](2026-10-15-ci-shared-target-timeout.json)。

localの全gate/rollback成功は保持するが、hosted成功として扱わない。旧cold10基準失敗も維持する。追加replicaやtimeout/hardware増加、必須gate削除は行わず、candidate workspaceと独立baselineのdependency feature/profileの差が再compileを生むかを次に調べる。Cargo.lockが同じことだけでは、compiler inputとcache hitの一致を保証しない。
