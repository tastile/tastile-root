# 2026-09-19 ticket package の検証記録

確認日: 2026-09-06。対象はIssue化と実行計画。製品の実装・本番品質・公開の認定ではない。

## GitHub の実状態

[Release Board](https://github.com/tastile/tastile-root/issues/2)を日本語の無料Web＋Android計画へ更新した。

| 対象 | 実行Issue数 | 公開必須 | 後続 | milestone |
| --- | --- | --- | --- | --- |
| root | 10 | 7 | 3 | [1](https://github.com/tastile/tastile-root/milestone/1) |
| Core（非公開） | 9 | 8 | 1 | private milestone 1 |
| Web | 7 | 7 | 0 | [1](https://github.com/tastile/tastile-web/milestone/1) |
| Android | 7 | 7 | 0 | [1](https://github.com/tastile/tastile-android/milestone/1) |
| 合計 | 33 | 29 | 4 | 期限 2026-09-19 JST |

30件を新規作成し、既存のroot#1、web#76、android#4を再利用・更新した。root#2のboardは上表に含めない。
全33件をGitHub APIで読み戻し、marker重複なし、repository、priority/state label、必須milestone、
依存URLまたはopaque private gate参照が計画に一致することを確認した。結果は `MATCH`、差異0件。
Coreの実装詳細と安全性情報を公開Issueへ転載していない。

4本のrelease branchをremoteの固定baselineから作り、API readbackでSHA一致を確認した。
既存branchの上書き、製品version変更、tag作成、source commit、PR merge、deploy、公開配布は行っていない。

## ローカル検査

| 検査 | 実行内容 | 結果 |
| --- | --- | --- |
| 初期計画 | `bun scripts/check-release-plan.ts` | exit 0 / PLAN_VALID / 33件・29必須・106h・Ready R02/R03 |
| root gate | `pwsh -NoProfile -File .agent-loop/gate-root.ps1` | exit 0 / Agent environment check passed |
| task schema | PowerShell `Test-Json -SchemaFile` | 正常task受理、241分budgetを拒否 |
| result schema | PowerShell `Test-Json -SchemaFile` | 正常result受理、VERIFIED＋exit 2を拒否 |
| 変更の空白検査 | 対象path限定 `git diff --check` | exit 0。AGENTS.mdにGitのLF→CRLF通知あり |

validatorはDAG、全実装のR03前提、R06までのclosure、schema/profileの必須項目を検査する。
task/resultの全semantic制約、実効隔離、live GitHub state、本番挙動を検証するプログラムではない。
schemaにも実行権限を強制する機能はない。coordinator/Supervisorによる照合と証跡が必要。

## 独立検査

Terra指定のread-only reviewerが固定したファイルdigestを記録して計画を検査した。
初回の指摘に基づき、公開Core情報をopaque化し、R03/C00/C07/R07の前提、client codegen順序、
実行budget、result証跡、quality routingを修正した。最終の限定監査では計画packageに
blocking contradictionなしとの結果を受けた。reviewerは製品testやGitHub実状態を検証していない。

独立監査の対象digest（一部）:

- tickets: `595bc5bfc78c319b8799184bdb6eaa85238ca7b90bb689106f8491ba1274353d`
- task/result schema: `c014d1143ee1a7e763c7f75f11dc39d923bb3e0cb5cb1f28fbfea1de655c3170`
- validator: `17ee683c29e7f28e611a55ac000ae734036d7289da209343c1379b8f3dd88e05`

監査後、W03のVitest commandとR05のPowerShell配列指定を具体化し、既存advisory ignoreを
release判定へ持ち込まないためWebの未抑制auditを追加した。DAG/範囲/見積もりは変更していない。
その後のplan validatorもexit 0。これはcommit用のprecommit独立reviewを代替しない。

## 未完了として残したもの

- R03: ローカルinstruction/Skill/計画を対象差分だけreview・commit・release branchへ統合する。
- R02: 本番相当DB/provider/OAuth/署名/Play/実機の利用可否。secret参照と運用証跡は非公開に保持する。
- R07: 106 worker-hoursにreview・外部待ち・bufferを加えた容量を確保する。9/7と9/12の18時JSTに判断する。
- B04: Projects tokenの権限。現状はIssue/milestone/status labelで運用できる。
- B01: 外部Supervisorの実効隔離と回収。現状の実装はWIP1で、read-only調査だけ並列化する。
- 全製品Issue: 実装、必須CI、実DB/browser/device、独立検査、release branchへのmerge。

9月19日公開の保証、全Issue Ready、source検証完了、無人の後日実行予約を主張していない。
日付付きIssueを作成しても自動的には実行されない。coordinatorの実行開始とoperatorの対応が必要。
