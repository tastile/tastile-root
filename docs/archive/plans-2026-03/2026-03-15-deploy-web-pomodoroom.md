# Web版 Pomodoroom デプロイプラン

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Supabase マイグレーション適用 + Vercel デプロイで tastile.app を実動状態にする

**前提:** ビルド (`bun run build`) は成功済み。コードは完成している。

---

## Task 1: Supabase マイグレーション適用

Supabase Dashboard の SQL Editor で以下のマイグレーションファイルの内容を実行する。

**ファイル:** `tastile-web/supabase/migrations/20260315000001_add_execution_tables.sql`

**手順:**
1. https://supabase.com/dashboard にログイン
2. プロジェクト `cltymfzdhdnebazmayxd` を開く
3. SQL Editor に移動
4. 上記ファイルの SQL を貼り付けて実行
5. Table Editor で `segments` テーブルが作成されていること、`tiles` テーブルに `started_at`, `completed_at`, `estimated_minutes`, `priority`, `sort_order` カラムが追加されていることを確認

**代替 (CLI):**

```bash
cd tastile-web
npx supabase db push --linked
```

> Note: `supabase link` 済みの場合のみ。未リンクなら `npx supabase link --project-ref cltymfzdhdnebazmayxd` を先に実行。

**検証:**

```bash
# Supabase REST API で segments テーブルの存在確認
curl -s "https://cltymfzdhdnebazmayxd.supabase.co/rest/v1/segments?limit=0" \
  -H "apikey: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -w "\n%{http_code}"
```

Expected: 200 (空配列 `[]`)。404 なら未適用。

---

## Task 2: Vercel デプロイ

```bash
cd tastile-web
npx vercel --prod
```

**検証:**
1. デプロイ完了後、表示される URL にアクセス
2. `https://tastile.app/app/now` にログイン後アクセスできること
3. タイマー表示、タイル追加、BottomNav が表示されること

---

## Task 3: 動作確認チェックリスト

`https://tastile.app` にアクセスして以下を確認:

- [ ] `/app/now` — タイマー表示される、タイル追加できる、Start で タイマー開始
- [ ] `/app/now` — Complete でタイル完了、タイマーリセット
- [ ] `/app/timeline` — セグメントが24時間タイムラインに表示
- [ ] `/app/tiles` — フィルタ (All/Ready/Started/Done) 切り替え、編集・削除
- [ ] `/app/prompt` — フェーズに応じたプロンプトカード表示
- [ ] `/app/memo` — 既存機能が壊れていない
- [ ] BottomNav — 4つのタブ (Now/Timeline/Tiles/Memo) 遷移
- [ ] ブラウザ通知 — タイマー完了時に許可ダイアログ→通知

---

## ロールバック

問題が発生した場合:

**Vercel:** 前回デプロイに戻す
```bash
npx vercel rollback
```

**Supabase:** マイグレーション取り消し
```sql
DROP INDEX IF EXISTS idx_tiles_user_lifecycle;
ALTER TABLE public.tiles
    DROP COLUMN IF EXISTS started_at,
    DROP COLUMN IF EXISTS completed_at,
    DROP COLUMN IF EXISTS estimated_minutes,
    DROP COLUMN IF EXISTS priority,
    DROP COLUMN IF EXISTS sort_order;
DROP TABLE IF EXISTS public.segments;
```
