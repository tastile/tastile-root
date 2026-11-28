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

## 公開範囲

全 service は distro 内 loopback bind + WSL2 localhost forwarding のみ。
物理 LAN・tailnet からは到達不能。tailnet / 外部公開経路と DNS・証明書は
root#144 の決定待ち。
