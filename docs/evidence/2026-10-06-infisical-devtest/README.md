# Infisical 開発・検証用の限定改変

対象は root Issue #50、ADR-0022、execution generation 3。
v0.165.15 の開発・検証例外を確認し、専用 project を増設せず dev/staging で検証した。

## 実装と実行環境

- base image digest: `sha256:1b4f37a5e2e3de198b60a95d53e54cb94d67a2fda74e76c89e2812cd1e8326a6`
- role module base SHA256: `9d8565d9a0de67f3317e8b4dbb82210784fd3631b2f3ac5f1ab8dfea8fa30acf`
- membership module base SHA256: `042f86f211d61559673188fc588f996375771849181beb4b84e98ca72d23c505`
- 検証した私有 image: `sha256:878835c6ab5057f039437d7c49bc5328f356ad07fc4c7af4cbf81629075363f8`
- 各 module の plan gate 2箇所を固定 SHA256 確認後に変更。actor guard、privilege boundary、secret permission は既存経路を維持。
- org/project/flag の限定条件、User1001 の helper import、実 API health200 を確認。
- DB/Redis volume を維持。変更前 compose と暗号化 column を含む DB dump は自前 host の root 限定 directory に保管。実値は evidence に含まない。

初回 image は readiness を満たさず、元の image に復元した。
API200 と元の role inventory を確認後、helper を644に固定し、User1001 import を build gate に追加した。
role API の DELETE は JSON body なしで送る必要がある。検証 script の誤りを修正して再実行した。
builtin role ID は response ごとに生成されるため、元の builtin slug/name と custom role 0件を比較した。

## VERIFIED

| 対象 | 観測 |
| --- | --- |
| dev/staging role create/update | 各200 |
| production/organization role create | 400、従来の RBAC plan restriction |
| foreign project/未認証 role create | 404/401 |
| dev/staging custom identity assignment/update | 200 |
| staging builtin no-access assignment/update | 200 |
| assignment が残る role の削除 | 400 |
| production/foreign assignment | 404、actor guard で拒否 |
| Google 短期 ID token → Infisical GCP auth | 200 |
| dev `/tastile/ci` の CI App private key read | 200、値は memory 内で存在確認のみ |
| 他path/他environment/production read | 403/403/403 |
| secret write/role create/update | 403/403/403 |
| 評価 assignment/identity/role の削除 | 200、assignment readback404、custom role0 |
| GCP 一時 OpenIdTokenCreator binding | 正確な条件付きbindingを削除し、policy readbackで不存在確認 |

他 environment の同じ path が存在しない初回 read は404になったため、権限拒否の証拠として数えなかった。
既存 staging environment に空 folder を一時作成して path を成立させたところ403を観測した。
作成した folder だけを child → parent の順で削除し、既存 folder/secret は変更していない。

GCP token 発行権限は operator と dev の CI dispatcher SA だけに最大30分の条件付きで一時付与した。
IAM propagation の403は成功扱いにせず、発行200を観測してから検証した。
長期 SA key、signing/access-token 権限、Infisical static credential は追加していない。

local: `bun test infra/infisical-development-testing/guard.test.ts infra/gcp/ci-dispatcher/index.test.ts`
は14pass/0fail/40assertions。architecture generate/render/validate は0error、既存cost advisory1。
audit は0error、既存advisory11。元imageへの実復元と、作成permission dataの実cleanupは確認済み。

## 範囲と残り

今回は operator が Google 短期 ID token を発行した GCP-native auth / RBAC 経路の評価。
Cloud Run metadata での実稼働、GitHub release OIDC の workflow 拒否、runtime secret 欠落 canary、
dispatcher の実 status reporting、10 build median は未完。
`poc.infisical-workload-auth` と m2 全体を passed/DONE に変更しない。
production の paid RBAC は正規license/条件の別 gate を維持する。

metadata-only raw observations: `roles.json`、`staging-assignments.json`、`workload-auth.json`。
改変 source の UTF-8/LF SHA256 と対象を `manifest.json` に固定する。
