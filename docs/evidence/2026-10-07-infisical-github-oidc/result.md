# GitHub OIDC 実認証と cleanup

Root PR86 を --merge で9c63281f58a9098933e3253cfbebcf6ab91797f5へ統合した。実 GitHub OIDC issuer / audience / repository IDs / ref / event / workflow claim により release allow200 / scoped canary read200 / hash一致 / TTL300を観測。同repoPRは403、同release refの別workflowは401。各receiptはcredential実値を含まない。

一時membership・identity・role・canary・空folderを削除し、identity/canary404、role/folder一覧の不存在と恒久CI role残存を確認した。folder DELETE初回はparent path未指定による404だったため、source API contractのpath=/tastileを指定して成功した。configはinactive。auth success証跡を削除後再実行したとは主張しない。

PoC c2/c3のdev fixture実証であり、staging service GCP auth、cross-service/environment read、missing-secret readiness、production licenseの残りgateは未達。本PoC全体はrunningのまま。
