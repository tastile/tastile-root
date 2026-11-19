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
```

**restore リハーサルは必ず使い捨て DB で行う。稼働中の `tastile-verify-db`
に対して `pg_restore --clean` を実行してはならない** (`--clean` は既存
object を drop するため、検証中のデータを破壊する):

```bash
# 使い捨て DB を同一 server 上に作成してリハーサル
docker exec tastile-verify-db psql -U tastile -c "CREATE DATABASE restore_drill;"
docker exec -i tastile-verify-db pg_restore -U tastile -d restore_drill \
  --no-owner < /tmp/verify-db-YYYYMMDD.dump
docker exec tastile-verify-db psql -U tastile -d restore_drill \
  -c "SELECT count(*) FROM source_tiles;"   # 期待件数と照合
docker exec tastile-verify-db psql -U tastile -c "DROP DATABASE restore_drill;"
```

- credential は compose / Infisical 管理。dump ファイルに secret が
  含まれ得るため `/tmp` 以外に残さず、証跡へは件数・SHA のみ記録する
- G5 shadow 期間中は日次で backup を取得し、restore リハーサルは
  使い捨て DB で実施して手順を実測で確認する
- disk 整理で `docker system prune` / `docker volume prune` の
  **all 系・未使用一括削除は使わない**。他プロジェクトの container /
  volume / image を巻き込むため、対象を `docker ps -a` / `docker volume ls`
  で個別特定してから削除する

## 4. G5 shadow 比較基盤 (12/09–12/15、最低 7 暦日)

### 4-0. 2 種類の評価を分離する

| 区分 | 対象 | 目的 | 証拠力 |
|---|---|---|---|
| A. 合成 fixture 技術検証 | verify stack + authored fixture | diff harness・artifact・adapter の正しさ | 技術検証のみ。**運用置換可能性の証拠にしない** |
| B. 認可済み read-only 運用 shadow | Muse 運用 SoT の実データ (匿名化済み) | 実運用データでの v1/v2 差分の日次評価 | G5 の実質的判定材料 |

- A は既に T14 で実施済み (2026-11-19、5 case、deterministic)。
  verify stack だけを 7 日間動かした記録は B の代替にならない
- B は **Muse 運用 SoT を唯一の正本として保護したまま**、明示的な
  認可を得た範囲でのみ行う。書込み・restart・migration・通知は
  引き続き禁止

### 4-1. B (運用 shadow) の入力整備

実施前に以下を満たすこと。満たせない場合は B を開始せず A の
技術検証結果のみを報告する:

- **取得権限**: Muse 運用 SoT への read-only 接続について、データ
  所有者から書面 (Issue/PR コメント等) での明示的認可を得る。
  認可なしの接続・dump・複製は行わない
- **匿名化**: 比較に必要な最小限の field (recurrence 条件・期間・
  所要時間・件数) のみを抽出し、owner 識別子・tile 内容・個人情報を
  除去した派生 fixture として保存する。生データは SoT 側に残し、
  派生物のみを `tastile-web/docs/evidence/g5-shadow/` に置く
- **再現可能性**: 各日次記録に `core_sha` (verify image provenance)、
  fixture の SHA-256、実行日時、使用した diff harness の commit を
  記録し、同一入力で再実行できること
- **日次評価指標**: 日次 JSON に加えて、期間終了時に集計指標
  (match 率 / v2_input_gap 件数と内訳 / v1_period_boundary 件数 /
  unclassified 件数 / unsupported 件数 / v2 eval p50・p95 elapsed)
  をまとめたサマリを作成する

### 4-2. A/B 共通の実行構成

- 比較対象: verify stack (`127.0.0.1:31410`)。B の場合も v2 評価は
  verify web adapter 経由で行い、運用 stack のコードは変更しない
- v2 側: `POST /api/v2/scheduler/evaluate` (opt-in) を実行し、
  `status` / `occurrences` / `elapsed_ms` を記録
- v1 側: `GET /v1/timeline` / source-tile detail の materialized
  placement を同一 fixture で取得
- 分類: `docs/evidence/2026-11-19-t14-v1-v2-diff/` の
  `v2-v1-occurrence-diff.ts` 出力形式を再利用
  (match / v2_input_gap / v1_period_boundary / unclassified)
- `fullyExplained` はヒューリスティックであり PASS 根拠にしない
  (pagination 打切り・生成未完了・状態差を回帰なしと誤分類しない)

日次記録 (各日 1 ファイル、`tastile-web/docs/evidence/g5-shadow/YYYY-MM-DD.json`。
diff ハーネス `scripts/v2-v1-occurrence-diff.ts` と同じ repo に置く):

```json
{
  "date": "2026-12-09",
  "lane": "A-synthetic | B-operational-readonly",
  "core_sha": "<verify image provenance>",
  "fixture_sha256": "<anon fixture digest>",
  "authorization": "<B の場合は認可記録への参照>",
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
  fail-closed をそのまま使う。B の入力取得時のみ、認可された
  read-only 経路を別途明示して使う
- 最低 7 暦日 (12/09–12/15) の連続記録を維持する。途中欠測は
  欠測として記録し、後付けで埋めない

## 5. G3 物理受入 runbook

`docs/plans/2026-11-19-g3-device-acceptance.md` (root PR #125) が正本。
要点のみ:

- APK は OpenAPI v3.8.1 pin の android `release-0-7-0` 以降で再 build
  する (PR #125 記載の APK は v3.5.0 pin 時点のもので contract が古い)
- `adb reverse tcp:3000` / `tcp:31410` で verify stack に接続
- emulator 検証済み項目 (1–6, 8) は物理受入の PASS を意味しない。
  物理デバイスでの再実施が必須
- token revoke 回復 (項目 7) は未実施のまま
