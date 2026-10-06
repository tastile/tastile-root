# dev CI dispatcher の実 runtime 認証検証

Issue: root#50。Execution Generation: 4。2026-10-06。ADR-0022/0023。

## 対象と観測

Root PR82 merge d37f3ce85cacc99368e73ba938c4c622d1949dcf。image は exact source3917990ca95f104690fe9baacd1d1c2629ad2dd7 の5file allowlistからCloud Build13ce2fe1で作成。image.json のdigestをdeploy。private source bucket/registry、publish専用SAを使用。publisherへのsource Object Viewer1件とdev service/invoker/Scheduler3件をapply（削除/他環境変更0）。

runtime.json は内部ingress/min0max1設定のservice ready、専用SAだけのinvoker、pathなしaudienceのScheduler OIDCを記録。runtime-logs.json のHTTP200とeligible Core PRs0は、実metadata token→Infisical login→CI鍵取得→GitHub App installation token→PR listが完了した観測。秘密値やtokenは出力/保存していない。対象PR0なのでbuild投入・commit status通知の証跡ではない。

http-denials.json は同project一時Schedulerから未認証403、invokerでないpublish SA OIDC403、検証job削除後GET404。外部からの未認証はinternal ingressの404であり、401/403の証跡としては使わない。永久Schedulerは変更せず、IAM許可を追加していない。

key-denials.json は実運用と同じCI identity/SA/audienceのGoogle署名付き短命OIDCをoperator impersonationで作成して検証。許可鍵200、他key（既存folder）/path/environment（既存root）/staging project/production project/role管理は403。Cloud Run metadataそのものを使った正例とは証跡の起源を区別。書込を試していないため、このbundle単独をwrite拒否の動作証明としない（前回ADR22評価proofは別identityのwrite403）。

temporary-iam-cleanup.json は最大30分条件のOpenIdTokenCreatorを検証後に削除し、policy readback不存在を確認したreceipt。設定済みCI identity/roleは運用に必要なので保持。以前の一時identity cleanup0を現在のrole0と読み替えない。

## 未完

exact Core PR headの自動build/status、10回中央値、PR build credential isolationの実測、実請求は未完。poc.cloud-build-ci とm2はplannedのまま。production license/価格のgateはdev evaluationで解消していない。全体移行/Core202残り/staging/cutover/soak/decommissionは未完。
