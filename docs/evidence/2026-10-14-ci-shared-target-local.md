# Core の品質 / 候補 compilation を同一 target で検証

lint と candidate test no-run が別 target を使うことによる重複依存出力を減らすため、同じ build 内で最初に空の品質 target を共有する候補を検証した。全 gate、clippy-first、2CPU/jobs2/1800秒の hosted設定、sealed pair の source/package/profile/digest、SQL前migrator、baseline独立targetは維持する。

新空target/cacheの実LinuxARM4CPU / Rust1.97.1 / PG17.11でfull106groups942pass0fail0ignored、実sealed migrator、別targetのbaseline API/workerによるSourceTile write/read/reflow、fixture DB残数0が成功した。terminalの実cache313Rusthit851miss0errorを確認。詳細な[公開metadata](2026-10-14-ci-shared-target-local.json)にはsourcebase・recipe file digest・phase・private raw output digestを残し、Coreのraw本文はprivate repositoryに保存する。

小さいC/D fixtureはClippy専用metadataの再検査が残ることを示した。通常binの保持とpartial reuseを、全dependency再利用へ拡大していない。local wall422秒は4CPU ARM環境の観測であり、hosted2CPU性能を示さない。新exactSHAのhosted SUCCESS、その後の別cold10cohortの中央値は未観測。Core3d7の8499TIMEOUTと旧433cohortFAILを維持し、#204/m2を完了にしない。
