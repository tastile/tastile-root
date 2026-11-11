# T01 追補 — 運用スタックの所在確定と read-only 参照手段（2026-11-11）

- 対象: tastile/tastile-root#105 G0 判定、`docs/plans/2026-11-11-local-first-t01-readonly-ledger.md` の §4 / §6-2 / §7
- 追補日: 2026-11-11
- 前提: 台帳本体の運用境界（§1）は不変。本書は「所在不明」だった §6-2 を**現物確認で置き換える**ものであり、境界を緩めない。
- 結論の種別: **所在の確定（不在の確定を含む）**。read-only 参照手段は「現存しないため不要」ではなく「参照対象が存在しない」ことの証明として提示する。

---

## 0. 判定に効く結論（先に書く）

1. 現行運用スタックは **AWS 上のホスト**（`api.tastile.app` / `app.tastile.app` の A レコード = `52.194.61.218`、staging 系 = `52.194.223.15`）に置かれていた。
2. その 2 つの origin IP は **現在どちらも 22/443 が閉塞**しており、Cloudflare は `522 origin connection timeout` を返す。**稼働中の origin が存在しない。**
3. 本日時点で Tastile のアプリケーションデータを保持する**稼働 DB は確認できなかった**。`TASTILE_DATABASE_URL` が指す RDS エンドポイント
   `tastile-beta-postgres.ct0cqygo23kn.ap-northeast-1.rds.amazonaws.com` は **NXDOMAIN**（Cloudflare DNS と 1.1.1.1 / 8.8.8.8 の双方で解決せず）。AWS 側も #102 の削除記録と整合する。
4. したがって #105 が前提とする「運用VMのみを予定の正本とする」対象は、**本日時点で実在しない**。#105 の G0 判断項目「運用スタックの所在と read-only 参照手段」は、
   **「所在は AWS 上の旧 origin。現在は不達かつ DB も不存在」という形で解消**する。これは go 条件の充足ではなく、**判断項目の性格の変更**である（§4）。
5. この事実は #105 の計画前提（12/09〜12/15 の shadow 試用が「実予定」を読む）に直接影響する。**G0 の PASS 判定には、この前提変更を #105 本体で承認することが必要**（§5）。

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
| AWS 上の旧 origin（52.194.61.218 / 52.194.223.15） | **不達**（22/443 閉塞、522） | 不可。ホストが応答しない |
| `tastile-beta-postgres...rds.amazonaws.com` | **NXDOMAIN** | 不可。DB が存在しない |
| Infisical ホスト（157.180.90.160） | 稼働（secret 管理のみ） | 不可。Tastile アプリもアプリ DB も無い |
| Windows `UUU` / WSL | 稼働（開発端末） | 不可。`wslc ps` 0 件、Tastile 常駐なし |
| Muse（Tailscale 端末） | オンラインだが全 port 閉塞 | 不可 |
| 検証スタック（`tastile-verify-*`, Colima） | 稼働（本作業で構築） | **正本ではない**（#105 §1 が明示） |

**結論: 運用スタックは現存しない。** 「所在不明」ではなく「旧所在が確定し、そこには何も無い」。
本作業環境から観測できなかった理由（台帳 §4）は、到達不能ではなく **origin 自体が消えている**ためである。

---

## 4. read-only 参照手段の扱い（G0 判断項目の書き換え）

#105 の G0 判断項目は「運用スタックの所在と read-only 参照手段を提示できるか」であった。本書は次を提示する。

1. **所在**: AWS 上の旧 EC2 origin（IP は §2）。現在は停止ではなく**削除済み**（#102）。
2. **read-only 参照手段**: 参照対象が無いため**確立しない**。代わりに、
   - Cloudflare DNS / tunnel / Worker route の **API 読み取り**（本作業で実行済み。以後も read-only で再取得可能）
   - Infisical / 端末の **read-only 棚卸し**（同上）
   を「運用境界の証拠を再取得する手段」として固定する。これは**アプリデータの参照手段ではない**。

したがって G0 の当該条件は「未提示」ではなく、**「提示した結果、正本が存在しないことが判明した」**へ変わる。
これは #105 の ACCEPT 条件を満たす方向には動かない。**計画前提の変更が必要**である。

---

## 5. #105 に対する含意（G0 判定に必要な承認）

#105 は次の 2 点を前提にしている。

- 「試用期間中の予定の正本は運用VMのみ」「朝の調査・境界通知・既存自動化はこの運用スタックの情報のみを読む」
- T14 / T15 は「認可された読取専用データ/匿名化 snapshot」で v1/v2 を比較する

運用スタックが存在しない以上、**この 2 前提は現状のままでは成立しない**。取り得る道は 3 つで、いずれも本人の判断を要する。

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
| 運用VMの正本保護が文書化されている | 未充足（観測できず） | **未充足（正本が不存在）。所在は確定。保護対象が無いこと自体は確認済み** |
| 未確認事項が隠れていない | 充足 | 充足（本書を追加） |

「所在が分からない」から「所在は分かったが、そこに正本が無い」への変化は、**G0 を PASS に近づけない**。
#105 のスコープ（実データでの shadow 試用）を維持するなら A が必要で、これは G0 の前提作業として追加される。

---

## 7. 未確認として残すもの

- Cloudflare R2 バケットの内容（token 権限外）。アプリ DB のバックアップが置かれていないかは未確認。
- AWS アカウントの現在の請求・残存 resource（`aws` CLI の session が失効。#102 の削除記録を超える確認はできていない）。
- 旧 origin 上のデータの最終バックアップの有無（ホストが応答しないため確認不能）。
- Muse / Android 端末のローカル DB に実予定が残っている可能性（端末は全 port 閉塞、アプリからの read-only 抽出経路なし）。

これらは「無い」と断定しない。**確認できていない**と記録する。
