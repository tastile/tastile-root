# NF04-R03 専用 Ubuntu 環境 準備計画 (root#143)

2026-11-28。前提調査は root#143 コメント（2026-11-24 実測）を正本とする。
D: ドライブ消失は確定済みで復旧を前提にしない（2026-11-25 追補）。本書はホスト実行が
可能になった時点の手順・権限・検証を具体化するものであり、実測値はホスト到達後に埋める。

## 1. 方式の確定

| 候補 | 判定 |
|---|---|
| Hyper-V VM | 不採用。`vmms`/`Get-VM` は管理者権限が必要で `basic` SSH では不可。ユーザー操作待ちになる |
| **専用 WSL2 distro** | 採用。管理者権限不要（`wsl --import` / rootfs import）。既存 dev WSL と別 distro で隔離。WSL2 自体が utility VM であり「既存無償仮想化」の要件を満たす |
| 既存 WSL の本番化 | 不採用。dev 環境と混在し隔離要件に反する |

## 2. 前提測定（ホスト到達後・read-only）

実行前に以下を記録し、#143 へ貼る:

```powershell
Get-CimInstance Win32_OperatingSystem | Select TotalVisibleMemorySize,FreePhysicalMemory
Get-CimInstance Win32_Processor | Select NumberOfLogicalProcessors
Get-PSDrive C | Select Used,Free
wsl --list --verbose
wsl --status
```

- C: の恒久的空き容量が逼迫している（2026-11-24 時点 ~60GB、最小 3.7GB まで低下した前歴あり）。
distro VHDX + image + DB volume の見積り（初期 40–80GB）に対して余力があるかを最初に判定する。
  足りなければ構成を縮小するか、追加費用なしの代替経路（別の既存無償仮想化、または #144 の
  Cloudflare 側受け皿の再検討）を #143 へ記録して停止する。
- 回線規約・ホスト常時稼働条件はユーザー確認事項として残す（自動復旧の SLA に関わる）。

## 3. 構築手順（管理者権限不要の範囲）

1. Ubuntu LTS の rootfs を入手し、専用ディレクトリ（例: `C:\WSL\tastile-prod\`）へ配置。
   VHDX は C: 上の専用 path に固定し、D: への参照を一切残さない。
2. `wsl --import tastile-prod C:\WSL\tastile-prod\rootfs <rootfs.tar>` で専用 distro を作成。
   既定 distro・既存 dev distro の設定は変更しない。
3. distro 内で `dockerd`（または rootless docker）を導入。systemd が使えない場合は
   distro 起動時の init スクリプトで dockerd を上げる。
4. `deploy/prod-stack`（`compose.yaml`）を専用 project 名で起動。DB/port/credential/
   通知先は `deploy/stacks.tsv` の `prod` 行どおり運用 SoT と完全分離する。
5. 公開経路は #144（Caddy + Cloudflare Tunnel Free）の確定後に接続。先に loopback で起動確認。

## 4. 運用 SoT への書込経路 0 の機械検証（AC）

「書込経路 0」を実測で示す検査を起動後に実行し、結果を #143 へ記録する:

- compose project / volume / network が `tastile-prod` 専用であり、運用 stack
  （`tastile` / Muse 管理下の PG 5433・API 31400 等）を参照する env・volume・network が
  存在しないことを `docker context` / `docker compose config` / env dump で確認。
- distro から運用 VM の loopback API（`127.0.0.1:31400`）・PG（`127.0.0.1:5433`）への
  到達経路が無いことを、distro 内からの接続試行（拒否されること）で実測。
  ※ WSL2 の loopback は Windows host と共有されるため、**port 分離だけでは不十分**。
  運用 port への bind が host 側 firewall / 別 namespace で塞がれることを確認するか、
  そもそも prod stack が運用 port を bind しないことを compose 設定で保証する。
- 通知先・外部送信先が検証用に限定されていること（誤通知 0）。

## 5. 自動復旧

- WSL2 distro は Windows 再起動で停止する。ユーザー権限で登録できる
  **Task Scheduler（ログオン時）** で `wsl -d tastile-prod -u root -- <起動コマンド>` を
  登録する案を第一候補とする（管理者不要）。
- distro 内 watchdog（dockerd / compose stack の死活監視と再起動）を併設する。
- 「自動復旧」の合格条件（RTO・対象障害範囲）は #141 / #165 の受入定義に合わせて確定する。

## 6. 必要権限の具体化

| 作業 | 権限 | 状態 |
|---|---|---|
| WSL2 distro 作成・dockerd・Task Scheduler | `basic` ユーザー権限で可（要実測） | ホスト到達待ち |
| C: 容量の恒久確保（不要ファイル整理・pagefile/hiberfil 調整） | 管理者またはユーザー判断 | ユーザー確認事項 |
| Hyper-V VM 経路 | 管理者 | 不採用（§1） |
| 公開 DNS / Tunnel / Access | #144 の承認境界 | 別 issue |

## 7. 現在のブロッカー

- device-windows（100.118.123.62）への SSH が本 agent 環境から timeout（2026-11-28 実測）。
  tailscale 接続またはホスト起動状態の確認が先決。
- 上記が解消すれば §2–§5 は `basic` SSH の範囲で実施可能。管理者権限が必要なのは
  §6 の容量・電源まわりのみで、VM 稼働自体の前提ではない。
