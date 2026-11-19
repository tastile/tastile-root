# G5 shadow 比較・検証環境運用 runbook (2026-11-20)

G5 (root #105) の 12/09–12/15 最低 7 日間 shadow 比較と、ローカル検証環境の
disk pressure / backup / 受入 runbook をまとめる。**Muse 運用 SoT への
書込み・再起動・設定変更・移行は一切行わない。** shadow は read-only 比較のみ。

## 1. 検証イメージ provenance

| 項目 | 値 |
|---|---|
| image | `tastile-core-verify:local` (`deploy/verify-stack/compose.yaml`) |
| build context | `TASTILE_CORE_DIR` 既定 `../../../tastile-core`、`TASTILE_CORE_TAG` で branch/SHA 固定可 |
| 既知の限界 | 2026-11-17 ビルドの image は `commit_sha:null`。G4 証跡は「image build 日付 + core release head `c581b189`/`0e6ecb2f` 時点の source」として保証範囲を限定済み |
| 推奨 | provenance が必要な受入では `TASTILE_CORE_TAG=<固定SHA>` で再 build し、`docker image inspect` の digest と共に記録する |

## 2. disk pressure 対策

実測: host disk 96–101% で Colima/containerd の `meta.db` I/O error により
`tastile-verify-db` が停止した (2026-11-19)。復旧は `colima restart`、
volume は無事だった。

予防:

- `docker system df` を定期確認。`docker builder prune` / 使わない
  image 削除で 20 GiB 以上の余裕を保つ
- `deploy/verify-stack/preflight.sh` が起動前に disk 残量を検査する。
  起動前に必ず実行する
- Colima の disk image 上限は `colima start --disk <GB>` で調整可能。
  検証専用 volume が肥大化した場合のみ `docker volume ls` で対象を
  特定してから対処し、**他環境の volume を消さない**

障害時:

1. `docker ps -a` で `tastile-verify-*` の状態確認
2. containerd meta.db I/O error → `colima restart` → `docker compose up -d`
3. DB volume は compose named volume で永続。restart でデータは残る
4. 復旧後 `curl http://127.0.0.1:31410/v1/health` と `docker compose ps` で確認

## 3. backup / restore

検証 DB の backup (PostgreSQL 18 系、`tastile-verify-db` @ 55432):

```bash
docker exec tastile-verify-db pg_dump -U tastile -Fc tastile > /tmp/verify-db-$(date +%Y%m%d).dump
# restore (検証環境のみ。運用 DB には絶対に向けない)
docker exec -i tastile-verify-db pg_restore -U tastile -d tastile --clean --if-exists < /tmp/verify-db-YYYYMMDD.dump
```

- credential は compose / Infisical 管理。dump ファイルに secret が
  含まれ得るため `/tmp` 以外に残さず、証跡へは件数・SHA のみ記録する
- G5 shadow 期間中は日次で backup を取得し、少なくとも 1 回 restore
  リハーサルを行って手順を実測で確認する

## 4. G5 shadow 比較基盤 (12/09–12/15、最低 7 日)

目的: v1 既定経路のまま、v2 advisory 結果と v1 materialization の
差分を**読み取り専用**で日次記録し、切替判断の証拠を集める。

構成:

- 比較対象: verify stack (`127.0.0.1:31410`) のみ。Muse/運用 stack
  (`31400` 系) には接続しない
- v2 側: `POST /api/v2/scheduler/evaluate` (opt-in) を verify web 経由で
  実行し、`status` / `occurrences` / `elapsed_ms` を記録
- v1 側: `GET /v1/timeline` / source-tile detail の materialized
  placement を同一 fixture で取得
- 分類: `docs/evidence/2026-11-19-t14-v1-v2-diff/` の
  `v2-v1-occurrence-diff.ts` 出力形式を再利用
  (match / v2_input_gap / v1_period_boundary / unclassified)
- `fullyExplained` はヒューリスティックであり PASS 根拠にしない
  (pagination 打切り・生成未完了・状態差を回帰なしと誤分類しない)

日次記録 (各日 1 ファイル、`docs/evidence/g5-shadow/YYYY-MM-DD.json`):

```json
{
  "date": "2026-12-09",
  "core_sha": "<verify image provenance>",
  "cases": [{ "name": "...", "v2_status": "...", "v1_in_range": 0,
              "v2_candidates": 0, "classification": "..." }],
  "notes": "..."
}
```

制約:

- shadow は **advisory のみ**。v2 候補を v1 materialization と混同・
  置換しない。unsupported (weekly/monthly/excluded_dates/window) は
  記録上も unsupported のまま残す
- Muse 運用 SoT への write / restart / migration / 通知は行わない
- 記録スクリプトは verify URL 必須・loopback のみ・運用 port
  (31400/31401/5432/5433) を拒否する `v2-v1-occurrence-diff.ts` の
  fail-closed をそのまま使う

## 5. G3 物理受入 runbook

`docs/plans/2026-11-19-g3-device-acceptance.md` (root PR #125) が正本。
要点のみ:

- APK は OpenAPI v3.8.1 pin の android `release-0-7-0` 以降で再 build
  する (PR #125 記載の APK は v3.5.0 pin 時点のもので contract が古い)
- `adb reverse tcp:3000` / `tcp:31410` で verify stack に接続
- emulator 検証済み項目 (1–6, 8) は物理受入の PASS を意味しない。
  物理デバイスでの再実施が必須
- token revoke 回復 (項目 7) は未実施のまま
