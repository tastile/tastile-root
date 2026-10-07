# Trusted baseline archive の準備証跡

Root #50 / Core #204、世代5。dispatcher は Core の build recipe が `rollback_baseline: pull-base` を宣言した場合、GitHub PR metadata の base SHA を固定し、同じ Core repository の archive を取得する。private source bucket の object generation と SHA256 を固定し、PR build に GitHub / Infisical credential を渡さない。

## 観測した検証

- dispatcher と HTTP adapter の Bun tests: 35 pass / 0 fail、94 assertions（dispatcher・HTTP・recipe helper）、exit0。
- Bun bundle と Mac agent environment、architecture validator: exit0。architecture には既存の cost upper-bound advisory1件が残る。
- 実 GCS: `storage-proof.json` の release9b3f8b5 archive を create-only upload。同一 bytes の再送は同一 generation、異なる bytes は digest mismatch で拒否された。
- storage proof は Mac の human gcloud auth による。短命 access token は process memory だけで使用し、証跡には保存していない。更新後 dispatcher の GCP-native auth を証明したものではない。

## 未検証

更新 image の Cloud Run execution、Core archive mode の実 PostgreSQL rollback、new recipe の Cloud Build 成功・10回中央値は未検証。旧4333400のcohortは実行中で、新 recipe の証跡に流用しない。native heavy gate は新しい Cloud Build rollback が成功するまで保持する。Core archive mode は Mac の Linux/PG17 で旧 API・worker readiness と認証付き SourceTile write/readback が成功し、終了後の rollback fixture DB は0件だった。amd64 Cloud Build は未実行。

`manifest.json` は source と実 storage receipt の bytes を結び付ける。m2、#204、#202、production 移行の完了を示すものではない。
