# Trusted baseline archive の準備証跡

Root #50 / Core #204、世代5。dispatcher は Core の build recipe が `rollback_baseline: pull-base` を宣言した場合、GitHub PR metadata の base SHA を固定し、同じ Core repository の archive を取得する。private source bucket の object generation と SHA256 を固定し、PR build に GitHub / Infisical credential を渡さない。

## 観測した検証

- dispatcher と HTTP adapter の Bun tests: 35 pass / 0 fail、94 assertions（dispatcher・HTTP・recipe helper）、exit0。
- Bun bundle と Mac agent environment、architecture validator: exit0。architecture には既存の cost upper-bound advisory1件が残る。
- 実 GCS: `storage-proof.json` の release9b3f8b5 archive を create-only upload。同一 bytes の再送は同一 generation、異なる bytes は digest mismatch で拒否された。
- storage proof は Mac の human gcloud auth による。短命 access token は process memory だけで使用し、証跡には保存していない。更新後 dispatcher の GCP-native auth を証明したものではない。

## Runtime 観測と残りの検証

更新 image は Cloud Build 80a4fc35 で作成し、dev Cloud Run revision `tastile-ci-dispatcher-00002-6xt` に適用した。Scheduler の HTTP200、Core PR metadata 取得、自動 build `522a1288-0d7b-47e4-988c-31b3968ccac6` 投入を観測した。新 build の baseline download は固定 generation の取得と SHA-256 照合に成功。非秘密 receipt は `runtime-proof.json` に保存。

2026-10-08 の追跡では、旧4333400のcohortは全件成功したが中央値26.3427分で基準失敗。新 recipe の build522a1288はTIMEOUTし、hosted full / rollback成功・新10回中央値は未検証。runtime-proof.jsonのWORKINGは10月7日の投入直後の観測。最新の最終状態は[失敗証跡](../2026-10-08-ci-duration.md)に保存。旧cohortを新recipeの証跡に流用しない。native heavy gate は新しい Cloud Build rollback が成功するまで保持する。Core archive mode は Mac の Linux/PG17 で旧 API・worker readiness と認証付き SourceTile write/readback が成功し、終了後の rollback fixture DB は0件だった。amd64 Cloud Build はTIMEOUTし、rollback smokeへ到達しなかった。

`manifest.json` は source と実 storage receipt の bytes を結び付ける。m2、#204、#202、production 移行の完了を示すものではない。
