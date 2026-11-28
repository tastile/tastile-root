# NF04 恒久バックエンド構築記録（root#155 B0/B1, root#143）

2026-11-28 実行。root#155 の最新追補「稼働バックエンドを先に成立させる」B0/B1 を
実行した実測記録。外部公開・release→main・実運用切替・追加費用は対象外。

## 1. B0 — 現在の実稼働と版の確定

対象: 開発ホスト（Mac, darwin/arm64, colima）と常時稼働 Windows ホスト
（100.118.123.62, WSL2 Ubuntu 26.04 / amd64）。

| 対象 | 実測結果 |
| --- | --- |
| Mac docker daemon | 起動停止状態（colima "not running"）。`colima start` で復帰後、`restart: unless-stopped` の既存 stack が自動復帰 |
| Mac 受入 stack | `tastile-prod-acc` / `tastile-prod-https` が up。image は `tastile-core:fb9bb58a` / `tastile-web:a8463bd-prod-equiv`（arm64 ビルド） |
| Mac prod-acc DB | Core DB `tastile`（role `tastile_core`）と Auth DB `tastile_auth`（role `tastile_auth`）が分離済み。migration head = `V1_090__worker_wakeup_notify` |
| Mac prod-acc 認証 | Better Auth schema（`user` / `account` / `session` / `verification` / `twoFactor`）が Auth DB に適用済み。acceptance owner が多数登録済み |
| Mac API / Worker / Web | `GET https://api.localhost/v1/health` = 200、worker は drain loop 正常（failures 0）、web は healthy |
| Windows ホスト | `wsl --list -v` = Ubuntu 2（Running）。SSH 到達可（`device-wsl` = 2222、`device-windows` = 22222） |
| Windows WSL 内部 | CPU 8 / RAM 23 GiB（free 14）/ root fs 空き 858 GiB。docker 29.1.3 稼働中だが **compose plugin 未導入**（`docker compose` が無反応）。CI runner service のみ起動、tastile image は無し |
| Windows C: ドライブ | 空き 38 GiB（使用 93%）。RAM 空き 2.7 GiB |
| 恒久構成の暫定 | 既存 WSL は dev/CI 混在のため **専用 distro が必要**（root#143 §1） |

結論: 現時点の恒久稼働版は存在せず、Mac の prod-acc は旧候補の受入環境であること
を確認。Windows ホストが唯一の常時稼働候補で、専用 WSL2 distro を新設して
恒久バックエンドを立ち上げる。

## 2. B1 — 恒久バックエンドの構築

### 2.1 構成（正本: `deploy/prod-stack/compose.yaml` + `compose.perm.yaml`）

- compose project `tastile-perm`（`deploy/stacks.tsv` の `perm` 行）
- service: `db` (PostgreSQL 16) / `api` / `worker` / `web` / `caddy`
- DB: `tastile`（core role `tastile_core`）と `tastile_auth`（Better Auth role
  `tastile_auth`）を同一 cluster 内で別 DB・別 role に分離。host port は公開しない
- host port は loopback のみ: api `127.0.0.1:31470` / web `127.0.0.1:3120` /
  caddy `127.0.0.1:8080`・`8443`
- credential は `.tmp/perm/perm.env`（gitignored、専用 distro 内で生成）にのみ存在
- image は常時稼働ホストで native build した amd64 版
  （`tastile-core:fb9bb58a-amd64` / `tastile-web:a8463bd-perm-amd64`）

### 2.2 実行手順（実測済み）

1. 専用 WSL2 distro を作成:
   `wsl --import tastile-perm C:\WSL\tastile-perm C:\WSL\rootfs-noble.tar.gz --version 2`
   （rootfs: `cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz`）
2. distro 内で docker + compose plugin を導入し `systemd=true` を有効化
   （`/etc/wsl.conf`）。以後は `wsl -d tastile-perm` の起動で docker が自動起動
3. `tastile-root` を branch `155` で clone（専用 credential）
4. `.tmp/perm/perm.env` / `.tmp/perm/web.env` を distro 内で生成
5. image を `docker load` で投入
6. `scripts/stack.sh perm doctor` → `up -d db` → `run --rm api /app/migrate_run`
   → `up -d api worker` → `up -d caddy` → `up -d web`

### 2.3 隔離（root#143 AC「運用 SoT への書込経路 0」）

- ホストが Mac 受入 stack と別（物理的に別 machine）
- compose project / network / volume / container name が `tastile-perm` 専用
- DB は host port を持たない（internal network のみ）
- publish される host port は loopback のみ
- credential / DB / role が受入 stack と非共有

## 3. 結果（2026-11-28 実測）

### 3.1 稼働状態

compose project `tastile-perm` が専用 distro `tastile-perm`（WSL2, Ubuntu 24.04,
amd64）内で 5 service すべて healthy/up。

| 項目 | 実測値 |
| --- | --- |
| db | `postgres:16-alpine` up (healthy)。host port 非公開（internal network のみ） |
| Core DB | `tastile`（owner `tastile_core`）。migration head = `V1_090__worker_wakeup_notify` |
| Auth DB | `tastile_auth`（owner `tastile_auth`）。Better Auth 5 table（`user`/`account`/`session`/`verification`/`twoFactor`）適用済み。Core DB と role/credential 分離を `\du`・`\l` で確認 |
| api | `GET http://127.0.0.1:31470/v1/health` = 200。`https://api.localhost`（caddy 経由）= 200、`database: reachable`、`bridge_secret: present`、`version: 2.1.0`、`build_identity.commit_sha=fb9bb58a795552e43a6d669b5933eefbb17f4d17`（dirty=false, release build） |
| worker | `v1 worker booted; fill horizon = 768h` → drain `termination=Empty failures=0` を 5s 周期で継続。disk guard が `/guard/pgdata` と `/` を監視（free 183 GiB > min 4 GiB） |
| web | `https://app.localhost`（caddy 経由）= 200 (healthy) |
| caddy | `127.0.0.1:8080→80` / `127.0.0.1:8443→443`（distro 内 loopback）。`api.localhost`/`app.localhost` を network alias で caddy へ解決 |

### 3.2 版の固定

| 構成要素 | 固定値 |
| --- | --- |
| core image | `tastile-core:fb9bb58a-amd64` digest `sha256:7883fd66…`（`fb9bb58a` は `release-2-1-0` に含まれる merge commit） |
| web image | `tastile-web:a8463bd-perm-amd64` digest `sha256:1ce03c92…`（`a8463bd` は `release-1-1-0` に含まれる merge commit） |
| openapi | consumer は `tastile-openapi` の v4.0.0 pin（web#275 系の契約監査対象。perm stack は web image 同梱の生成型を使用） |
| repo | 専用 distro 内 `~/tastile/tastile-root`、branch `155`（PR #199） |

### 3.3 認証済み owner readback（実測）

1. `POST https://app.localhost/api/auth/sign-up/email`（Origin: `https://app.localhost`）→ 200、user `perm-owner@tastile-perm.invalid` 作成、session token 発行
2. `GET /api/auth/bridge?next=/dashboard` → 307、`tastile_api_token` / `tastile_uid` cookie 発行
3. `GET https://api.localhost/v1/tiles`（Bearer = bridge token）→ 200、owner の tile 一覧を返却（新規 owner に既定 tile 3 件が provision されることを確認）
4. DB 側: `v1_owner` = 1、`v1_tile` = 3、auth `user` = 1

### 3.4 再起動・停止での状態保持（最小実証）

- **distro 停止→起動**: `tastile-perm` distro は Stopped 状態から `wsl -d` 起動で docker.service（systemd, `is-enabled=enabled`/`is-active=active`）が自動起動し、`restart: unless-stopped` の全 container が自動復帰。health 再取得で db healthy / api 200 / web 200 を確認
- **worker 再起動**: `docker restart tastile-perm-worker` → `v1 worker booted` → drain `Empty failures=0` を再開。DB・既存データ（owner/tile）は volume `tastile-perm-pgdata` に保持
- **過渡障害の自己回復**: db 再起動中の `terminating connection` / DNS lookup 失敗は worker が cadence fallback で吸収し、db 復帰後に probe 失敗 0 件へ収束することをログで確認

### 3.5 host 側 port 公開

- WSL2 内: api `0.0.0.0:31470`、web `0.0.0.0:3120`（distro の NAT 内に閉じる）
- Windows: `netsh portproxy` で `127.0.0.1:13140→<wsl>:31470`、`127.0.0.1:13120→<wsl>:3120`（Windows loopback のみ）
- **到達性ギャップ（実測）**: Mac から `http://100.118.123.62:13140/v1/health` は timeout。tailnet 経由の client 到達には portproxy の listenaddress を Tailscale interface に追加するか `tailscale serve` が必要。domain/cert 方式は root#144 の公開経路と一体で決めるため、本 stack では loopback 公開に留めた
- **portproxy の connectaddress は WSL IP 依存**: WSL2 の IP は再起動で変わり得るため、恒久化には logon 時に WSL IP を解決して portproxy を更新する mechanism が必要（root#148 の配備/復旧に接続）

### 3.6 リソース・容量

- 専用 distro 内 root fs: 空き 183 GiB / 使用 2%
- Windows C: 残り約 13.9 GiB（VHDX 成長で逼迫気味。D: は依然不在のため VHDX 移行先なし。容量監視は root#152 へ）
- compose `deploy.resources.limits` で db 1.0cpu/2G、api 1.25/2G、worker 0.75/768M、web 0.5/1G、caddy 0.25/128M を設定済み（root#145 の上限実測対象）

### 3.7 残件（B1 の外側）

- distro 自動起動: 現状は `wsl -d` 呼出で初めて docker が上がる。Windows logon 時の自動起動（Task Scheduler 等）は root#143 準備計画 §自動復旧の残実装
- tailnet/公開経路での client 到達（§3.5）と DNS/domain/cert は root#144
- 隔離復元 drill（別ボリュームへの restore 検証）は root#146
- 監視・rollback・版管理の運用接続は root#147/#148/#153

