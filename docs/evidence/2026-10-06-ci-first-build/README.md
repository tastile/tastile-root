# 最初の自動 Core PR build

- Root runtime image は PR82 の digest c18eb137…、dispatcher source は 3917990ca95f104690fe9baacd1d1c2629ad2dd7。認証・拒否・一時権限撤去は [前の証跡](../2026-10-06-ci-runtime/README.md)。
- 対象は Core PR212 の計画 commit c08e77e4ee3c6b53609003038185b84c0b289f51。未commit の schema verifier 実装を検証した結果ではない。
- Scheduler → dispatcher → Infisical → GitHub App → immutable GCS source → Cloud Build → GitHub commit status の自動経路が完了。build aaf6b0a0-24cf-416a-8d8b-833b4b3434c1、専用 sa-cloud-build-ci、source generation 1791289809417352。
- 実 PostgreSQL 17 の full Core CI は 104 result groups / 940 passed / 0 failed / 0 ignored。全 build step SUCCESS、24分9.167秒。GitHub context tastile/cloud-build-ci は success。
- この資料は 1回の観測。10回の中央値と40 runs/month換算は未確定で、poc.cloud-build-ci / Core204 を完了扱いにしない。PoC は実行中 (`running`) とし、GitHub status の criterion c3 だけを観測結果として記録する。現在の Cloud Build 検証は追加の heavy GitHub Actions を止める前の証跡である。

検証元は read-only Cloud Build metadata / Logging test-result records / GitHub commit status。secret 値や token は含まない。
