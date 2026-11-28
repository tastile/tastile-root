# perm — 常時稼働ホスト (tastile-perm WSL2 distro) 運用入口

root#143 / root#155 B1。compose overlay は `../compose.perm.yaml`、stack
registry は `../../stacks.tsv` の `perm` 行。ここに置くのは Windows ホスト側の
自動復旧 script のみ。

## perm-host-up.sh

専用 distro 内で実行する冪等 script。役割:

1. docker.service 起動（systemd / `restart: unless-stopped` で stack 復帰）
2. 旧 portproxy 設計の残存 rule（13120/13140）を削除
3. api `/v1/health` が 200 になるまで最大 180s 待機

公開モデル: api/web/caddy は distro 内 `127.0.0.1` に bind し、WSL2 localhost
forwarding が Windows host の `127.0.0.1` へ公開する（portproxy 不要）。
`https://app.localhost` / `https://api.localhost` は Windows 側で名前解決に
hosts entry が必要（管理者権限、#144/#148 で扱う）。API 直接利用は
`http://127.0.0.1:31470`。

### Task Scheduler 登録（ユーザー権限、要 Windows 側で 1 回）

```powershell
schtasks /create /tn "TastilePermUp" /sc onlogon /f `
  /tr "wsl -d tastile-perm -u root -- /root/tastile/tastile-root/deploy/prod-stack/perm/perm-host-up.sh"
```

distro 内の repo clone（`/root/tastile/tastile-root`）が `git pull` で本
script を取得していることが前提。手動実行も同じ経路で可能:

```powershell
wsl -d tastile-perm -u root -- /root/tastile/tastile-root/deploy/prod-stack/perm/perm-host-up.sh
```

## distro keepalive（必須・別経路）

WSL2 は最後の `wsl` client session が閉じると、distro 内に systemd
service と container が残っていても distro を poweroff する（実測:
session 終了から約 90 秒で `systemd-logind: The system will power off
now` → containerd/docker が全再起動し、全 case が一時的に 503 になった）。
distro 内の systemd unit だけでは防げないため、session を保持する Windows
側 task が必須。

`perm-keepalive.sh` / `tastile-perm-keepalive.service` を repo に置き、
distro へ導入する:

```bash
install -m 0755 perm-keepalive.sh /usr/local/bin/tastile-perm-keepalive
install -m 0644 tastile-perm-keepalive.service /etc/systemd/system/
systemctl enable --now tastile-perm-keepalive.service
```

service は docker 停止時の再起動（保険）を担うが、distro 生存の根拠は
下記 task が保持する `wsl` session である。

```powershell
schtasks /create /tn "TastilePermanentBackend" /sc onlogon /f `
  /tr "wsl -d tastile-perm -u root -- /usr/local/bin/tastile-perm-keepalive"
```

`TastilePermUp`（stack 復帰）と `TastilePermanentBackend`（session 保持）
の 2 task が揃って初めて logon 後の自律稼働になる。どちらか一方だけでは
不足: session が切れれば distro ごと落ち、session があっても host 再起動後は
stack が止まったままになり得る。

## Mac への private tunnel (tastile-perm-tunnel.service)

同一 tailnet 上の Mac から perm stack を使う開発経路。distro から Mac の
sshd へ reverse forward を張る（Mac 側 sshd の `AllowTcpForwarding` が
有効なため `-R` は通るが、Windows 側 sshd は direct-tcpip を拒否するため
`ssh -L` は使えない — 実測済み）。

- `127.0.0.1:13140` → distro `127.0.0.1:31470` (API, HTTP)
- `127.0.0.1:13120` → distro `127.0.0.1:3120` (web, HTTP)

前提（1 回だけ、秘密値は repo に置かない）:

1. Mac で専用鍵を生成し公開鍵を `~/.ssh/authorized_keys` へ追加:
   `ssh-keygen -t ed25519 -f ~/.ssh/tastile-perm-tunnel -N ""`
2. 秘密鍵を distro `/root/.ssh/tastile-perm-tunnel` (`chmod 600`) へ配置
3. unit を導入:

```bash
install -m 0644 tastile-perm-tunnel.service /etc/systemd/system/
systemctl enable --now tastile-perm-tunnel.service
```

注意:

- Mac 側で 13120/13140 が既に LISTEN されていると `ExitOnForwardFailure`
  で unit が再起動ループになる（旧 `ssh -L` 残骸が典型）。
- web を `http://127.0.0.1:13120` で開く場合、`BETTER_AUTH_URL` /
  cookie の Secure 前提と `app.localhost` origin が一致しないため
  sign-in 系の動作は保証しない。API/CLI/Desktop の data plane
  (`http://127.0.0.1:13140`) はそのまま使える。Web UI の正式経路は
  #144 の DNS/cert 決定待ち。
- tunnel は keepalive task の `wsl` session に依存する。session が
  切れれば distro ごと落ち、Mac 側の forward も切れる（unit の
  `Restart=always` は distro 生存中の ssh 切断のみをカバー）。

## 公開範囲

全 service は distro 内 loopback bind + WSL2 localhost forwarding のみ。
物理 LAN・tailnet からは到達不能。Mac への到達は上記 reverse tunnel
（tailnet SSH のみ、認証は専用鍵）のみ。tailnet / 外部公開経路と
DNS・証明書は root#144 の決定待ち。
