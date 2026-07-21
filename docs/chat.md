# core機能をWSL APIで検証

> 以下のユースケースと`tastile-core\docs\USECASE.md`の全ユースケースを満たせるかどうか、coreの機能を検証し、実際にwslcでAPIを動かすことで実際に機能するかを確かめてください
> 実装されていない部分、不十分な部分があれば実装を調整して、実際に使えるようにしてください。
> 要件をより深く理解し、より根本解決することをもとに進めてください。
> 設計判断はドキュメントに含まれていることが多いので、勝手に判断するのではなく、ドキュメントをもとに判断してください。
> ```
> - (通常時寮生活 日本時間 1・2学期)
> - 睡眠1:00~7:30  毎日 スケジュールに応じて徹夜
> - 朝食7:40~8:00 15分必要 毎日
> - 朝点呼
> - 昼食11:40~12:40 20分必要 基本は12:20~
> - 夕食17:40~19:40 20分必要 基本は18:00~
> - 入浴17:00~21:40 20分必要 基本は夕食の後だが、夕食後部屋に返ってから改めて入る場合がある
> - いど端底力タイム 21:00~22:40 時間固定 5分前から準備時間が必要 毎日
> - 点呼 21:43~21:47 所要時間1分 基本は21:45~ 寮で放送が鳴るのですぐでられるよう構えておく必要がある
> - 消灯  ~23:00 所要時間1分以下
> - Duolingo(英語学習) ~24:00 所要時間15分程度 基本はいど端底力タイムの後
> - モチタン(英語学習) ~24:00 所要時間15分程度 基本はいど端底力タイムの後 Duolingoの後
> - LinkedIn Games(ゲームのデイリー) 毎日時間指定なし 基本はいど端底力タイムの後 モチタンの後
> - (ラベル)
> - 2学期 6/10~8/10
> - 夏季休暇 8/11~10/1
> - テスト期間 テスト初日の1週間からテスト最終日前日まで 2学期は8/3~8/5が期末テスト本番
> - 授業時間(通常) 1・2時限 8:50~10:20 3・4時限 10:30~12:00 5・6時限 12:50~14:20 7・8時限 14:40~16:10 基本は2時限で1コマ1授業、2コマ授業もある
> - 授業時間(水曜日午後) 5時限 13:05~13:55 6・7時限 14:00~15:30 8時限 ~16:10
> - (授業時間割 二学期)
> - 法学A 月曜日1・2時限
> - 英語IV A 月曜日3・4時限
> - 計測工学 月曜日5・6時限
> - 体育IV 火曜日1・2時限
> - 応用数学 火曜日3・4時限
> - PJ学習III 火曜日5・6・7・8時限 水曜日6・7・8時限 木曜日5・6・7・8時限
> - 数値計算 水曜日1・2・3・4時限
> - 卒業研究II 木曜日5・6・7・8時限
> - 中国語A 金曜日3・4時限
> - (祝日・特別日程)
> - 7/20 海の日 学校が休み
> - 7/16 月曜日授業 時間割が木曜日のものから月曜日のものに変わる
> - 7/22 月曜日授業 時間割が水曜日のものから月曜日のものに変わる
> - 8/6 補講日 補講の内容が確定するまで予定不明 通常授業無し
> - 8/7・8/10 返却時間割 テスト返却 テスト返却の内容が確定するまで予定不明 通常授業なし
> - (プロジェクト 階層)
> - 生活時間
> - 生活時間/日次
> - 学校
> - 学校/授業/時間割
> - 学校/授業/[科目名]/[課題]
> - (いど端底力タイム)
> - 毎日 21:00〜22:40 に、仕事以外の何かしら有意義なことに集中するための時間
> - Discordのステージを開く。事前にタイムキーパーのDiscordボットを起動しておく
> - 21:00〜22:40の中でさらにフェーズが分かれる
> - 21:00〜21:15　作業 1（15分） 21:15〜21:20　5分休憩 21:20〜21:50　作業 2（30分） 21:50〜21:55　5分休憩 21:55〜22:40　作業 3（45分）
> - 22:40後に振り返りとしてDiscordに記録するタスク(~10程度)がある
> - (休憩 初期状態で作成されている)
> - 15分作業/5分休憩/30分作業/5分休憩/45分作業/5分休憩/60分作業/5分休憩/75分作業/5分休憩/90分作業/30分休憩/15分作業に戻る の順番で、休憩だけ配置タイルを作成する 固定の予定が無い部分に埋まる。ワークフローが中断された場合ワークフローの最初からにリセットされる
> - 休憩は休憩用のタスクを割り当てることも出来る(音楽の視聴やゲームなど)
> - (生活調整 ルーティーン)
> - 平均睡眠時間7時間半を確保できるように、2日に1度程度で昼寝 目安は2時間 徹夜明けなどでそれに限らない場合もある
> - 徹夜する前提のある日はコーヒーを買う
> - 3~4日に1回程度 洗濯する 洗濯機に1時間半、乾燥機に4時間程度かかる。洗濯・乾燥・回収の3回行動が必要 間隔は3日以上空いているといい。
> - 土曜日はAtCoder ABCに参加。いど端底力タイムの内容としてそのまま割り当て
> ```
>
> まずは/goalを使うための正確なゴールを考えて。

<details><summary>3 previous messages</summary>

> まず `brainstorming` スキルを使い、提示要件と `tastile-core/docs/USECASE.md`、関連設計文書から「検証可能な完了条件」を抽出して `/goal` にします。指定の `rust_fs_global` は現在のツール一覧にないため、今回は読み取り専用の PowerShell で確認します。まだ実装・修正には着手しません。
>
> `USECASE.md` は30ケースに加え、正本テーブル・イベント・冪等性まで確認対象にしています。ゴールが「テストが通る」だけにならないよう、現行READMEとWSLC/API運用・スケジューリングの現行計画も確認し、文書間の優先順位と実機検証条件を含めます。
>
> ゴールは、単なる30件の網羅ではなく「提示された生活モデルを正規API入力として表現でき、生成・再解決・実行・履歴・競合判断までWSLC上で再現できること」を中心にします。正本は `tastile-core/v1/`、課題集合は `docs/USECASE.md`、現行実装計画は `docs/plans/` とし、archiveは経緯確認に限定します。
</details>

`/goal` を設定しました。

ゴールの核は次の通りです。

- `tastile-core/v1/` を仕様上の正本とする
- `docs/USECASE.md` 全30件と、提示された寮生活・授業・休憩・睡眠・洗濯等のユースケースを対象にする
- 公開APIと正規化データモデルだけで、保存・配置・再解決・Decision・Execution・履歴追跡まで実現する
- 仕様→実装→API→DB副作用のカバレッジ表を作る
- 不足は再現テストを追加してから根本原因を修正する
- 実際にWSLCでPostgreSQL・API・workerを起動して検証する
- 各ケースについてAPI応答、DB状態、イベント、冪等性などの証拠を残す
- 未検証・既知の不足を合格扱いしない
- `fmt`、`clippy`、関連テスト、workspace全テストを成功させる

ゴールは現在 `active` です。まだ実装変更は行っていません。

> ちゃんとrecurringタイルの非推奨→ソースタイルからの配置タイル処理アルゴリズム、実行までのAPI経路の完成から、
> さらにweb e2eテストでの達成度評価、マルチユーザー前提テスト、Androidでの接続、大きいスコープでのレビューと、
> 現状の大きな未実装範囲の特定からの、より速い実装のための多数エージェント分担まで実際に続けられる仕組みまで考えてください。3実装エージェント対1レビューエージェントくらいで、mainブランチのみで作業します。

<details><summary>4 previous messages</summary>

> 追加要件を、現在のゴールの実行設計として組み込みます。`brainstorming` → `writing-plans` → `dispatching-parallel-agents` / `subagent-driven-development` の順で使い、3実装担当＋主担当レビューという運用、main直作業での衝突回避、Core→Web E2E→複数ユーザー→Androidまでのゲートを具体化します。`rust_fs_global` は引き続き利用できないため、読み取りはPowerShellへフォールバックします。
>
> ここから `dispatching-parallel-agents` の分担を実際に適用します。mainブランチ共有では同一ファイルの並行編集が危険なので、最初の3担当は読み取り専用監査に分けます。主担当の私は統合レビュー役となり、監査結果からファイル所有権が重ならない実装バッチを切ります。これで同時稼働枠4つを「実装候補調査3＋統合レビュー1」として使えます。
>
> 実装を進めますか？それならモデルを変更します
> solはゴールを立てるのだけに動いてもらいます
>
> 実装はまだ始めていません。行ったのはゴール精緻化のための読み取り専用監査開始だけで、ファイル編集・コミット・テスト実行はありません。モデル変更前に作業が先へ進まないよう、監査エージェントもここで停止します。
</details>

まだ実装には進んでいません。

- ファイル変更・コミット：なし
- 実装エージェント：未稼働
- 読み取り専用監査エージェント：停止済み
- ゴール：`active`
- 追加スコープ：実行計画へ反映済み

モデル変更後に、監査・計画化から再開してください。

> ゴールの変更はありますか？
> そこまではsolで進めるので

はい、変更が必要です。現在のゴールには次が明示不足です。

- Recurring Tileの非推奨化とSourceTileへの完全移行
- Placement生成からExecutionまでの公開API経路完成
- Web E2Eによる達成度評価
- マルチユーザー分離・競合テスト
- AndroidからWSLC/APIへの実接続
- Core・Web・Androidを横断する大規模レビュー
- mainブランチ限定の「実装3エージェント＋主担当レビュー1」の継続実行機構

置換後のゴール案は以下です。

> Tastileを、`tastile-core/v1/` の正本仕様に従い、Recurring Tileを互換読み取り以外では非推奨化し、SourceTile → Occurrence → PlacementTile → Executionを唯一の正規な生成・更新・再配置・実行経路として完成させる。`docs/USECASE.md`全30件と提示された生活・授業・休憩・睡眠・洗濯等のユースケースについて、公開API、正規化DB、worker、イベント、履歴、Decision、冪等性を通した追跡可能なカバレッジを確立する。
>
> 現状の大きな未実装・切断経路・legacy依存をCore、Web、Android、認証、複数ユーザー、運用の全域で監査し、根本原因順に実装する。WSLC上でPostgreSQL・API・workerを実起動し、Web E2E、複数ユーザー間の所有権分離・同時操作、Android実クライアントからの認証・同期・SourceTile作成・Placement取得・Execution操作まで実証する。
>
> 作業はmainブランチのみで行い、主担当を統合レビュー担当、残り3枠をファイル所有権の重ならない実装担当とする。各バッチは失敗テスト、最小実装、担当内検証、主担当による仕様適合・品質・統合レビュー、短いコミット、全体ゲートの順で進める。共有ファイルや依存関係がある作業は直列化し、進捗台帳、未実装一覧、証拠表、再開地点をリポジトリ内に維持して、セッションやエージェントが交代しても継続可能にする。
>
> 完了条件は、Recurring経由の新規書き込みが残らず、SourceTileからExecutionまで公開APIだけで動作し、全ユースケースの判定と証拠が揃い、WSLC実API、Web E2E、マルチユーザー、Android接続、`fmt`、`clippy -D warnings`、workspace全テスト、大スコープレビューが成功していることとする。未検証・手動代替・任意JSONへの退避・既知不足は完了扱いしない。

現在のactive goalはツール上その場で本文を編集できないため、この内容への置換が必要です。

<details><summary>21 previous messages</summary>

> ゴールは拡張版へ更新済みです。まず `writing-plans` と `subagent-driven-development` を使って、現状監査を3領域に分け、正本仕様に基づく実装順・ファイル所有権・検証ゲートを確定します。共有mainでの並行編集は、監査完了までは行いません。`rust_fs_global` は利用できないため、読み取りはPowerShellへフォールバックします。
>
> ネストした各リポジトリもすべて `main` で、未コミット差分はありません。Coreのローカル規約では `CLAUDE.md` と `HARNESS.md` が必読なので、次にそれとv1のAPI・不変条件・受入試験を確認してから、監査結果を統合します。
>
> 初期調査で、SourceTile API自体は存在する一方、workerが依然「legacy recurring/flow fill」を動かしている箇所を確認しました。これはゴールの「新規書込み非推奨化」と直接衝突しうるため、監査結果で実際の書込み経路・移行互換の境界を確定してから、先に計画・台帳をコミットする順にします。
>
> 3領域の監査で、ゴールを阻む根本ギャップが明確になっています。SourceTile APIはあるものの、Coreの公開書込み・初期休憩seed・worker、さらにWeb/Androidの作成導線がRecurringへ残っています。またWSLC検証スクリプトは固定コンテナ名のため、main共有で複数担当が並行実行すると互いの実行環境を落とします。これらを先に台帳化し、互換読み取りと新規書込みの境界をテストで固定します。
>
> 監査を完了しました。最初の変更はコードではなく、今後の並列実装を安全に継続するための「正本カバレッジ・所有権・実行ゲート」を持つプログラム計画です。`writing-plans` に従い、仕様・対象AT・未実装根拠・排他境界・検証コマンドを先に固定します。
>
> <details><summary>Created a file</summary>
>
> - Wrote `./docs/plans/2026-07-18-source-tile-product-completion.md` (+116 -0)
>
> </details>
>
> 計画を作成し、初期監査の根拠と、3実装担当＋統合レビューの排他境界を固定しました。次はこの計画のTask 1として、エージェント交代後も状態を失わない台帳と、同一mainでのファイル所有権ロックを実装します。これは以後の並列実装を安全にするための先行バッチです。
>
> 運用基盤の実装担当を1名起動しました。主担当はレビュー役として、できあがった台帳・ロック・リリースゲートがmain共有作業で安全か、既存の`.agent-loop`と競合しないかを検証します。
>
> 運用基盤の実装を進行中です。ここはコード本体の前に、同時実行でWSLCや共有ファイルを壊さないための最小限の排他機構です。実装完了後は、構文チェックと独立レビューを通し、初めてCore/API・Web・Androidの3担当を安全に並列起動します。
>
> Task 1の台帳・ロック・リリースゲートは実装され、PowerShell構文検査と安全な`-WhatIf`で通っています。次に `requesting-code-review` を適用し、実装担当とは独立したレビューでロック競合、TTL、main直作業の安全性、既存hookとの非干渉を確認します。
>
> 独立レビューで、main共有運用の安全性に関わる4件のCriticalを検出しました。特にclaimの全体glob判定・claim ID上書き・live-stack解放・リリースゲートが不完全です。このままでは並列実装を開始しません。指摘を運用基盤担当へ戻し、修正後に再レビューします。
>
> 修正では、リリース検証を「通常実行で勝手にWSLC・実機を動かす」ものにはしません。`-Execute`を明示した場合だけ承認済みゲートを実行し、通常時と`-WhatIf`は計画表示に留めます。live-stackロックは必ず`finally`で解放し、証跡はケース×レイヤごとのIDで復元可能にします。
>
> Critical修正が入りました。ロックは`**`を含む安全側のglob重複判定、予約ID保護、失棄Mutex回復、確実なrelease、`-Execute`明示時のみの限定Coreゲートと証跡記録へ変更されています。再レビューで残存問題がないことを確認します。
>
> 再レビューで、Core以外の実行ゲートとlive-stack leaseの所有者識別がまだ不十分と分かりました。これはCriticalのため、修正完了までTask 1を完了扱いにしません。Web/Android/WSLCは既存のstackを前提に、明示された許可済みゲートだけを実行・記録する形へ拡張し、leaseには取得ごとのトークンを導入します。
>
> 再々レビューで、ロックの安全性は通りましたが、リリースゲートがまだ「将来のharnessを要求するだけ」だと判定されました。ここは実際に固定harnessを追加します。ただし、harnessが環境未準備なら失敗してPASSを書かない設計にし、実機やWSLCを暗黙に起動しません。併せてartifact出力先をworkspace内に制限します。
>
> 固定harnessを作成中です。ポイントは、Web・Android・WSLCを「環境がないならスキップ」にはせず、必要な既存stack・端末・認証がなければ明確に失敗させ、証拠表にPASSを残さないことです。これで未検証を成功として扱えないリリースゲートになります。
>
> 最後のレビューで、失敗したゲートをPASSと誤記録しうる重大な証跡バグと、WSLCの対象run識別不足が見つかりました。これは合格証拠の信頼性に直結するので修正します。
>
> 残りは2件の証跡精度です。WSLCはAPIとworkerの両方を個別確認し、Evidenceには実行したURL・namespace・artifactを含む完全コマンドを記録するよう修正しています。
>
> レビューが細部まで掘り下げた結果、Evidenceの「記録コマンドと実行コマンドが一致すること」と、WSLC一覧を行単位で同一namespaceに照合することが追加で必要になりました。いずれも実装担当へ修正を返しています。ゴールは継続中で、未検証を成功として扱うことはありません。
>
> 運用基盤バッチは独立レビューで承認されました。これにより、次のCore・API・Web/Android並列実装を、main共有でも所有権とlive-stack leaseを使って開始できます。まずこのバッチをコミットし、進捗台帳に初期状態を固定します。
>
> 運用基盤を `2107a6a` としてmainへコミットしました。以後はこの台帳の所有権を実際に使い、3担当を並列に起動します。各担当は失敗テストから始め、コミット前に主担当レビューへ渡します。
</details>

ゴールを拡張版へ切り替え、実装の継続基盤をmainへ導入しました。

- 計画・未実装台帳・UC01–30証拠マトリクス・所有権ルールを追加
- 共有main用のファイルclaim、WSLC live-stack lease、バッチレビュー、Web/Android/WSLCを含むリリースゲートを追加
- 独立レビューで複数回の修正を行い、最終承認済み
- `PowerShell` 構文検査、`verify-release -WhatIf`、差分検査が成功
- Core scheduling / Core API / Web+Android の3実装担当を起動済み

実装担当は現在、各自の排他的ファイル範囲で失敗テストから着手しています。ゴールは継続中です。

<details><summary>27 previous messages</summary>

> 3つの実装担当が並列作業中です。主担当は統合レビューとして、共有mainの実差分・claim状態・各担当のテスト進行を確認し、完了順に仕様適合レビューへ回します。
>
> claimは実際に取得されていますが、実行時ロックのJSONはコミット対象ではありません。再現可能な運用文書だけを追跡し、ライブclaimはGitから除外するよう最小のignore設定を追加します。
>
> <details><summary>Created a file</summary>
>
> - Wrote `./docs/implementation/recurring-to-source/.claims/.gitignore` (+2 -0)
>
> </details>
>
> 日付更新により、A/Bの最初の1時間claimは期限切れになっています。実装担当へrenewを依頼し、更新されるまで他担当はその範囲に書き込まないルールを適用します。
>
> API担当のfocused testは、Scheduling担当の作業中の`SourceReadRow`差分によりコンパイル段階で止まっています。これはmain共有の並行実装で想定した依存なので、API側で回避変更をせず、Scheduling担当に型整合の確認を依頼してから再実行します。
>
> 休憩seedの根本原因は判明しました。SourceTileのPlan定義はFlowを受け取る型を持つのに、永続化時に空集合へ落としており、legacyの「Gap条件付き休憩」と等価に移行できません。これは既存のSourceTile設計計画が要求するPlan/Window/Flow同一transactionにも反するため、仕様に沿ってFlow保持を修正する方向で進めます。
>
> 調査で、Flowが単に落ちているのではなく、`CreateSourceTilePayload`がFlow定義を受け取れない型境界そのものが根本原因と確定しました。これは現行SourceTile実装計画が既に指定しているDomain command拡張の欠落です。Scheduling担当の所有範囲を`command.rs`と対応domain testへ拡張し、API担当とはDTO公開前に型を確定する順で直列化します。
>
> claim運用の実使用で、担当範囲を安全に拡張するための`Release`操作が欠けていることが分かりました。直接JSONを編集せず、所有者だけが自分のclaimを解放できる最小機能を追加して、Aが旧claimを解放→拡張scopeで再claimできるようにします。
>
> <details><summary>Edited a file</summary>
>
> - Wrote `./scripts/orchestration/claim.ps1` (+15 -1)
>
> </details>
>
> 実際のclaimスモークで、root直下の別ディレクトリglobまで重複扱いになる誤判定を検出しました。原因はワイルドカードの親が両方空文字のときに一致と見なす実装です。安全な排他を保ちつつ無関係な担当をブロックしないよう、親ディレクトリが明示される場合だけ同親ワイルドカードを重複扱いに修正します。
>
> <details><summary>Edited a file</summary>
>
> - Wrote `./scripts/orchestration/claim.ps1` (+1 -1)
>
> </details>
>
> API担当はlegacy書込みを統一した410へ遮断し、targeted API testとAPI buildを通しました。既存のlive usecase harnessはRecurring作成へ依存しているため、410化で正しく失敗する状態です。次はGap Flowに依存しない単純なSourceTile→Placement→Execution HTTP E2Eを先に追加し、Flow DTO確定後に休憩ユースケースを繋げます。
>
> クライアント担当はWeb/Androidの型付きSourceTile clientを追加し、Webのfocused unit testは通過しています。Androidは今回と無関係な`MobileTopBar.kt`の既存重複overloadでコンパイルできず、SourceTileコードの検証まで届いていません。エラーを固定し、別バッチの根本原因修正として切り分けます。
>
> クライアント担当の初回バッチが完了しました。WebはSourceTile 5 endpointの型付きclientと2本のunit testを追加、Androidも同契約を追加しています。Androidのコンパイル停止は変更前からある`MobileTopBar.kt`の重複定義で再現済みなので、今回のclient差分とは切り離してレビューします。
>
> API担当は、Flowに依存しない正規HTTP E2E（SourceTile作成・冪等再送・Placement取得・Execution lifecycle・Basis取得）を追加しました。現時点ではAPIが未起動のため実実行は`ConnectionRefused`で止まっており、これはPASSにしません。WSLC起動後に同じテストで確認します。
>
> クライアント差分の独立レビューでCriticalを確認しました。Planに`unknown`/`JsonObject`を残していたため、型付きcommandというゴールを満たしていません。また新しい週次・期間フィールドが欠けています。クライアント担当へ返し、Core DTOに正確に揃えた型とwire-level testへ修正します。
>
> 週次・期間フィールドとWeb wire testは追加されましたが、Planの任意JSONが残っているため、このバッチはまだ不合格です。SourceTileのplan全体を型付きにするのは広い変更ですが、要件上必要です。CoreのDTOを機械的に参照し、まず共通の型を正確にmirrorしてからWeb/Androidへ適用します。
>
> Scheduling担当が`flows`をSourceTile commandへ型付き追加し、API担当も既存one-time E2Eを`flows: []`へ追従しました。OpenAPIがこのwire契約をまだ公開していないため、API担当にはFlow schemaを正確に公開する対応を続けさせます。クライアントのPlan typed mirrorとserver側unknown field拒否は、再帰型の正規DTOを確定してから別バッチで扱います。
>
> Coreの型付き`flows`はSourceTile command・永続化・Plan link・OpenAPIへ反映されましたが、現在Cドライブ空きが0 bytesで、Rustのリンクとstorage checkが`No space left on device`で止まっています。生成物を勝手に削除せず、まず使用量と安全に回収できる候補を特定します。
>
> 現時点のWindows側Cドライブは15.53GB空いており、最大の可回収候補はCoreの生成済み`target/debug`約40.97GBです。削除はまだ不要です。共有ビルド負荷を避けるため、Core担当へ順番に再試行を依頼します。
>
> claimの再レビューで、root直下の`*.rs`と`foo.rs`のような実際に交差するglobを見逃すP1を検出しました。`tastile-core/**`と`tastile-web/**`のような別ツリーは並列化しつつ、root-levelの曖昧なpatternは安全側で重複にします。
>
> <details><summary>Edited a file</summary>
>
> - Wrote `./scripts/orchestration/claim.ps1` (+5 -0)
> - Wrote `./scripts/orchestration/claim.ps1` (+2 -2)
>
> </details>
>
> root wildcardのスモークで、空prefixを`Split-Path`へ渡す二次バグも再現しました。これはclaim機構の実装検証で見つかったため、空prefixを明示処理してから同じ交差テストを再実行します。
>
> <details><summary>Edited a file</summary>
>
> - Wrote `./scripts/orchestration/claim.ps1` (+2 -1)
>
> </details>
>
> API差分の独立レビューで4件のP1を検出しました。特に未認証でも410を返す認可順序と、Flowの文字列enum wireは正本のowner境界・数値定数規約に反します。API担当へ修正を戻し、route-levelの410副作用なし、owner/race HTTP E2Eも追加します。
>
> レビュー指摘の修正には、現在のテストrouterがlegacy routeをmountしていないという追加の根本原因がありました。API担当の所有範囲を`api/src/lib.rs`へ一時拡張し、実routerテストとSourceTile専用の数値Flow DTO変換を同じバッチで実装します。Domain enum自体の互換Serdeは変えず、公開HTTP境界で数値へ固定します。
>
> 現在は4本の依存を並列に進めています。
>
> - Scheduling: Gap Flowの正規永続化とdefault break移行
> - API: 認証後410、数値Flow wire、owner/race HTTP E2E
> - Web: 再帰的Planを含む完全な型付きclient contract
> - Android: Web契約確定後に同型へ追従
>
> どの未検証もPASS扱いにせず、各差分は独立レビュー後に短いコミットへ分けます。
</details>

進捗を継続中です。今回確定した重要点です。

- SourceTileへ型付き`flows`を追加し、Planとの正規link永続化を実装中
- legacy Recurring書込みは、未認証401・認証済み410へ認可順序を修正済み
- legacy mutation全routeを実router test対象へ追加済み
- OpenAPIの`flows`必須化テストは通過
- Core storage/APIの再チェックは一部成功

未解決・未合格:

- Gap FlowのDB統合テストはPostgreSQL接続枠不足で`PoolTimedOut`
- Flowの公開wireを数値kindへ変換するAPI DTO
- two-owner isolation / concurrent StartExecution HTTP E2E
- default breakのSourceTile化とworker legacy writer停止
- Web/AndroidのPlan全体はまだ`unknown` / `JsonObject`を含み、型付き契約として不合格
- AndroidのSourceTile testは既存`MobileTopBar.kt`の重複overloadでコンパイル前に停止

これらはすべて未達として台帳に残し、次バッチで根本修正を続けます。

<details><summary>12 previous messages</summary>

> 未達項目をそのままにせず、まずPostgreSQL接続枠の根本原因と、現在のCore/API差分の統合可能性を確認します。DB接続が回復すればGap Flowの統合テスト、続けてWSLCの実API検証へ進めます。
>
> DBの根本原因は接続枠ではなく、現在`127.0.0.1:5432`でPostgreSQLが待受していないことです。storageは既定URLへフォールバックして5秒待機していました。次にWSLCの現実のstack状態を確認し、停止中なら正規のWSLC起動手順でDB/API/workerを立ち上げます。
>
> WSLCの起動は、Ubuntuディストリの`ext4.vhdx`が見つからない `HCS/ERROR_PATH_NOT_FOUND` で停止しています。破損/移動したWSLディストリを再登録・初期化する操作はデータ破壊の可能性があるため、こちらでは実行しません。Core実装は継続し、WSLC実証は環境復旧後に同じゲートで再開します。
>
> Webには既に`condition.ts`、`completion.ts`、`tile.ts`等の大部分の型があります。新たに巨大な型を複製するより、Core wireとの命名差を明示変換するtyped DTO層を`source-tiles.ts`へ組み、既存の`unknown`を置換する方針が適切です。Androidは同じwire DTOを最小必要範囲から追加します。
>
> Scheduling差分レビューでP0を確認しました。週次mask・日付範囲がwrite側で保存されず、read側だけが読む不整合です。またSourceTile updateのFlow置換が不完全で、更新ごとにproposalが重複し得ます。default breakも「Recurringがない」だけでは代替になっていません。これらを修正するまでCore schedulingバッチは不合格です。
>
> Web側は`unknown`を排除したSourceTile wire modelの骨格を追加しました。次にCoreとの厳密照合レビューを実施します。一方Core schedulingはSQL編集ツールの安全停止を受けたため、create/updateを個別コンテキストで修正するよう再指示しています。
>
> Web wire modelの照合レビューは不合格です。必須`flows`が欠け、Planの複数variantがCoreの実際のSerde/OpenAPI形と違っています。これは見た目だけの型付けでは意味がないため、Coreのdomain/OpenAPIを唯一の参照にしてwire modelを作り直します。
>
> wire parity matrixを作成し、現時点で確認済みなのは生成・Window・SplitPolicyとCondition外形だけです。Planの各Term、Flowの数値wire、read decoderが未確認のため、client変更はまだレビュー不合格のままです。比較表を完了してから型へ反映します。
>
> Flowの数値wire化は、現在の正本・定数に信号番号表がなく、SourceTile用の簡略7種とdomainのpayload付き10種が一致しないため、安全に値を推測できません。ここは実装を止めず、v1仕様に数値registryを追加して正本化する必要があります。まず既存仕様・定数・OpenAPIの全参照を照合し、最小の明文化案を作ります。
>
> 正本を確認したところ、`FlowSignalKind`は「v1.1で数値registryを定義予定」と明記されており、現v1正本には割当表がありません。したがって、文字列enumを勝手に0〜6へ置換することは文書根拠を欠きます。この点は未解決仕様として台帳に残し、API担当は割当を推測せず、認可・owner/race E2Eなど独立部分を進めます。
>
> 再開可能性を保つため、今回確定した仕様・環境・client契約のギャップを台帳へ反映します。これにより、未定義のFlow registryや壊れたWSLCを「実装済み」に見せず、次の担当が根拠と停止点を追える状態にします。
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./docs/implementation/recurring-to-source/GAP-INVENTORY.md` (+4 -0)
> - Wrote `./docs/implementation/recurring-to-source/STATUS.md` (+4 -4)
>
> </details>
</details>

WSLC実証の環境だけは、Ubuntuの`ext4.vhdx`欠落により起動不能です。PostgreSQLも未起動で、DB統合テストは実行できません。

WSLディストリの再初期化・再登録は既存のローカルWSLCデータを失う可能性があります。新しいWSLC開発スタックを作り直してよいですか？

<details><summary>3 previous messages</summary>

> WSLCの再初期化は保留のままにし、破壊的な操作は行いません。実装・レビュー・型契約の作業はDBなしでも進められるため、Core schedulingの残修正、APIのowner/race fixture、Web wire parityを並列で継続します。
>
> 担当エージェントの現ターンが調査報告で終了したため、次の小さく検証可能なCore修正は主担当で進めます。まず `test-driven-development` を使い、Flow更新時のlink置換をDB非依存の範囲まで固定します。
>
> Context compaction
>
> Source: automatic
> Status: completed
</details>

大枠のゴール変更はありません。
ただし、実装へ移る前にゴール文へ次の明確化を加えるのが適切です。

- Flow の数値種別は、仕様に割当がない限り推測実装せず「仕様決定待ち」として扱う。
- WSLC は既存 Ubuntu の `ext4.vhdx` 欠損で起動不能のため、再作成は明示承認後に行う。
- 完了条件は「全ユースケース・API経路・Web E2E・マルチユーザー・Android接続・WSLC実稼働」の証跡が揃うこと。コンパイルのみでは完了にしない。

それ以外は、既存の大きなゴールのまま sol で進めて問題ありません。

<details><summary>7 previous messages</summary>

> ゴールは更新済みの内容を維持し、実装フェーズでは正本仕様を根拠に、未実装の正規経路から順に検証・修正します。まず現在の作業ツリーと担当状況を再確認して、次のバッチを確定します。
>
> `subagent-driven-development` の分担方式に従い、既存の3実装担当を再起動します。所有範囲を固定し、共有契約の変更は Core 正本を先行させます。
>
> 並行実装を開始しました。私は統合担当として、再開可能な並行制御スクリプトの回帰も実行し、担当間で同じファイルを競合させない前提を固めます。
>
> 担当Aが更新置換テストを完成できなかったため、重複作業を止め、私がこのP0を引き取ります。`test-driven-development` を適用し、既存の失敗しない骨組みを実際の置換不変条件を検証するテストにします。
>
> <details><summary>Edited a file</summary>
>
> - Wrote `./tastile-core/crates/v1/storage/tests/at_source_tile_scheduling.rs` (+70 -5)
>
> </details>
>
> 非DBのコンパイル・OpenAPI・Web型チェックは通りました。一方、実DBテストは PostgreSQL 不在で同じ `PoolTimedOut` を再現し、default break のSourceTile化も未実装であることを確認しました。ここは成功扱いにせず台帳へ残します。
>
> `tastile-precommit-review` を使い、rootの台帳・claimスクリプトだけを別担当に独立レビューさせます。レビュー承認とrootゲートが揃うまで、この変更はコミットしません。
</details>

ゴールは変更せず、実装フェーズに移行しています。

今回確認・着手した内容：

- Core の SourceTile Flow 更新について、既存テストが「0件確認だけ」で不十分だったため、Flow A → Flow B の更新後に active link が1件だけ残る回帰テストへ強化しました。
- `cargo check -p storage -p worker -p api --bin api`、SourceTile DBテストの `--no-run`、OpenAPIテスト、Webの型検査・SourceTile APIテストは成功しています。
- 実DBテストは PostgreSQL が起動しておらず `PoolTimedOut` で失敗しました。WSLC の Ubuntu 仮想ディスク欠損が原因で、非破壊的には復旧できません。
- SourceTile の Flow/Plan を永続化する経路は進んでいますが、default break を legacy Recurring ではなく SourceTile + Gap Flow として生成する実装は未完了です。
- Web は `flows` 必須化まで実装済みですが、Plan/Condition/Term等のSerde wire型に未一致が残っています。任意JSONへ逃がさず、Core正本に合わせて直します。
- Flow signal の数値registryは仕様側で「v1.1へ延期」と明記されており、値を推測して実装しない方針を台帳へ記録しました。
- root の再開・排他制御スクリプトは release とglob競合のスモークテストを通過。現在、別担当による独立レビュー待ちです。

未コミット変更を混ぜず、レビューと各バッチの検証が揃った単位でコミットします。

<details><summary>12 previous messages</summary>

> 次は、未コミットのCore変更を仕様適合の単位へ分解してレビュー可能にします。まず独立レビュー結果と現在の差分を確認し、default breakの正本設計を仕様から再調査します。
>
> rootの独立レビューは Critical/Importantなしでした。これから root gate を実行し、通れば再開用の台帳・claim修正だけを独立コミットにします。
>
> 正本仕様を再確認しました。休憩は専用型でなく Flow + GapTerm の組合せですが、SourceTile API の Flow は「固定Span proposal」しか表せず、初期休憩を自動seedする完全なSourceモデルには不足があります。これは実装で推測補完せず、仕様ギャップとして継続管理します。並行して、明確に仕様化済みのlegacy書込み遮断HTTPテストを進めます。
>
> workerには通常ループから切り離されたlegacy fill実装が死コードとして残っています。誤って再接続される余地をなくすため、SourceTile worker以外のlegacy Recurring/Flow fillコードと説明を削除します。
>
> <details><summary>Edited a file</summary>
>
> - Wrote `./tastile-core/crates/v1/worker/src/main.rs` (+1 -17)
> - Wrote `./tastile-core/crates/v1/worker/src/main.rs` (+0 -70)
> - Wrote `./tastile-core/crates/v1/worker/src/main.rs` (+0 -1)
>
> </details>
>
> workerからlegacy fill実装そのものを除去し、format・compile・静的探索で残参照なしを確認しました。次にこの削除とFlow更新テストを別担当へ仕様レビューに回します。
>
> CoreレビューもCritical/Importantなしでした。legacy worker経路の削除は単独で検証可能なので、他の未完了Core変更とは分離して短くコミットします。
>
> 次のCoreバッチは、SourceTile作成・更新にFlowを正規化して保存する経路です。default breakのSource化とは別の明確な基盤なので、API・domain・storageの差分を一つのレビュー対象として精査します。
>
> 独立レビューでP0を2件確認しました。OpenAPIにcalendar generation項目が欠落し、Flow更新が同一内容でも履歴を無制限に増やします。前者は直ちに修正、後者は単なるテスト追加ではなく同一更新を冪等にする設計へ戻します。
>
> <details><summary>Edited 2 files</summary>
>
> - Wrote `./tastile-core/crates/v1/api/tests/openapi_schema.rs` (+9 -0)
> - Wrote `./tastile-core/crates/v1/api/src/openapi.rs` (+6 -0)
>
> </details>
>
> Flowの冪等性は、同一definitionなら現在のPlanにlinkされたFlowを再利用し、変更分だけ新しい履歴Flowを作る設計で解決できます。既存のowner全件ロードは使わず、Plan linkをトランザクションでロック