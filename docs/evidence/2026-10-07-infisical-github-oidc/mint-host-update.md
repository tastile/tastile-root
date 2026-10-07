# 実runnerのmint host補正

初回Root PR86/f833da3の実job37570735319/37570735384は、GitHubから提供されたmint hostが既知vstokenと違うため、request bearer送信前に失敗した。これはInfisical認証拒否の証跡ではない。

実GitHubjobのvalue-silent receiptでrun-actions-2-azure-eastus.actions.githubusercontent.com / run-actions-3-azure-eastus.actions.githubusercontent.comを観測したため、exact allowlistへ追加した。issuer/audience/claim/RBAC/TTL設定は変更していない。unit8cases28assertions成功。新commitの実認証は再実行後に記録する。
