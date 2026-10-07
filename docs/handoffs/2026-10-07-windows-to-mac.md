# Tastile 移行: Windows → Mac 引き継ぎ

更新日: 2026-10-07（日本時間）。ユーザーの「Macのセッションへ引き継ぎたい」により、新しい移行作業・追加CI計測は開始せず、現在の状態を保存した。

## 1. 結論と Windows の残件

**移行全体は未完了。Macで継続できる。** m1は完了、m2の基盤・GitHub OIDC・自動CIは実証済み。Coreのruntime分離A/B/Cは統合済み。10回CI中央値、Core drain D/E、staging、client接続、production切替、14日soak、旧AWS撤去が残る。

| 残件 | Windows必須か | 備考 |
| --- | --- | --- |
| Desktop / WinUI の実アプリ検証 | **必須** | 将来のstaging接続・認証・production smokeをWindows実機で行う。現在の225 testsはm1時点の証跡で、新stagingの証明ではない。Windowsホストを後で再利用できればよい。 |
| Rust / PostgreSQL / OCI | 不要 | Mac上のLinux containerかCloud Buildで実施。WindowsネイティブRust buildを代替証跡にしない。MacのARMと本番amd64の差はCloud Build/Linux amd64で確認する。 |
| Android | 不要 | MacのJDK/Android SDK/deviceで実施できる。実device/emulatorのgateは維持する。 |
| GCP / Infisical / Cloudflare / AWS / GitHub | 不要 | Mac側のCLI/browser認証・SSH鍵の準備は必要。WindowsのCLI token/cacheをGitへコピーしない。 |
| WindowsのWSL/WSLC cache・保全VHD | 任意の後片付け | Mac作業の依存ではない。ユーザーの既存データを含むbackupを勝手に削除しない。 |

以前渡された `D:\0_inbox\downloads\tastile-core-ci.2026-09-29.private-key.pem` は引き継ぎ時の `Test-Path` で不存在を確認した。agentが削除したとは主張しない。GitHub App鍵の正本はInfisical。

## 2. 正本・作業ルール

- root `AGENTS.md`、`architecture/model/sot-registry.yaml`、`architecture/README.md`。意味はprivate Core `v1/`、仕組みはroot `architecture/`。
- fresh agentは `recover-task` とdurable checkpointから復元する。checkpoint: [Root #50の保存コメント](https://github.com/tastile/tastile-root/issues/50#issuecomment-5903694662)。ローカル `.agent-loop/checkpoints/50.json` だけに依存しない。
- root #50 / release-0-7-0 / branch50、Core #202・#204 / release-1-1-0 / branch202・204。新branchはIssue番号のみ。共有hostにworktreeを作らない。
- parentがwriter、既存Terra agentsはread-only。旧precommit reviewer loopはADR-0021で廃止。binding verificationは維持する。
- Bun、rgを使う。新Python scriptは作らない。source/comment/commitは英語、開発文書/Issue/PRは日本語。
- secret値の正本はInfisical。GitHub Secrets・GCP SA key・dotenvへの独立copy/fallbackを追加しない。必要secret欠落はfail closed。
- ユーザーは通常の設定・実装・git・deploy・必要な課金を既に承認。再確認を繰り返さない。外部への新規メッセージ送信には明示的な送信指示が必要。
- model変更はgenerate/render/validate、各childの適用gate、実DB/browser/device、source/hash/exit/cleanupのfresh証跡を維持する。

## 3. 取得する Git 状態

| Repository | 状態 |
| --- | --- |
| root | release-0-7-0統合 `ab4b3d55592356a3a61c2dd8a03fdcbefbc6925a`。PR86/87 merged。branch50に本handoffをpushする。 |
| Core release | `9b3f8b5363af52a12ab5912318cfdabe5af8728d`。PR212 merged、A/B/C sourceとrollback修正が統合済み。#202はopen。 |
| Core branch204 | `4333400a0b64a623d6d2d289706e9249db98fbcb`。Draft [PR213](https://github.com/tastile/tastile-core/pull/213)、#204はopen。新しいfresh shared Cargo targetの自動CI成功。 |
| Core branch202 | plan `d90249af586001acea81699c60ae83a4fd0b6e48` とworker設定/期限primitiveの引き継ぎcommit。引き継ぎcommit `d7ceea19dac7a604e5f5892bb830afacd0e051da` をbranch202へpush済み。独立binding review済み。D全体は未完成。 |
| Web | PR182/180 merged: release-1-1-0 `805bcb4d`（既存m1証跡）。 |
| Android | PR83/81 merged: release-0-7-0 `ac9a30f`（API35/730testsの既存m1証跡）。 |
| Desktop | PR47 merged: release-0-7-0 `d39d3f0`（225testsの既存m1証跡）。 |

Macでは既存checkoutのbranch/status/diffを先に確認し、対象branchをfetchする。Windows上の無関係なroot生成物EOL差分は保存したままで、本handoff commitに混ぜない。remoteの最新状態を照合する。

## 4. 直近の完了・実証

### GitHub OIDC → Infisical

- Root PR86 merge `9c63281f58a9098933e3253cfbebcf6ab91797f5`。
- release allow run `37573057903`: GitHub mint200、Infisical login200、canary read200/hash一致、TTL300。
- 同release refの別workflow run `37573057890`: mint200、login401。
- 同repo PR runs `37572998775` / `37572998781`: mint200、login403。
- exact repo ID / owner ID / ref / event / workflow claimで限定。jobにenvironmentを付けず、Universal Auth/static tokenを作っていない。
- 一時identity `494dd2d8-32b7-4a8e-9ee9-a255eff4848c`、role `f4783368-38e0-4573-9fdd-ab506fa22913`、folder `24801ca9-ecce-4029-a323-f67f37acb13c`、membership/canaryを削除し、不存在と恒久CI role残存を確認済み。**再作成しない。** configはinactive。
- PR87 merge `ab4b3d5` に実receipt/cleanup/hash manifestを保存。`docs/evidence/2026-10-07-infisical-github-oidc/result.md`。PoCはrunning、c2/c3のみpass。inactive workflowの後続successを実認証として数えない。

### Core CとCI

- Core source4e8a88d: native `37568451704` 全gate/rollback成功。Cloud Build `25c99d44-daeb-41bd-9581-9dc23cae36e5` 全106groups942/0/0成功、26分24.219秒で単発25分超。失敗した647/TIMEOUTも履歴に保持。
- Core204 source4333400: 自動Cloud Build **`f9271430-b88f-4edc-ae26-2416d25580aa` SUCCESS**、全4step成功。2026-10-07 13:49:11〜14:12:31 JST、**1399.916秒 =23分19.916秒**。
- source: `gs://tastile-dev-tastile-ci-source/sources/4333400a0b64a623d6d2d289706e9249db98fbcb.tar.gz`、generation **1791348549664995**。サービスアカウントはci専用。
- native `37573225958` とGitHub Appの `tastile/cloud-build-ci` statusも成功。
- 実PG17の全106groups942pass/0fail/0ignoredをLoggingから確認。metadata/countsは本folderの `2026-10-07-ci-baseline.json` に保存。
- **追加9回は未投入。10回中央値は未達。** 古い4e8やc08 sourceと混ぜない。
- 最初の2ab8a4cはCloud Build create400で実行前拒否。shell uppercase変数を `$${CARGO_TARGET_DIR}` とescapeした4333400で実起動成功。400を成功サンプルにしない。

## 5. 次の作業順

1. checkpointを読み、remote branch/PR/source generationとcredential接続を再確認する。
2. #204: f9271430をbaselineとして同一SHA/source generation/recipe/step image、fresh targetの追加9回を測定する。計測helperは本folderの `ci-median-replicas.ts` / `ci-median-collect.ts`。Root cwdで実行する。gcloud human authはRAMのみ。

   ```sh
   bun docs/handoffs/ci-median-replicas.ts f9271430-b88f-4edc-ae26-2416d25580aa 4333400a0b64a623d6d2d289706e9249db98fbcb
   bun docs/handoffs/ci-median-collect.ts
   ```

   作成helperは `tastile-core-ci-poc-g4/source-<SHA>/sample-02..10` の独自tagで冪等回復し、GitHub statusやdispatcher recovery tagを触らない。現cohortはg4として保持。fresh recoveryで更新したexecution_generationを環境変数 `TASTILE_EXECUTION_GENERATION` へ設定するとjournalもその世代を記録する。各sample全step/全実DBtest成功・同じimage digestを確認する。collectorはpending=2/failure=1、全10成功時だけmedianを出す。9回のcompute概算$1.8（buffer込み・credit前・請求上限ではない）。2500無料分はbilling account共有で、他の利用やlogs/storage/egressは別。

3. #204の残り: nativeの重複heavy Rust/rollbackをCloud Buildへ移す。現在Cloud Buildのarchiveには.gitがなく、rollback scriptはgit fetch/archiveを要求する。dispatcherがexact baseline `crates-v1/` archiveをimmutable source bucketへ保存し、base SHA / generation / SHA256をbindする設計が必要。PR buildへGitHub credentialを渡さず、baseline target分離と全rollback checksを保持する。**現在の計測成功だけで#204をcloseしない。** gate追加でrecipe変更する場合は別cohortで再測定する。
4. #202 D: `docs/plans/2026-10-07-worker-drain.md` を正本としてpass report/drain/maintenance/deadline伝播を実装。現在のconfig/deadline primitiveは準備段階。独立レビューの指摘と実DB concurrency/archive/timeoutのgateを満たす。
5. m2のGitHub経路とCIのexitを確認して、E/stagingのGCP workload auth / missing-secret readiness / DML-migrator分離 / Cloud Run worker HTTP / R2 /restoreを実証する。
6. Web/Auth/edge、Android/Desktop/CLI staging、production rehearsal/cutover、**14連続日のsoak**、旧AWS撤去。順序とoperator authorityはroadmapを守る。日数を短縮して完了扱いしない。

## 6. Core D の重要な途中状態

現在準備したもの: worker config/library、既定値を維持する各driverの設定参照、単一monotonic deadlineと短いitem budgetのprimitive。各claimのlease終端はclaim直前のUTCから計算する修正を含む。deadline primitive自体のLinux unit8/0/0を観測したが、daemon全passのbounded動作を完成したとはしない。fresh全体gateは108groups950pass/0fail/0ignored/exit0、fixture DB/role残存0/0、cleanup exit0。Core `docs/evidence/2026-10-07-worker-preparation/` のsource manifest/full log/summaryを参照。新sourceのhosted/OCI/rollback証跡は未実施。

未実装: one-pass driver report、failure/partial count、drain CLI、delivery provider failure report、V1_071 private owner-maintenance row、CPU cancellationをplanner各loopへ注入、HTTP adapter。

設計制約:

- maintenance owner/Flow FKを付けない。既存active linked tile joinでeligibleを再確認する。archiveはsoft deleteなのでcascade/hookでowner rowを消さない。
- NOT EXISTS discovery + bounded insert UUIDv7 + ON CONFLICT。global cursor不要。due index(next_available_at,owner_id)、claimでavailable_atをlease_untilへ進める。
- complete/retry/retireはlease token CAS+eligible再確認。失敗ownerはdurable backoffで後半ownerを阻害しない。再eligibleはdiscoveryで復帰。
- global55s、maintenancelease90s。既存worklease30sならitem予算29s以下。item期限切れは残りglobal時間でretry/failure、global/cancelは無制限finalizeを待たずlease expiryへ委ねる。
- raw provider/SQL error/token/payloadをDB/reportへ保存しない。bounded error code/安全なsummaryだけ。
- domainへambient clock/GCP型を入れない。明示cancel checkをgap/flow/candidate/chunk等へ渡す。公開numeric registry/既存成功結果/idempotency keyを保つ。
- 既存70→69の順序を保ち、V1_071を末尾追加。runtimeのSELECT-only/schema fail-closed/migrator専用DDLを維持。

## 7. 接続先と資格情報の準備

### Infisical

- URL: `https://secrets.rebuildup.dev`。SSH `root@157.180.90.160`。
- Windowsのoperator SSH鍵: `C:\Users\rebui\.ssh\id_ed25519_tastile_infisical_hetzner`。Macの既存鍵で接続できるか確認。必要なら秘密鍵をGitに入れず安全な別経路で移す、またはMacの公開鍵を登録する。
- host `/srv/infisical/compose.yaml` / `.env`（0600）/ development-testing backup。現image `sha256:878835c6ab5057f039437d7c49bc5328f356ad07fc4c7af4cbf81629075363f8`。
- ADR22 dev/testing overlayはdev/stage projectだけ。prod/org/他project除外。**productionへ開発例外を広げない。**
- org `d808df2c-ec67-4046-b733-8c0db0bfa47d`。
- dev `949b4193-a226-4620-8371-726a37c7195b`、stage `44081e84-5983-4cc2-9fc9-dca5363005e1`、prod `ab532e90-acde-40e6-a206-3976743e5da5`。3project設計を維持する。
- 恒久CI identity `1daa0c31-bf42-4fd4-9229-3a33b92f0864` / role `0b6d9c28-3b25-4a13-9384-aea2af4aa0f0`。orgNoAccess、dev/dev `/tastile/ci/GITHUB_CI_APP_PRIVATE_KEY` read/describeのみ。**削除・再作成しない。**

### GCP / GitHub CI

- human account `rebuild.up.up@gmail.com`。既定projectは別なので常に `--project=tastile-dev`（または明示stage/prod）。
- projects `tastile-dev` (#561004747976)、`tastile-staging`、`tastile-prod`。
- private CI Cloud Run `https://tastile-ci-dispatcher-bydsa7kkla-an.a.run.app`、revision `tastile-ci-dispatcher-00001-mrm`。
- image `asia-northeast1-docker.pkg.dev/tastile-dev/tastile/ci-dispatcher@sha256:c18eb137165eca7d082e714abcebedb1edb3ef28ee6468de5815c24847a144d0`。
- Scheduler `tastile-core-ci-dispatch` ENABLED（1分）。引き継ぎで停止していない。
- SA: `sa-ci-dispatcher`、`sa-cloud-build-ci`、`sa-cloud-build-publish` @tastile-dev.iam.gserviceaccount.com。CI SAにInfisical/GitHub/private key/deploy権限を加えない。
- source bucket `tastile-dev-tastile-ci-source`、retention7日。Tofu state `tastile-dev-tastile-tofu-state` / prefixfoundation。planで既存resource/stateを読み、作り直さない。
- GitHub App ID5122506 / installation166165934。Core限定Contents/PR read、Statuses write、Metadata read、Webhook無効。PEM正本はInfisical。
- Coreにlegacy production bridge/probe等のGitHub Secret名が残ることは引き継ぎ時にmetadataのみ確認した。現在のAWS経路を把握せず削除せず、cutover/decommissionで利用先とInfisical正本を照合して解消する。global secret-store整理を完了と主張しない。

### Production licence

正規license/正式費用は未取得。10月2日の公式個別回答はselfhostPro最小10 identities、CloudProより約30%premium、正式価格はemail提示不可。public Cloud価格をselfhostの正式見積もりと読み替えない。見積もり/key/order/purchase commitmentなし。`docs/evidence/2026-10-06-infisical-license-acquisition.md`。prod mutation前に解決する。

## 8. Windowsに残したローカル物

- 元WSLCbackup: `C:\Users\rebui\AppData\Local\wslc\sessions\wslc-cli-basic.backup-20261006-g4`（触らない）。
- 保全した新規失敗VHD: `D:\0_inbox\downloads\tastile-wslc-recovery-20261006-g4\storage.vhdx`（約24GB）。Mac実装の依存ではない。
- Linux Cargo cache: `/home/basic/.cache/tastile/core202-ci-optimized-target`。sourceの代替にしない。
- root `.tmp/` は一時helper/log/cache。Macはhandoffに保存したhelper/remote証跡を使う。Windowsのtoken/private key/DB password入り一時物を丸ごとコピーしない。

## 9. 再開メッセージ例

> Tastile移行をこのhandoffとRoot #50 durable checkpointからMacで再開してください。root branch50、Core202/204のremote SHAと作業差分を確認してください。追加CI9回は未実行なので同一4333400/generation1791348549664995のcohortを先に検証し、#204のnative heavy/rollback移行、Core D/E・staging以降を継続してください。Infisical一時OIDC fixtureは削除済みで再作成不要。Windows Desktopの実機smokeは後でWindowsホストを利用し、prodへdev/testing例外を広げず正規licenseを取得してください。
