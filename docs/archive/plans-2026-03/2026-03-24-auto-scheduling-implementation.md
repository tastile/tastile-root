# 自動スケジューリング (再計算) 実装計画

## 概要

タスクの時間的配置を自動計算するシステム。再計算は「タイル絶対真」の次に必要な絶対的な単位。

## 優先順位 (高い順)

1. **時間固定タイル** - 開始・終了時間が固定 (@fixed_start, @fixed_end)
2. **定期タイル (時間固定)** - 定期だが時間が固定されている
3. **通常タイル (時間範囲あり、分割不可)**
4. **定期タイル (時間範囲あり、分割不可)**
5. **休憩タイル** - 自動生成、時間は固定されない
6. **通常タイル (時間範囲あり、分割可能)**
7. **通常タイル (最大化する)**
8. **通常タイル (分割可能)**

## 同一優先順位の処理

- スコアリングで決定
- recommend_next_tiles() を使用

## データ構造

### TemporalConditions (temporal.rs)
```rust
pub fixed_start: Option<DateTime<Utc>>  // 固定開始時刻
pub fixed_end: Option<DateTime<Utc>>    // 固定終了時刻
pub release_at: Option<DateTime<Utc>>   // 釋放時刻
pub due_at: Option<DateTime<Utc>>        // 期限
pub active_start: Option<DateTime<Utc>> // アクティブ開始
pub active_end: Option<DateTime<Utc>>   // アクティブ終了
```

### Tile分類

| 分類 | 条件 | 優先度 |
|------|------|--------|
| time_fixed | fixed_start.is_some() && fixed_end.is_some() | 1 |
| recurring_fixed | recurring.is_some() && time_fixed | 2 |
| non_split_time_range | time_range && !splittable | 3 |
| recurring_non_split | recurring && time_range && !splittable | 4 |
| break | semantic_role == Break | 5 |
| split_possible | splittable | 6-8 |
| maximize | objective_mode == MaximizeWithinInterval | 7 |
| regular_split | objective_mode == FinishOnce && splittable | 8 |

## 実装ステップ

### Step 1: 優先順位システムの基盤
- [x] recalculate() 関数の基本構造作成
- [x] 休憩タイル自動生成 (基本)
- [x] Tile分類関数作成
- [x] 優先順位ソート実装

### Step 2: temporal conditions 対応
- [ ] fixed_start/fixed_end 読み取り
- [ ] 时间冲突 检测
- [ ] 时间固定tile配置

### Step 3: 定期tile対応
- [ ] RecurrenceModel 读取
- [ ] 定期tile生成

### Step 4: スコアリング統合
- [ ] 同一優先順位でのスコアリング適用
- [ ] recommend_next_tiles() 联动

### Step 5: 完全テスト
- [ ] 单元测试
- [ ] 統合テスト
- [ ] Desktop確認

## 注意事项

- 再計算は以下の場合にトリガー:
  - タイル作成時
  - タイル開始/完了/先送り時
  - アプリ起動時
  - 定期tileの再生成時

- 競合解決:
  - 固定時間衝突 → プロンプトで通知
  - 優先度同じ → スコアリングで決定
