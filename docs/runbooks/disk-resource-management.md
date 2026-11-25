# ディスク資源管理 runbook

root#170。ホストのディスク枯渇再発を防ぐ恒久策。実測値は 2026-11-25 JST 時点。

## 実測容量（2026-11-25）

| ホスト | 容量 | 使用 | 空き | 主な consumer |
| --- | --- | --- | --- | --- |
| Mac（開発 host） | 460 GiB | Data 388–402 GiB | 16→32 GiB（変動大） | `~/work` 配下の複数 project、`~/Library` 38G、`~/.rustup` 9.4G、`~/.cache` 6.2G、tastile workspace 約 6.7G |
| WSL2 Ubuntu（`devnode-win-uuu-recreated`） | 1007 GiB | 110 GiB | 846 GiB | runner `_work` 計約 51G（core が 30G で最大）、`/var/lib/docker` 3.0G |
| Windows C: | 約 476 GiB | 約 475 GiB | **約 0.9 GiB（逼迫）** | Ubuntu `ext4.vhdx` 158 GiB（内側使用 110 GiB → compact で約 48 GiB 回収余地）、`wsl-swap.vhdx` 4 GiB、`C:\actions-runner-*` 計約 0.8G |
| Windows D: | 約 670 GiB | 約 670 GiB | 約 262 GiB | ユーザーデータ。**復旧を前提にしない** |

Mac の workspace 内 consumer（`scripts/disk-hygiene.sh report` で再計測可能）:

- `tastile-core/crates-v1/target` 約 2.1 GiB（`build/<pkg>/<hash>/` の stale fingerprint 含む）
- `.tmp` 約 1.7 GiB（うち `prod-pin` が大半。**保護対象**）
- `tastile-web/node_modules` 1.2 GiB、`.next` 約 0.9 GiB
- `acceptance/.tmp` 約 0.6 GiB

## 閾値（実測ベース）

| 閾値 | 値 | 根拠 |
| --- | --- | --- |
| 絶対下限（全チェック共通） | 2 GiB | これを下回ると OS・docker・DB が不安定化。`check-workspace.ps1 -MinFreeGB` 既定 |
| 重いビルド前の要求空き | 15 GiB | cargo target / next build / gradle の生成物ピークをカバー。`disk-hygiene.sh check` 既定、`TASTILE_MIN_FREE_GB` で変更可 |
| fingerprint stale 判定 | 24 時間 | 実行中ビルドを壊さないための mtime ガード。`--min-age-hours` で変更可 |
| `.tmp` 自動削除対象 | 30 日超 | `prod-pin` / `acceptance` / `prod-equivalent` は常に保護 |

## 使い方

```bash
# 容量と hotspot の一覧（読み取りのみ）
scripts/disk-hygiene.sh report

# 重いビルド前の fail-fast 確認（不足時 exit 2）
scripts/disk-hygiene.sh check                 # 15 GiB 要求
scripts/disk-hygiene.sh check --min-free-gb 30

# cargo stale fingerprint の dry-run / 削除
scripts/disk-hygiene.sh fingerprints           # dry-run
scripts/disk-hygiene.sh fingerprints --apply   # 最新 hash のみ残して削除
scripts/disk-hygiene.sh fingerprints --apply --min-age-hours 6

# .tmp の古い export 等の dry-run / 削除（保護名は常に skip）
scripts/disk-hygiene.sh tmp --older-than 30
scripts/disk-hygiene.sh tmp --older-than 30 --apply
```

- すべての削除系は **dry-run が既定**。`--apply` を明示した時だけ消す。
- `fingerprints` は cargo/rustc プロセス検出時に拒否する（`--force` で解除）。
  対象は `*/target/*/build/` 配下の `<pkg>/<16hex>` または `<pkg>-<16hex>` のみで、
  package ごとに **mtime が最新の 1 つだけ残す**。消しても correctness は壊れず、
  cargo が必要なら再生成する（容量と時間のトレードオフのみ）。
- `cargo clean` や cache 全削除を恒常策にしない。

## 週次 hygiene（Mac）

launchd で週 1 回、fingerprint と `.tmp` の安全な範囲だけを掃除する例:

```xml
<!-- ~/Library/LaunchAgents/com.tastile.disk-hygiene.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.tastile.disk-hygiene</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/rebui/work/tastile/scripts/disk-hygiene.sh</string>
    <string>fingerprints</string><string>--apply</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/Users/rebui/work/tastile/.tmp/disk-hygiene.log</string>
  <key>StandardErrorPath</key><string>/Users/rebui/work/tastile/.tmp/disk-hygiene.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.tastile.disk-hygiene.plist   # 登録
launchctl unload ~/Library/LaunchAgents/com.tastile.disk-hygiene.plist # 解除
```

手動でも同じコマンドを週 1 回実行すればよい。`docker system df` / `docker system prune` は
影響範囲が広いので自動化せず、逼迫時に手動で判断する（WSL 側は `ci-hygiene.timer` が既に週次実行）。

## 並列度の目安

| 処理 | 既定 | 変更 | 根拠 |
| --- | --- | --- | --- |
| cargo | コア数分 | `CARGO_BUILD_JOBS=N` | Mac はメモリ逼迫時に下げる。WSL runner は `ci.slice` の CPUQuota で既に制限済み |
| next build | コア数分 | `experimental.webpackBuildWorker` / `NEXT_PRIVATE_...` は非推奨 | `.next` は約 1 GiB/回。15 GiB floor で十分 |
| gradle | `org.gradle.workers.max` | `gradle.properties` | Android `verify` は RAM 主体。WSL では `ci.slice` 配下 |

原則: **並列度を上げる前に `disk-hygiene.sh check` を通す**。生成物のピークが
空き容量を食うので、容量 floor を割る並列度は設定しない。

## Windows / WSL の回収

### WSL runner `_work`（健全だが増加傾向）

- `ci-hygiene.timer`（週次）が `target/`・`node_modules/`・`.next/`・`DerivedData/` の
  7 日超を `_work` から削除済み。core の `_work` は約 30G と最大。
- 手動確認: `wsl.exe -d Ubuntu -u root du -sh /home/basic/actions-runner-*/_work`
- 手動実行: `wsl.exe -d Ubuntu -u root systemctl start ci-hygiene.service`

### Windows runner work dirs

- `C:\actions-runner-core` / `-desktop` / `-root` の `_work` は合計約 0.8G（2026-11-25）。
  Windows 側に `ci-hygiene` 相当は**未整備**。逼迫時は手動で:

  ```powershell
  Get-ChildItem C:\actions-runner-*\_work -Recurse -Directory -Filter target |
    ? { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Recurse -Force
  ```

  実行中 job を壊さないため、runner が idle の時だけ行う
  （`Get-Process Runner.Worker` が無いことを確認）。

### Ubuntu ext4.vhdx の compact（C: の最大の回収余地）

- 場所: `C:\Users\rebui\AppData\Local\wsl\{f6874aea-…}\ext4.vhdx`（158 GiB、内側使用 110 GiB）
- compact で **約 48 GiB** を C: に戻せる見込み。D: への移動は `D:\wsl\move.log` の
  先行試行が残っているが完了していない。**D: 復旧を前提にしない**。
- **safe window の条件**（すべて満たす時だけ実施）:
  1. 全 repo で in_progress / queued の workflow run が無い:
     `gh api "repos/tastile/<repo>/actions/runs?status=in_progress" --jq .total_count`
     を core / web / android / desktop / openapi / brands で確認し、queued も同様に 0。
  2. WSL runner が idle: `systemctl list-units 'actions.runner.*'` で active でも
     `Runner.Worker` が動いていないこと（`pgrep -af Runner.Worker`）。
  3. `wsl.exe --shutdown` 後に実施（実行中ジョブがあると vhdx がロックされ失敗する）。
- 手順:

  ```powershell
  wsl.exe --shutdown
  Optimize-VHD -Path "C:\Users\rebui\AppData\Local\wsl\{f6874aea-e002-4f78-8111-380999753689}\ext4.vhdx" -Mode Full
  # Optimize-VHD が無い環境では diskpart:
  #   select vdisk file="...\ext4.vhdx" / attach vdisk readonly / compact vdisk / detach vdisk
  ```

## 保護対象（削除しない）

- prod-equivalent stack: docker containers `tastile-prod-acc-*` / `tastile-acc-*`
- `.tmp/prod-pin`、`.tmp/acceptance`、`.tmp/prod-equivalent`（証跡・ピン留め）
- 未統合差分・未 push の branch worktree、リリース証跡
- `disk-hygiene.sh` の `tmp` は上記 basename を常に skip する

## トラブル時の順序

1. `scripts/disk-hygiene.sh report` で犯人を特定
2. `fingerprints` → `tmp` の dry-run → `--apply`
3. Mac: `~/Library/Caches`、Docker.raw、`~/work` の他 project を人間が判断
4. Windows C:: 上記 vhdx compact（safe window のみ）→ runner `_work` 手動掃除
5. それでも不足なら `check-workspace.ps1 -MinFreeGB 0` で floor を一時解除するのではなく、
   まず容量を作る。floor 解除は最終手段。
