# T01 追補 — 運用スタックの所在確定と read-only 参照手段（2026-11-11）

- 対象: tastile/tastile-root#105 G0 判定、`docs/plans/2026-11-11-local-first-t01-readonly-ledger.md` の §4 / §6-2 / §7
- 追補日: 2026-11-11
- 前提: 台帳本体の運用境界（§1）は不変。本書は「所在不明」だった §6-2 を**現物確認で置き換える**ものであり、境界を緩めない。
- 結論の種別: **所在の確定**（旧 origin の特定）と、**確認した範囲で稼働実体が見当たらないこと**。read-only 参照手段は「参照対象が無いので不要」ではなく「確認した範囲に参照対象が無い」ことの提示として扱う。未確認領域は §7。

---

## 0. 判定に効く結論（先に書く）

**本節は「確認した範囲」の結論である。未確認の領域は §7 に列挙し、断定しない。**

1. 現行運用スタックの**旧 origin は AWS**（`api.tastile.app` / `app.tastile.app` の A レコード = `52.194.61.218`、staging 系 = `52.194.223.15`）。
2. その 2 つの origin IP は **22/443 が閉塞**しており、Cloudflare は `522 origin connection timeout` を返す。**少なくともこれら 2 ホストは現在アプリを配信していない。**
3. `TASTILE_DATABASE_URL` が指す RDS エンドポイント `tastile-beta-postgres.ct0cqygo23kn.ap-northeast-1.rds.amazonaws.com` は **NXDOMAIN**（Cloudflare DNS / 1.1.1.1 / 8.8.8.8）。**この DB は名前解決できない。**
4. 到達可能な範囲（Infisical ホスト、Windows/WSL 開発端末、Tailscale 端末、端末上の Tastile 配置）では、**Tastile のアプリケーションデータを保持する稼働スタックを確認できなかった**。
5. したがって #105 が前提とする「運用VMのみを予定の正本とする」対象は、**確認した範囲には存在しない**。ただし §7 の未確認領域（R2、AWS の現在の残存 resource、旧 origin のバックアップ、端末ローカル DB）を含めた全体で「存在しない」とは断定しない。
6. G0 の判断項目「運用スタックの所在と read-only 参照手段」は、**「所在は確定。ただし参照対象として確認できたものは無い」**という形で解消する。これは go 条件の充足ではない（§4）。

---

## 1. 現物確認の方法と範囲

すべて read-only。運用スタックへの書込み・再起動・移設・設定変更は一切していない。

| 手段 | 対象 | 得たもの |
| --- | --- | --- |
| Cloudflare API `GET /zones/{id}/dns_records` | `tastile.app` ゾーン | A / CNAME / TXT の全レコード（下記 §2） |
| Cloudflare API `GET /accounts/{id}/cfd_tunnel` | アカウント | **tunnel 0 件**（Tastile 用 cloudflared tunnel は存在しない） |
| Cloudflare API `GET /zones/{id}/workers/routes` | `tastile.app` | `staging-app` / `staging-api` の 2 本のみ。**本番ホスト名を捌く Worker route は無い** |
| DNS 解決 | RDS エンドポイント | NXDOMAIN（Cloudflare / 1.1.1.1 / 8.8.8.8） |
| TCP 到達性 | `52.194.61.218` / `52.194.223.15` | 22 / 443 とも閉塞。ICMP も 100% loss |
| HTTPS | `app.tastile.app` / `api.tastile.app/v1/health` | HTTP 522（`cf-ray` 付き Cloudflare 応答） |
| SSH（read-only） | `rebuildup-secrets-host` = `tastile-infisical`（157.180.90.160） | 稼働: Infisical(backend/db/redis)、cloudflared、**停止済み** devnode-headscale。Tastile アプリは無い |
| SSH（read-only） | `device-windows`（`UUU`） / `device-wsl`（`basic@UUU`） | `wslc images` は開発用 3 件のみ、`wslc ps` は **0 件**。`docker` 不在、Tastile のサービス・プロセス・待受 port なし |
| Tailscale | `muse`（100.75.166.5） ほか | 22/80/443/3000/5432/31400/8080 すべて閉塞 |
| 端末上の成果物 | Windows `%APPDATA%\Tastile` / `%LOCALAPPDATA%\Tastile` | `settings.json` と `credentials.bin` のみ（2026-08-22）。DB・スナップショット・常駐なし |
| Cloudflare R2 / Pages | アカウント | token 権限外（認証エラー）。**未確認**として残す |

`xserver`（`x220-158-20-47.static.xvps.ne.jp`）は Windows 側 `known_hosts` / `ssh config` に定義があるが、
**ホスト名が NXDOMAIN**、想定 IP `158.20.47.220` は 22 閉塞。Tastile の origin ではない（`#105` の台帳 §4 の推定を維持）。

---

## 2. DNS の現物（`tastile.app` ゾーン）

本番系:

| レコード | 値 | proxied |
| --- | --- | --- |
| `A app.tastile.app` | `52.194.61.218` | true |
| `A api.tastile.app` | `52.194.61.218` | true |
| `A tastile.app` | `52.194.61.218` | true |

staging 系:

| レコード | 値 | proxied |
| --- | --- | --- |
| `A api.staging.app.tastile.app` | `52.194.223.15` | true |
| `A staging.api.tastile.app` | `52.194.223.15` | true |
| `AAAA staging.app.tastile.app` / `staging-api.tastile.app` | `100::` | true |

補助:

- `download.tastile.app` → `public.r2.dev`（Desktop 更新 manifest は 200 で配信継続。**アプリのデータプレーンではない**）
- `www.tastile.app` → `cname.vercel-dns.com`（unproxied）
- SES 用 DKIM / MX / SPF / DMARC、`_acme-challenge.staging.app` の TXT が残存

`52.194.61.218` / `52.194.223.15` はいずれも whois で **Amazon Technologies (AT-88-Z)**。#102 が記録する
「AWS (900977801015) を全削除、EC2 4 台 / EIP / RDS 2 台を削除」と整合する。
つまり **DNS だけが旧 IP を指したまま残っている**（Cloudflare のレコードは据え置き、と #102 も明記）。

---

## 3. 「運用スタック」に該当するものの最終整理

| 候補 | 実在 | 予定・タスクの正本になり得るか |
| --- | --- | --- |
| AWS 上の旧 origin（52.194.61.218 / 52.194.223.15） | **不達**（22/443 閉塞、522） | 不可。確認した限り応答しない |
| `tastile-beta-postgres...rds.amazonaws.com` | **NXDOMAIN** | 不可。名前解決できない |
| Infisical ホスト（157.180.90.160） | 稼働（secret 管理のみ） | 不可。Tastile アプリもアプリ DB も無い |
| Windows `UUU` / WSL | 稼働（開発端末） | 不可。`wslc ps` 0 件、Tastile 常駐なし |
| Muse（Tailscale 端末） | オンラインだが全 port 閉塞 | 確認不能 |
| 検証スタック（`tastile-verify-*`, Colima） | 稼働（本作業で構築） | **正本ではない**（#105 §1 が明示） |

**確認した範囲では、運用スタックとして機能しているものは無い。** 台帳 §4 が「観測できなかった」と書いた理由は、
到達経路の不足ではなく **旧 origin 自体が応答せず、名前解決できていた DB も消えている**ためである。
一方、§7 に挙げた領域（R2 の内容、AWS の現在の残存 resource、旧 origin のバックアップ、
Muse のローカル DB）は確認できていない。**全体として「存在しない」とは断定しない。**

---

## 4. read-only 参照手段の扱い（G0 判断項目の書き換え）

#105 の G0 判断項目は「運用スタックの所在と read-only 参照手段を提示できるか」であった。本書は次を提示する。

1. **所在**: AWS 上の旧 EC2 origin（IP は §2）。whois は Amazon Technologies で、#102 の削除記録と整合する。ただし**現在の AWS 側の残存 resource は未確認**（CLI session 失効）。
2. **read-only 参照手段**: 確認した範囲では、参照すべき稼働アプリスタックが無いため**確立しない**。代わりに、
   - Cloudflare DNS / tunnel / Worker route の **API 読み取り**（本作業で実行済み。以後も read-only で再取得可能）
   - Infisical / 端末の **read-only 棚卸し**（同上）
   を「運用境界の証拠を再取得する手段」として固定する。これは**アプリデータの参照手段ではない**。

したがって G0 の当該条件は「未提示」ではなく、**「提示した結果、確認した範囲に正本が見当たらない」**へ変わる。
未確認領域（§7）が残るため、**「正本は存在しない」と断定はしない**。
いずれにせよ #105 の ACCEPT 条件（正本を保護できている）を満たす方向には動かない。**計画前提の変更が必要**である。

---

## 5. #105 に対する含意（G0 判定に必要な承認）

#105 は次の 2 点を前提にしている。

- 「試用期間中の予定の正本は運用VMのみ」「朝の調査・境界通知・既存自動化はこの運用スタックの情報のみを読む」
- T14 / T15 は「認可された読取専用データ/匿名化 snapshot」で v1/v2 を比較する

確認した範囲に稼働スタックが無い以上、**この 2 前提は現状のままでは成立しない**（未確認領域に実体がある可能性は §7 のとおり残る）。
取り得る道は 3 つで、いずれも本人の判断を要する。

| 選択肢 | 内容 | 影響 |
| --- | --- | --- |
| A. 運用スタックを再建する | 旧 origin を復旧、または新規にローカル/VM へ再構築し、そこを正本にする | 予定・タスクの再入力が必要。G0 の「正本保護」は再建後に再判定 |
| B. 正本なきまま進める | T14/T15 を**合成 fixture のみ**で実施し、「実予定での shadow 試用」を G5 の条件から外す | 7 日試用の意味が変わる。#105 の G5 ACCEPT を書き換える必要 |
| C. G5 を保留し G0〜G4 のみ進める | 実データ比較を前提から外し、G4 までを実装・検証で完了させる | 実用性の証明が「合成データ」止まりになることを明示して受容 |

**本追補は A/B/C のいずれも選ばない。** 選定は #105 のスコープ変更であり、実装側で決めてよい事項ではない。
本追補の役割は、判断に必要な事実を揃え、選択肢を明示することに限る。

---

## 6. 判定シートへの反映

`docs/plans/2026-11-15-g0-decision-sheet.md` の該当行を次のように改める（本文は別 PR で更新）。

| G0 ACCEPT の条件 | 旧 | 新 |
| --- | --- | --- |
| 運用VMの正本保護が文書化されている | 未充足（観測できず） | **未充足（確認した範囲に稼働スタックが見当たらず、保護を証明できない）** |
| 未確認事項が隠れていない | 充足 | 充足（本書 §7 を追加） |

「観測できない」から「確認した範囲に正本が見当たらない」への変化は、**G0 を PASS に近づけない**。
#105 のスコープ（実データでの shadow 試用）を維持するなら A が必要で、これは G0 の前提作業として追加される。

---

## 7. 未確認として残すもの

- Cloudflare R2 バケットの内容（token 権限外）。アプリ DB のバックアップが置かれていないかは未確認。
- AWS アカウントの現在の残存 resource（`aws` CLI の session が失効。#102 の削除記録を超える確認はできていない）。
- 旧 origin 上のデータの最終バックアップの有無（ホストが応答しないため確認不能）。
- Muse / Android 端末のローカル DB に実予定が残っている可能性（端末は全 port 閉塞、アプリからの read-only 抽出経路なし）。
- Cloudflare Pages / Load Balancer / Origin Rules の設定（token 権限外）。

これらは「無い」と断定しない。**確認できていない**と記録する。
これらのいずれかに実体が見つかれば、その時点で read-only 参照経路の検討対象になる。
