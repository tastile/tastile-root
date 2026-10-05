# Core recovery source snapshot の Cloud Build 検証

2026-10-05、root Issue50 / Core Issue202 slice A のCI機構検証。Coreのlocal runtime証跡は [Core PR210](https://github.com/tastile/tastile-core/pull/210) と同PRの `docs/evidence/2026-10-05-recovery/` を参照する。

## 観測済み

- build [4c5c4206-152d-4a12-ae30-8e32ab70b0f6](https://console.cloud.google.com/cloud-build/builds;region=asia-northeast1/4c5c4206-152d-4a12-ae30-8e32ab70b0f6?project=561004747976): **SUCCESS**。
- 2026-10-05T11:02:15.445845029Z〜2026-10-05T11:29:26.060832Z、build全体 1630.62s。
- CI pin Rust1.97.1 / PostgreSQL17。PowerShell contract、version sync/CI impact contract、v1/v0 fmt、workspace all-targets clippy、v0 build、real DB full testを実行。
- full test: **103 result groups / 937 passed / 0 failed / 0 ignored**。
- 通常のrust-quality gateは **1347s / 22.45min**。その後、workerを同じsourceから `cargo build -p worker --profile test` でビルドし、実プロセスを2回起動。各7sのTERM harness deadlineでexit124を確認し、kind0 **1→1→1**、future captured SPANの新Active ownerへのprompt **0→0→0**。
- Cloud worker binary SHA256: `73bd573f2876ca2c33f31c2664ef5f1cec466945c89254e9982bf6460eb080b1`。local toolchain/binaryとは区別する。
- source: `gs://tastile-dev-tastile-ci-source/manual/core202/1791198119.400938-81cffd762bc54a088694e51c5c47b281.tgz`、generation `1791198133827896`。
- sa-cloud-build-ci、Cloud Logging only、アプリ/GitHub/Infisicalのsecretアクセスなし。PostgreSQL接続値はbuild内専用のdisposable fixture。
- 取得raw Cloud Logging log `.tmp/core202-cloud-build.log` のSHA256: `f2d5fdda7d67d7d7c88a647576007c9780faf68bc3e79e3b90611b2685c8972d`。ログは上記build IDからCloud Loggingで再取得できる。

## source binding と制限

Git base `8702b85399c195d93edbc63311ba82d5d65bffa0` のarchiveへ、変更5 source filesだけを適用した未コミットsnapshotを送った。変更source digestは `d3941bf227af048c66c28676375f253446d48bd8208e171d71ae20f864c5af41`（掲載順/property順の `JSON.stringify(manifest)` をUTF-8、空白/末尾改行なしでSHA256）。各file SHA256をCloud内で出力し、candidate `f8e1bdf4e5d1960758c13da79c047f1e6980e3ec` の5 source filesと一致した。追加README/HARNESS/raw evidenceは実行source差分ではない。

- `crates-v1/domain/src/prompt.rs`: `6ddbb27aae59b87963f65c9ab93316a8ad8b2806971f2700b348ad4b1f8f8c33`
- `crates-v1/storage/src/prompt_repo.rs`: `a50b9a82237c36e0a3132cbe66f6e03a078fd8da5643827a1c2cc4f25991c802`
- `crates-v1/storage/tests/at_prompt_inbox.rs`: `5add63f47fc65904918ac699b2ac11b9c6c477a1976ecaa4a25cdd6a315a648e`
- `crates-v1/worker/src/main.rs`: `19de8787cddf9ebab72255cc2b665b9f3f86cc8c51344036ce46f148d97d3f3a`
- `crates-v1/worker/src/prompt_tick.rs`: `8187484aa22d098e18c68569d17748300f2677f21d5774ddd77208759d42072b`

これはnative GitHub commit CIのstatusではない。GitHub statusの偽装/手動successは行っていない。最初のnative run37302510423は通常test937成功後にrollback buildのartifact混在で失敗した。baseline専用target修正後、[native run37306349102](https://github.com/tastile/tastile-core/actions/runs/37306349102) はexact90af6dc17689520509840e98bb40707367ceec69に対して全job成功、103groups937pass0fail0ignoredとcandidate migration後の旧API/worker SourceTile smokeを実行した。quality18m1s。Core PR210はeeae9887722e1a9b4235461e16855d235e50888dで統合済み。

22.45minはCloud Buildでの1回のfresh測定で、10-run medianおよび8vCPU cold-suite performance criterionを満たしたと主張しない。poc.cloud-build-ciのworkload認証/自動status報告、Core Issue202全体、staging PoCは未完了。
