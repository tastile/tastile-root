# perm — 常時稼働ホスト (tastile-perm WSL2 distro) 運用入口

root#143 / root#155 B1。compose overlay は `../compose.perm.yaml`、stack
registry は `../../stacks.tsv` の `perm` 行。ここに置くのは Windows ホスト側の
自動復旧 script のみ。

## perm-host-up.sh

専用 distro 内で実行する冪等 script。役割:

1. docker.service 起動（systemd / `restart: unless-stopped` で stack 復帰）
2. 現在の distro IPv4 を取得
3. Windows loopback portproxy（`127.0.0.1:13120→web:3120`、
   `127.0.0.1:13140→api:31470`）を現在 IP へ張り直す
   （WSL2 は再起動で IP が変わるため、起動のたびに更新が必要）
4. api `/v1/health` が 200 になるまで最大 180s 待機

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

portproxy の listenaddress は `127.0.0.1` 固定（Windows loopback のみ）。
tailnet / 外部公開経路と DNS・証明書は root#144 の決定待ち。変更する場合は
listenaddress を引数化するのではなく、#144 の構成確定後に別 commit で行う。
