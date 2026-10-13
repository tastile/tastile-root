# Cloud Build candidate 再compileのtimeout

exact Core f98c58ef / build be499da4-b695-4980-a03d-5714bec22460 / source generation1791439090204510はTIMEOUT。trusted archive取得、PG17、PowerShellは成功し、full106groups942/0/0は完了した。clippy458秒、migrate-run284秒、fulltest804秒（compile548秒）後、rollbackは候補api/cli/storage/AWSを再compileして終了した。baseline build/startup/smokeは未到達。terminal cache statsがないためhosted cache効果は未確定。新cold10回は投入していない。[terminal metadata](2026-10-08-ci-candidate-recompile.json)。

現recipeのnarrow cli dev executable、full test profile、rollback candidate API dev executableの別compileが観測された。CLI/storageまで再compileする完全なfingerprint原因はverbose dataがないため断定しない。次のsource準備では、必須fulltestのno-runから生成される通常api/migrator binaryをsourceSHA/package/target/profile/digestで検証し、SQL test前に実migrationを行って同一buildのrollbackで再利用する。baseline source/target/binaryは独立のまま。missing/duplicate/harness/path escape/source/digest mismatchはfail closed。全test/rollback/jobs2/2CPU/1800秒を保持する。dev/test byte同一性や新hosted成功は未主張。

Cargoはintegration test選択時に通常binを自動buildし、--no-runはcompileのみと定義している。[Cargo primary documentation](https://doc.rust-lang.org/cargo/commands/cargo-test.html)。Core api/cliはintegration testsを持ち、schemaに依存するbuild.rs/SQLx compile-time macrosは観測されていない。新recipeの実PG/full/rollbackと固定sourceのhosted成功・10中央値は別に必要。
