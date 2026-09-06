# Tastile 全体レビュー — 思想・事業性・技術・安全性

レビュー日: 2026-09-05。対象はこのワークスペースの現在のチェックアウトと既存差分を含む状態。公開サービスの稼働状態を認定するものではない。

2026-09-06追記: 最新のremote baselineによる再監査とIssue化は
[9月19日実行計画](../releases/2026-09-19-plan.md)を参照する。Web proxy等の一部は既に変更されており、
以下の全指摘を現在も未修正とは扱わない。この文書には非公開Coreの安全性調査を含むため、
公開repositoryへそのまま掲載しない。

## 1. 総評

**現状のTastileを、安心して有料集客へ進める商品とは評価しない。顧客価値の検証に比べて、汎用的な実行基盤と複数クライアントへの投資が先行しすぎている。さらに、公開前に対処すべき認証の欠陥がある。**

一番価値がありそうなのは「予定が崩れたとき、自分で全部組み直さずに次の行動へ戻れる」という約束である。しかし、その価値が、特定の顧客に繰り返し利用され、対価を払ってもらえることを示すデータは今回提示されていない。コード量、仕様の厳密さ、テスト件数から、この問いへの答えは出ない。

評価は次の通り。

| 観点 | 判定 | 理由 |
| --- | --- | --- |
| 課題の設定 | 検証する価値がある | タスクの記録から実行への移行、予定崩れからの復帰は具体的な利用場面になる |
| 現在の思想 | 修正が必要 | 強制力と稼働量を中心に置き、人間が予定を守れない理由への仮説が弱い |
| 差別化 | 未証明 | 自動配置、予定調整、タスクとカレンダーの統合には既存競合がある |
| 技術の核 | 活用すべき資産がある | 決定的な最適化、コマンドの冪等性、実行と予定の分離は目的に適している |
| 技術投資の配分 | 悪い | 複数言語・クライアント・認証経路を抱えたまま、主要な利用経路に未接続部分が残る |
| セキュリティ | 公開前に是正が必要 | 未検証Cookieを信頼済みIDに変えるWeb経路、認証失敗後のcore読取経路を確認 |
| 販売準備 | 不十分 | 料金と対応機能の表記が食い違い、通知・実行・履歴の約束にも実装ギャップがある |
| 売れる可能性 | 限定顧客で検証する段階 | 大市場を取れる、成功確率が高い、と判断できる証拠はない |

私が開発の優先順位を決めるなら、今は新プラットフォームや汎用機能を増やさない。認証を是正し、ひとつの利用経路を実際に使える状態へ揃え、少人数から継続利用と支払いの証拠を得る。

## 2. 思想のレビュー

### 2.1 「判断を減らす」は良いが、「自己をロボットのように」は危うい

正本は「自己をロボットのように働かせる」「行動決定の効率最大化」「強制力をすべてのタスクに」と定義している。対象は、集中して仕事した量が成果に直結するフリーランサーである。[ビジョンと対象顧客](C:/Users/rebui/Desktop/tastile/docs/HARNESS.md:31)

この思想には、少なくとも三つの未検証の前提がある。

1. **実行できない主因が、次の行動を決める負担である。** 実際には、タスクが曖昧、見積もりが不適切、他人待ち、体力不足、優先順位の変化なども候補になる。予定と通知だけで解ける課題の範囲を絞る必要がある。
2. **強く促せば、実行が増える。** 強い通知が役立つ人もいるだろう。一方、通知を無視する習慣、アプリを開く負担、失敗感を増やす可能性もある。これは心理効果の確定的な主張ではなく、検証すべき反対仮説である。
3. **集中した時間が、成果のよい代理指標になる。** フリーランスの成果には品質、顧客との合意、納期、単価、再作業なども関わる。稼働時間だけを伸ばすと、本人の事業成果と逆方向へ最適化するおそれがある。

推奨する約束は、**「予定が崩れても、次にやることと、今日はやらないことを少ない操作で決め直せる」**。自動化の成功を「予定を埋めた量」で測らず、利用者が判断に使う時間と、予定崩れ後に復帰できた割合で測るべきである。

### 2.2 人間に残す権限を、商品仕様として明確にする

自動調整には、開始前の確認、自動変更を許す範囲、変更理由、取り消し、今日は終了する操作が必要になる。通知の強さも本人が選べるべきである。

coreにはprotectedな配置や実行中の配置を動かさない制約がある。これはよい。ただし、内部の制約が存在することと、利用者が自分の予定を制御できることは別々に確認する必要がある。[optimizerの不変条件](C:/Users/rebui/Desktop/tastile/tastile-core/v1/10-invariants.md:269)

特に、「終わらなかった仕事は自動的に次の空きへ」という挙動には、仕事を捨てる・期限を交渉する・見積もりを見直す選択肢が必要だ。毎日積み残しを移し続けるだけでは、過負荷を解決できない。

### 2.3 最初の商品に対して、抽象化が広すぎる

Window、Condition AST、Flow、Decision、Session、Feedback、再帰的な所有者と権限を持つ設計は、かなり広い問題を表現できる。ところが、最初の顧客がこの表現力のどこに払うのかはまだ明確ではない。

休憩を専用構造にしないという原則は、内部の重複を減らせる。一方、ユーザーが「25分働いて5分休む」を設定するために汎用ルールの概念を理解する必要があれば失敗である。内部モデルが汎用的でも、商品は少数の分かりやすい操作と初期設定へ落とす必要がある。[汎用化を要求する不変条件](C:/Users/rebui/Desktop/tastile/tastile-core/CLAUDE.md:43)

## 3. 市場性・競争・価格

### 3.1 競争相手は十分に存在する

「カレンダー、時計、タスクの交差点」は市場の空白を意味しない。2026-09-05に確認した公式資料では、次の代替がある。機能記載は各社の説明であり、今回それぞれの実機比較はしていない。

| 代替 | 公式に提供を説明しているもの | Tastileへの意味 |
| --- | --- | --- |
| Motion | AIによるタスク・カレンダーの計画、プロジェクト管理、各端末向けアプリ。[公式](https://www.usemotion.com/pricing?tool=motion) | 「自動で予定を組む」だけでは差別化にならない |
| Reclaim | 無料Liteを含むプラン。Focus Time、習慣、バッファ時間、カレンダー同期など。[公式](https://reclaim.ai/pricing) | 空き時間確保と習慣の自動配置には無料の代替もある |
| Sunsama | 日々の計画と各種連携。公式ヘルプは月払い22米ドル、年払い204米ドル、月換算17米ドルと記載。[公式ヘルプ](https://help.sunsama.com/docs/billing/overview/) | 安心して一日を運用できる体験には、高めの価格を提示する競合がいる |
| TickTick | タスク、リマインダー、同期。Premiumはカレンダー表示、タスク所要時間などを含み、公式表示49.99米ドル/年。[公式](https://www.ticktick.com/upgrade) | 安価なタスク・予定・通知の統合という位置にも強い代替がある |

なお、価格ページには課金周期のトグルや説明の不一致があるため、Motion・Reclaimの有料額はここでは比較に使っていない。価格と条件は変動する。

さらに競合は専用アプリだけではない。既存のカレンダー＋タイマー＋メモで済ませること、毎朝5分だけ手動で予定を整えることも代替である。移行や入力の負担を超える改善が必要になる。

### 3.2 現状の差別化は技術説明に寄りすぎている

決定的な処理、数値レジストリ、正規化された保存形式、CLIから操作できることは開発資産になる。しかし、一般のフリーランサーが購入する理由を直接には説明しない。

検証価値がある差別化仮説は、**「割り込みで崩れた日を、実際の作業履歴とつながった状態で立て直せる」**こと。たとえば「40分の割り込みの後、残りの作業、休憩、終了時刻を、変更理由が分かる状態で提案する」という具体例なら比較できる。

その際にも、本人が望まない再配置、頻繁な予定移動、過去の記録の変化が起きれば信用を失う。スケジューラの賢さだけでなく、予測可能性と制御可能性が差別化の条件になる。

### 3.3 外部カレンダー連携は、対象顧客によっては入口の必須条件

フリーランサーが既に別のカレンダーで会議や私用を管理しているなら、その空き時間を正しく取り込めなければ、Tastileは二重入力を要求する。自動配置するほど、この不完全な入力の影響は大きくなる。

LPはGoogle Calendarの双方向同期をロードマップと説明し、v1 scopeは外部連携をプラグイン側に置く。関連プラグインのソースがあっても、現在のv1クライアントから日常的に使えることは今回確認できていない。「coreの対象外」という区分だけで、商品上の必要性を後回しにしてはいけない。[LPの説明](C:/Users/rebui/Desktop/tastile/tastile-web/src/shared/i18n/sections/marketing/marketingLanding.ts:460)・[v1 scope](C:/Users/rebui/Desktop/tastile/tastile-core/v1/01-scope.md:16)

最初は、対象ユーザーに必要なカレンダー一つの予定取り込みと、既存予定を壊さない動作から検証するのが妥当である。全サービスとの双方向同期を一度に作る必要はない。

### 3.4 安さだけで勝つ構造は厳しい

現在の表示価格は月4〜5米ドルの帯だが、複数のネイティブアプリ、認証、常時稼働するバックエンド、通知、同期、サポートを維持しようとしている。

単純計算で、月4米ドルなら有料100人で月400米ドル、有料1,000人で月4,000米ドルの売上である。決済手数料、税、インフラ、サポート、開発工数を引く前の数字にすぎない。原価と利用状況が不明なので赤字とは断定しないが、少人数の顧客を手厚く支える事業との相性は慎重に考えるべきである。

最初は価格の安さを主張するより、「どの頻度で、どれだけ判断や再計画の手間が減るか」を確認し、その価値に対して実際に払われる価格を探す。継続して使われないものを値下げしても、継続理由は生まれない。

## 4. 最優先の実装上の指摘

以下のP0/P1/P2は、このレビューでの対応優先度でありCVSSではない。P0は公開前に封鎖すべき認証経路、P1は販売・主要利用に大きく影響する問題、P2は対象を限定すれば後続にできる問題とする。静的に確認した問題について、本番で被害が発生したとは主張しない。

### S1 — P0: Webプロキシが未検証Cookieを信頼済みユーザーへ昇格させる

**確認した事実:** `/api/proxy/[...path]` はAPIトークンまたはユーザーCookieの存在を確認するが、ユーザーCookieだけの場合にBetterAuthのセッション検証をしない。その値にサーバー側のbridge secretを付け、coreへ転送する。Webのnavigation gateは主に`/dashboard`と`/app`を対象にし、このAPIでの検証を補わない。coreはbridge secretが合えば、提示されたsubjectから所有者IDを導出して認証する。

**成立条件と影響:** このプロキシが公開され、Webとcoreに有効なbridge設定があり、外側に追加の認証制御がない場合、セッションを持たない呼出元がユーザーCookieを指定することで、そのsubjectとしてcore APIへ到達できる。他人のデータへのアクセスには対象subjectの把握等が必要だが、Cookieの秘密性に認証を依存させることはできない。GETに加え書込メソッドも転送されるため、影響を画面の閲覧だけに限定できない。

**対応:** route内で検証済みセッションからuser IDを導出する。Cookieの識別子を本人確認の根拠にしない。不要になったプロキシなら公開経路を閉じる。未ログイン、偽の識別Cookie、失効セッション、別人の識別Cookieを使った負の統合試験を、Webからcoreまで通して追加する。

根拠: [WebのCookieとbridge転送](C:/Users/rebui/Desktop/tastile/tastile-web/src/app/api/proxy/[...path]/route.ts:54)・[navigation gateの対象](C:/Users/rebui/Desktop/tastile/tastile-web/src/proxy.ts:42)・[coreのbridge認証](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/handlers/common.rs:814)。親レビューでも経路を独立確認済み。実環境への攻撃試行はしていない。

### S2 — P1: active-tileの読取が認証失敗後も所有者ヘッダーを採用する

**確認した事実:** `active_tile` は`authenticate`の失敗時に`x-owner-id`を読み、指定された所有者の実行中タイルを検索する。このhandlerの分岐にproduction限定の拒否がない。binaryのrouteに付くdata rate limiterは回数制限を行い、認証を代替しない。

**成立条件と影響:** このAPIへヘッダーを指定でき、対象owner UUIDを知っていて、該当する実行があれば、認証なしでもタイトルや配置・実行ID、時間帯が読めるコード経路になっている。外部ingressでの遮断状況は未確認。

**対応:** 認証失敗はそのまま拒否する。production設定、無効Bearer、他ownerヘッダーの組合せを実際のrouterで検証する。

根拠: [認証失敗時の分岐](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/handlers/read.rs:922)・[所有者による検索](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/handlers/read.rs:947)・[rate limiter](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/main.rs:230)・[routeへの適用](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/main.rs:954)。

### S3 — P1: 設定欠落時に認証が弱くなる

`TASTILE_ENV`は`production`か`prod`の場合だけ本番扱いで、未設定や別の値では開発用の所有者ヘッダー認証へ進める。公開環境の設定漏れが、そのまま認証境界を弱くする設計である。現行本番がその状態だとは確認していない。

開発用の認証省略は明示的に有効化し、許可したローカル用途へ限定するべきである。不明な環境値は起動時に失敗させるほうが、運用ミスに強い。

根拠: [環境値の判定](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/handlers/common.rs:25)・[非本番のfallback](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/handlers/common.rs:784)。

### S4 — P1: アプリ用トークンとログアウトの寿命が揃っていない

モバイル用token発行と既定Web token発行は、有効期限を指定せずcoreに作成を依頼する。coreの期限は任意で、scopeの既定値は`all`。WebログアウトはBetterAuthセッションを終了しCookieを消すが、対応するcore API tokenを失効させる処理はこの経路にない。coreの`signout`も`v1_session`を対象としており、API tokenとは別である。

Cookie削除は、既にコピーされたトークンを無効にはしない。独立した長期APIキーを提供する設計自体はあり得るが、通常ログインから自動発行する全権tokenには、端末との紐付け、期限、端末失効、アカウント停止時の扱いを定義する必要がある。

なお、`mintBrowserApiToken`には明示的なTTLを設定する実装もある。「すべてのトークンが無期限」という指摘ではない。問題は、発行経路ごとに寿命と失効の意味が揃っていないことである。

根拠: [mobile発行](C:/Users/rebui/Desktop/tastile/tastile-web/src/app/api/mobile/api-token/route.ts:25)・[既定Web発行](C:/Users/rebui/Desktop/tastile/tastile-web/src/lib/account/api-token-session.ts:64)・[期限付きbrowser発行](C:/Users/rebui/Desktop/tastile/tastile-web/src/lib/account/api-token-session.ts:102)・[Webログアウト](C:/Users/rebui/Desktop/tastile/tastile-web/src/app/auth/logout/route.ts:11)・[core発行](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/handlers/auth.rs:150)・[core signout](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/handlers/auth.rs:619)。

### G1 — P1: Desktopの主要操作が明示的な未対応例外になる

`CreateTileAsync`、`StartTileAsync`、`CompleteTileAsync`、`DeferTileAsync`、休憩開始・終了、更新の主要経路が`NotSupportedException`を投げる。一方でMainViewModelなどの現役コードから呼ばれている。これは古いREADMEから推測した未実装ではない。

型が合わない操作を曖昧に送信せず止める判断は理解できる。しかし、その状態を「動くDesktop」「実行を支援する対応端末」として販売できない。対象外にするなら、販売説明と操作可能なUIも揃えるべきである。

根拠: [APIクライアント](C:/Users/rebui/Desktop/tastile/tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs:401)・[完了と休憩の呼出元](C:/Users/rebui/Desktop/tastile/tastile-desktop/src/TastileDesktop/ViewModels/MainViewModel.cs:2162)。

### G2 — P1: Webの実行通知が古いレスポンス形式を前提にしている

通知hookは`is_working`、`main_tile`、`pending_prompt_id`を期待する。実際のURLは`/v1/active-tile`へ変換され、その応答は`tile_id`、`placement_id`、`execution_id`、`title`、`span_start`、`span_end`である。現在の応答をそのまま評価すると`is_working`が存在せず、該当する実行通知生成は`null`になる。

これはWebの全通知が動かないという意味ではない。このhookによる実行中通知の経路がAPI contractと不整合になっている。

**今回の実行結果:** 関連する既存Vitestは3件すべて通った。しかしfixture自身が古い`is_working`形式を返している。テストが通ることと、実APIにつながることの差が具体的に表れている。

根拠: [期待する型と呼出](C:/Users/rebui/Desktop/tastile/tastile-web/src/shared/hooks/use-notifications.ts:58)・[通知を捨てる条件](C:/Users/rebui/Desktop/tastile/tastile-web/src/shared/hooks/use-notifications.ts:217)・[URL変換](C:/Users/rebui/Desktop/tastile/tastile-web/src/shared/api/v1/path-map.ts:23)・[core応答型](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/handlers/read.rs:908)・[テストfixture](C:/Users/rebui/Desktop/tastile/tastile-web/src/shared/hooks/use-notifications.test.ts:52)。

### G3 — P1: AndroidのリモートPush登録が無効

DIは`NoOpPushTokenProvider`を提供し、`currentToken()`は常に`null`を返す。登録処理はtokenがないとネットワーク呼出を行わない。core側にdeliveryの仕組みがあっても、この経路ではAndroidにリモートPush endpointが登録されない。

ローカル通知やforeground serviceがすべて存在しないとは言わない。しかし、サーバー側で予定が変わったときに、閉じた端末でも届くという商品の約束は、この実装だけでは成立しない。実機で、バックグラウンド、画面消灯、権限拒否、再起動、通信断からの復帰を含む到達試験が必要である。

根拠: [NoOp providerと登録](C:/Users/rebui/Desktop/tastile/tastile-android/app/src/main/java/app/tastile/android/data/notification/PushEndpointRepository.kt:18)・[実際のDI binding](C:/Users/rebui/Desktop/tastile/tastile-android/app/src/main/java/app/tastile/android/di/AppModule.kt:46)。

### G4 — P1: 実行開始時のBasis固定が、保存と完了評価につながっていない

仕様は、開始時に時間要件・Task・Span等を固定し、後から予定を変更してもExecutionへ波及させないとする。しかし、startの保存はBasisの参照とhashにとどまり、読み出す`basis.values`は空配列である。完了評価は開始時の固定値ではなく、現在のPlanのcompletion定義を読む。

開始後にPlanの完了条件が更新されると、その実行の判定基準が開始時の約束からずれる可能性がある。これは「過去の事実を守る」というTastileの重要な思想に関わる。加えて、`resolution_hash`に新しいUUIDを割り当てており、名前だけから解決内容の指紋だと扱うこともできない。

修正では、開始時に必要な定義を固定し、表示・TaskRun検証・完了評価が同じ固定値を使うことを、実DBの回帰試験で確認すべきである。今回、実行開始→Plan変更→完了の実DB再現はしていない。

根拠: [仕様の独立性](C:/Users/rebui/Desktop/tastile/tastile-core/HARNESS.md:68)・[start保存](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/storage/src/execution_repo.rs:93)・[空のBasis値](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/storage/src/execution_repo.rs:620)・[現在のPlanでの評価](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/storage/src/execution_runtime_repo.rs:851)・[Plan条件の置換](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/storage/src/plan_repo.rs:98)。

### G5 — P1: TaskRunが、その実行に属するTaskかを確認していない

`mark_task`はUUIDv7、状態値、Execution所有者、終了状態、revisionを検証するが、`taskDefId`がそのExecutionの固定されたTask集合に属するかを検証せず保存する。テーブルの`task_id`にも、この対応を保証する外部キーはない。

任意のTask IDを自分のExecutionの履歴に混入できるため、観測記録の意味を保証できない。ここから他人のTaskを変更できる、とまでは確認していない。問題は、Execution内部の整合性である。

根拠: [検証とINSERT](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/storage/src/execution_repo.rs:376)・[スキーマ](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/storage/migrations/V1_001__base.sql:640)。

### G6 — P1: 料金・対応端末・履歴保持の販売説明が一致しない

LPは月5米ドル・年50米ドル、料金カードは月4米ドル・年40米ドル。LPは無制限タイル、無制限履歴、Windows/Mac/iOS同期を説明する。一方、root正本はiOS/Mac未着手としている。料金用の別辞書も、タイル上限や履歴期間を異なる内容で持つ。

これらは単なる翻訳の細部ではなく、購入判断に関わる商品内容である。実請求額はStripeのprice IDが決めるため、画面に書かれた金額を実課金額とは断定しない。それでも、商品説明の一本化は有料募集の前提になる。

「全履歴をexportできる」「完全に削除できる」「Desktopはofflineで動く」といったLPの約束も、販売前に実際の導線で検証が必要である。今回は未検証であり、不可能だと断定してはいない。

根拠: [LP料金と機能](C:/Users/rebui/Desktop/tastile/tastile-web/src/shared/i18n/sections/marketing/marketingLanding.ts:402)・[料金カード](C:/Users/rebui/Desktop/tastile/tastile-web/src/features/marketing/ui/PricingCard.tsx:66)・[別の料金辞書](C:/Users/rebui/Desktop/tastile/tastile-web/src/shared/i18n/sections/marketing/marketing.ts:102)・[プラットフォームの状態](C:/Users/rebui/Desktop/tastile/docs/HARNESS.md:155)・[export/offline等の約束](C:/Users/rebui/Desktop/tastile/tastile-web/src/shared/i18n/sections/marketing/marketingLanding.ts:456)。

## 5. 技術スタックとアーキテクチャ

### 5.1 維持すべきものと、投資を止めるべきもの

| 選択 | 評価 | 推奨する扱い |
| --- | --- | --- |
| Rust / axumのcore | 決定的な計算、型、不変条件を扱う核として合理性がある | 維持。市場検証前の言語書き直しはしない |
| PostgreSQL / SQLx | 関係、履歴、トランザクション、owner境界に適している | 維持。実データ規模の性能と復旧を確認する |
| Command / Event / Outbox / Lease | 再送や競合、配送失敗がある商品に合う | 維持。ただし実画面・実端末までつながる試験を優先する |
| Next.js / React | LP、認証、課金、ブラウザーUIをまとめる選択として理解できる | 維持。古いAPI形状とキャストを整理する |
| Bun | frontendとscriptの統一に意味がある | 維持。toolchain変更を商品上の進捗と混同しない |
| Kotlin / Compose | Androidの通知・常駐・端末機能を扱う理由がある | 対象顧客がAndroidを使うか確認し、ひとつの確実な通知経路へ集中する |
| C# / WinUI 3 | Windows固有の常駐・操作体験が価値になるなら理由がある | 現状は機能拡張を止め、正式対応か後続かを明確にする |
| BetterAuth＋core API token＋bridge | 実現可能だが信頼境界と失効の責任が重い | 今回の欠陥を優先是正。認証経路と主体を減らす |
| 5つの独立repository | 配布・言語の独立性はあるが、横断変更の費用が高い | 今すぐ統合しない。対応版の組合せと横断contract試験を明示する |

依存の実体は[Web package](C:/Users/rebui/Desktop/tastile/tastile-web/package.json:46)、[core workspace](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/Cargo.toml:12)、各クライアントのローカル指示を参照した。この表は選択の適合性の評価であり、全依存の最新advisoryを監査した結果ではない。

### 5.2 過剰な原則を減らすべき

数値enum、UUIDv7、JSONB禁止、完全な正規化、クライアントにdomain logicを置かない、といった原則には個別の利点がある。しかし、それらを守ることを顧客価値より上に置くと、設計は硬直する。

特に「文字列enumより数値が常に良い」「JSONBを禁止すれば良い設計になる」とは、このプロダクトの要件からは導けない。数値は安定したwire contractに役立つ反面、意味の追跡とクライアント間のレジストリ管理を要求する。正規化は整合性に役立つ反面、読み書きの実装やmigrationを増やす。各原則は、具体的に防ぐ障害と、増える保守コストで判断すべきである。

現状の問題を解くために、規約を一斉変更する必要はない。まず既存のcoreが約束する不変条件を実装と試験で満たし、今後の追加ルールには顧客上の必要性を要求する。

### 5.3 「thin client」でも、端末側の信頼性は省略できない

サーバーを意思決定の正本とする方針は理解できる。一方で、通知、端末再起動、通信断、表示キャッシュ、未送信操作、期限切れの予定の扱いは、クライアントが責任を持つ必要がある。

たとえば、予定済み通知を端末に保持することと、端末が勝手に予定を再最適化することは責任が違う。前者まで「薄くする」ために切り捨てると、通信やサーバーの不調で実行支援が止まる。権威ある予定の版、有効期限、再同期、重複通知防止を定めるべきである。

LPはWebに接続が必要、Desktopはoffline対応と説明するが、Desktopの主要書込経路には前述の未対応がある。offlineの販売約束を守る証拠も別途必要になる。

### 5.4 認証の置き換え理由は、十分に吟味すべきだった

CognitoからBetterAuthへのADRは、identityの正本をdomain内に置く考えと外部user poolが構造的に矛盾すると説明する。[ADR](C:/Users/rebui/Desktop/tastile/docs/decisions.md:3)

私の設計上の評価では、ログインを証明する主体と、商品内のowner/profileを管理する主体は分離して設計できる。domainの所有権を保つために、認証方式を必ず置き換える必要がある、という結論にはならない。

BetterAuthを選ぶこと自体を否定しない。ただし、既存データの破棄、複数クライアントの移行、token交換、失効、bridge境界の監査という費用を負担する選択である。今回の欠陥を見れば、移行の設計完了を、認証経路全体の安全性の証拠と扱えないことは明らかだ。

## 6. 運用・品質保証・設計管理

### 6.1 良い設計は実際にある

以下は残すべき資産である。ただし、今回すべての動作を再実行して確認したわけではない。

- API tokenのハッシュ保存、失効・期限確認が実装されている。[認証処理](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/src/handlers/common.rs:679)
- Execution開始とreflowの競合をowner lock・row lockで制御し、重複開始を抑えている。[開始処理](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/storage/src/execution_repo.rs:24)
- optimizerは決定的な候補選択と探索上限を持ち、大域最適を保証しないことも明示する。[実装](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/domain/src/source_schedule.rs:835)・[保証範囲](C:/Users/rebui/Desktop/tastile/tastile-core/v1/10-invariants.md:269)
- RDSの宣言には非公開、保存時暗号化、保持・削除保護、バックアップ保持設定がある。[infra宣言](C:/Users/rebui/Desktop/tastile/tastile-core/deploy/aws/foundation/foundation.yaml:308)
- domain benchmark、10k timelineの試験、closed-loop E2Eのソースがある。[benchmark](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/domain/benches/source_schedule_bench.rs:23)・[scale試験](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/api/tests/timeline_scale_10k_e2e.rs:1)・[E2E](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/worker/tests/at_closed_loop_e2e.rs:1)

これらがあるから「安全」「完成」とは判定できない。S1のような境界の穴が、個々の良い対策を迂回する。

### 6.2 通知商品の品質基準は、build成功より厳しい

「通知はサーバーで送った」では不十分である。端末が受信した、利用者に提示された、利用者が返答した、返答後の状態が一致した、を分けて観測する必要がある。

coreの最新履歴も、closed-loop E2Eの保証範囲を限定し、実FCM/APNs端末でのreceipt、公開PlanとDecisionの接続、追加の評価context等を残件としている。ここを無視して「Phase A-D完了だからサービス完成に近い」と評価するのは誤りである。[最新の保証範囲と残件](C:/Users/rebui/Desktop/tastile/tastile-core/HARNESS.md:1691)

既存Web通知テストの3件成功は、実APIとの不一致を検出しなかった。次に価値が高い試験は、もう一つの古いfixtureを使う単体試験ではなく、同じcore応答をWeb・Android・Desktopのconsumerへ渡すcontract試験と、実端末まで通した利用試験である。

### 6.3 運用目標は、現状では約束より仮説に近い

v1のp99 latency、同時ユーザー1,000以上、可用性99.9%は暫定目標と明記されている。infra宣言のDBは`MultiAZ: false`。その構成を採用すること自体は初期段階ならあり得るが、可用性や復旧の実績にはならない。[暫定非機能要件](C:/Users/rebui/Desktop/tastile/tastile-core/v1/01-scope.md:27)・[DB構成](C:/Users/rebui/Desktop/tastile/tastile-core/deploy/aws/foundation/foundation.yaml:318)

販売前に優先したいのは、実データのbackupから別環境への復元、API/worker再起動、配送の再試行と重複防止、予定変更から端末反映までの遅延の観測である。今回、実AWS構成、請求額、restore訓練、稼働率の記録は検証していない。

Dockerを使わずLinux binaryを直接動かすことも、それだけで欠陥ではない。再現可能な配布物、依存の固定、起動設定、rollback、運用担当が理解できる手順が揃うかで判断するべきである。

### 6.4 正本の食い違いが、実際の開発リスクになっている

具体例は次の通り。

| 文書・実装 | 食い違い |
| --- | --- |
| rootの対象顧客とcore scope | rootはチーム提供も想定するが、v1 scopeの対象ユーザー欄は共有対象外。[root](C:/Users/rebui/Desktop/tastile/docs/HARNESS.md:55)・[scope](C:/Users/rebui/Desktop/tastile/tastile-core/v1/01-scope.md:85) |
| 時刻仕様と実装 | 仕様は国際化でもIANA timezoneを使わないとする一方、実装はownerのIANA timezoneを解決する。[仕様](C:/Users/rebui/Desktop/tastile/tastile-core/v1/03-time-and-windows.md:184)・[実装](C:/Users/rebui/Desktop/tastile/tastile-core/crates-v1/storage/src/owner_tz.rs:1) |
| rootの課金計画とWeb | rootは通知完成後に課金実装とするが、Stripeとcheckout等のコードは既に存在する。[root](C:/Users/rebui/Desktop/tastile/docs/HARNESS.md:295)・[Stripe設定](C:/Users/rebui/Desktop/tastile/tastile-web/src/lib/stripe.ts:1) |
| DesktopのUIとAPI | 操作を提供する呼出元に対し、API側が未対応例外を返す。G1参照 |

時刻については、「IANA対応がない」と断定すると誤る。今回の問題は、実装を読むまで仕様のどちらに従うべきか分からないことにある。なお、固定UTC間隔の繰り返しと、夏時間をまたぐ現地時刻での繰り返しは、別の受入例で確認すべきである。iCalendarにもtimezoneを伴う繰り返しの表現がある。[RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html)

エージェントへの規約を増やしても、相互に違う正本を厳密に守らせれば、矛盾した実装を速く作る結果になる。必要なのは、現在の発売対象、対応contract、未提供機能を少数の現行資料へ揃えることである。

## 7. 売れるかを判断するための具体的な検証

以下は戦略提案であり、承認済みの実装仕様ではない。数値は業界標準や統計的な成功判定ではなく、次の投資を決めるための暫定基準である。

### 7.1 最初の対象

「全フリーランサー」では広すぎる。まずは、**一人で働き、予定の裁量があり、割り込みで週に何度も計画が崩れ、今も手動で再計画している人**へ絞る。

端末条件も確認する。現在のWeb＋Androidに合う人へ絞るなら、その制約を募集時から明示する。顧客の多数が別端末を使うなら、追加実装へ進む前に対象顧客と配布戦略を再検討する。フリーランサーのOS比率は今回調べておらず、WindowsやAndroid中心だとは仮定しない。

### 7.2 一度に売る体験を一つにする

最小の商品体験は、次の一周でよい。

1. 今日やる仕事を少数入力し、既存予定を避けて配置する。
2. 適切な時刻に通知し、ひとつの操作で開始できる。
3. 中断・延長・未完了を簡単に記録できる。
4. 残りの予定の変更理由が分かり、承認または修正できる。
5. 一日の終わりに、できた仕事と翌日に送る仕事を決められる。

この一周が安定するまで、チーム階層、細かな権限、汎用プラグイン、追加platform、学習型の高度な最適化を拡張しない。既存の汎用実装を削除して作り直す必要はない。投資先を絞る。

### 7.3 6週間の判断ゲート

| 期間 | 実施内容 | 判断のために残す証拠 |
| --- | --- | --- |
| 1週目 | S1〜S3の閉鎖と回帰確認。公開対象の機能・料金・端末表記を統一。並行して対象者15人程度に直近の予定崩れを聞く | 認証の負の試験、発売対象一覧、現在の代替手段、失敗の頻度 |
| 2週目 | 対象者の端末で一周の体験を接続。必要なら手動支援を使い、手動介入を計測する | 初回の入力→配置→通知→開始→終了、操作不能や通知不達の記録 |
| 3〜4週目 | 条件に合う10人程度に日常利用してもらう。開発者からの催促を分けて記録する | 初回到達率、週ごとの実利用日数、予定崩れ後の復帰、手動再配置回数、通知を切った理由 |
| 5〜6週目 | 同じ価値と条件で有料継続を提示。実際の支払いと利用を確認する | 支払い人数、支払わない理由、継続日数、ユーザーごとのサポート時間 |

仮の継続条件は、対象10人中7人が初回に一周でき、4週目にも5人以上が週3日以上自発的に利用し、3人以上が提示価格で実際に支払うこと。さらに、本人が「再計画の負担が減った」と具体例を挙げられ、開発者の毎日の個別救済に依存していないことを求める。

この程度の人数では市場適合の証明にならない。しかし、機能を足す前に、価値がない・対象が違う・初期導入が重い、のどれなのかを判断する材料になる。基準を下回った場合は、無条件で開発期間を延長せず、課題仮説や対象を変更する。

### 7.4 指標の置き方

中心指標の候補は「週に、予定崩れ後も次の行動へ復帰できた利用日数」。利用者の申告と操作記録を合わせて確認する。

補助指標として、初回価値までの時間、再計画に使った時間、予定の手直し回数、通知から開始までの時間、通知拒否・停止、翌週利用、支払いと解約理由を見る。勤務時間や実行時間は成果の代わりに単独で成功指標へ置かない。

行動記録自体が私的な生活情報になり得るので、計測イベントにタスク本文や行動の詳細を安易に載せない。最初は必要な状態遷移と時刻差で足りる。

## 8. 実施範囲・証拠・限界

### 8.1 対象の版

| repository | branch | HEAD | 開始時からの既存変更 |
| --- | --- | --- | --- |
| root | main | 378819c83e49 | 28件。staged、unstaged、untrackedを含む |
| tastile-core | codex/v1-runtime-loop-completion | 7139e49580b6 | clean |
| tastile-web | main | c2100745686f | 2件 |
| tastile-android | main | e287f3f3a1cd | 2件 |
| tastile-desktop | docs/ui-design-system-pass-spec | cba77c11c561 | clean |
| tastile-brands | main | cba41cf34003 | clean |

各repositoryのbranch、status、差分の概要を確認した。評価はこの組合せに対するもので、各mainの組合せや本番配布物とは限らない。既存変更を戻す・stageする・commitする操作はしていない。アプリのソース・設定は変更していない。

### 8.2 今回の実行確認

| 対象 | 区分 | コマンド・観測 | 結果 |
| --- | --- | --- | --- |
| 各Git root | VERIFIED | `git branch --show-current`、`git status --short`、`git diff --stat`、HEAD確認 | 上記の作業状態を記録 |
| Web通知の既存単体試験 | VERIFIED | tastile-webで `bunx --no-install vitest run src/shared/hooks/use-notifications.test.ts` | exit 0、1 file、3 passed、13.80秒 |
| Web→core認証経路 | REVIEWED | route、navigation gate、core handlerを照合 | S1〜S4。実環境での侵入再現は未実施 |
| coreのBasis・TaskRun・completion | REVIEWED | 保存・読取・完了評価と正本を照合 | G4/G5。Rust・PostgreSQLの再現試験は未実施 |
| クライアント | REVIEWED | Web、Android、Desktopの呼出元と実装を照合 | G1〜G3。実機での一周は未確認 |
| ブラウザー画面 | 未確認 | 利用可能な既存ブラウザーはblankのみ。調べた一般的な開発portに起動済みWebを確認できず | 新serverは起動していない。見た目・操作感・a11yの採点はしない |
| 市場・競合 | REVIEWED | 各社公式ページ・公式ヘルプを確認 | 価格条件と機能の比較。競合の利用体験や成果は未測定 |

full workspace gate、実DBでの全試験、Android端末・Windowsアプリの操作、本番デプロイ状態、外部ネットワークからの侵入試験、全依存のadvisory監査、実課金、全データexport/delete、backup restoreは今回実施していない。過去のHARNESSの成功記録を現在の合格証拠には使っていない。

したがって、このレビューは「全コードと全環境に問題がないことを証明した完全監査」ではない。思想から販売・実装・運用まで横断して、判断に影響する具体的な問題と仮説を抽出したレビューである。

## 9. 最終判断

**Tastileに必要なのは、さらに立派な汎用基盤を作ることより、特定の人が明日も使う一周を確実にすることだ。**

現在の方向のまま機能と対応端末を増やすと、完成判定の対象が増え続け、顧客から学ぶ時期が遅れる。認証の穴や通知の断絶がある以上、機能量を根拠に有料公開を急ぐ判断も支持できない。

残す価値があるのは、予定と実行を分離した核、決定的な再配置、再送・競合に耐える処理、実際の履歴に応じて残りの一日を調整する構想である。そこへ集中し、「予定が崩れた後に戻れる」という価値を少人数に売って確かめる。次の大きな開発投資は、その結果を見て決めるべきである。
