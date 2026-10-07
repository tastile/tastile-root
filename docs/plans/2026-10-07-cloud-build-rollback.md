# Cloud Build rollback gate の移行

Issue: Root #50 / Core #204。世代5。Root branch50、Core branch204。

## 確定した設計

引き継ぎの「trusted baseline archive」を実装する。dispatcher が GitHub の PR metadata の base SHA を固定し、同じ Core repository の archive を取得する。PR source が baseline SHA、GCS destination、service account を選ぶことは許可しない。

Core build config は `rollback_baseline: pull-base` を宣言する。未宣言の既存 recipe は変更しない。宣言された場合は dispatcher が baseline archive を private source bucket の `baselines/<SHA>.tar.gz` へ保存し、GCS generation と SHA256 を記録する。upload は create-only とし、既存 object は固定 generation で bytes と digest を照合する。保存済み bytes が同じ commit の再取得 archive と異なる場合は fail closed とする。

dispatcher が先頭に trusted baseline download step を挿入し、`rust-quality` step へ `BASE_SHA`、`BASE_ARCHIVE_PATH`、`BASE_ARCHIVE_SHA256` を注入する。PR 由来の同名 env や reserved step ID は拒否する。archive は `.tmp/rollback-baseline.tar.gz`。短命な CI SA の source read だけを使い、GitHub / Infisical credential を build へ渡さない。

Core rollback runner は archive mode で checksum と単一 top-level directory / crates-v1 contents を確認して展開する。host-local mode の既存 git archive は維持する。baseline Cargo target を candidate と分離し、candidate migrator、旧 API/worker readiness、認証付き SourceTile write/readback、fixture cleanup を実行する。Cloud Build の PostgreSQL hostname は専用 container 名を追加許可し、外部 DB を許可しない。

Cloud Build に rollback が統合され、exact candidate の全 gate 成功を確認した後に、GitHub Actions の重複 heavy Rust/rollback を取り除く。軽量 contract / infrastructure checks は維持する。新 recipe は新 cohort で10回測定し、旧4333400 cohort と混在させない。timeout1800s / 2CPU / jobs2を維持する。

## 検証

- baseline SHA 不正 / 欠落、reserved env、unknown contract、unsafe archive、digest mismatch、GCS create conflict/recovery の拒否。
- 正常な archive mode の実 PostgreSQL rollback と全 Rust gate。
- dispatcher の既存 recovery/fencing/HTTP tests と新 contract tests。
- native paid heavy 削除前に exact source Cloud Build と自動 GitHub status を確認する。
- source/digest、external mutation journal、独立 read-only review、10回計測結果を保存する。

## 残存条件

本 slice は m2 CI を完成させるための変更であり、#202 D/E、staging、production license、Windows smoke、14日 soak を達成した証跡ではない。
