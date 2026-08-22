# ADR-0002: vendored schedule components React key fix

- 日付: 2026-08-19
- 状態: Accepted
- 対象: `tastile-web` の `src/lib/vendored/mantine-schedule`

## Context

`tastile-web` の schedule 系 view（`/dashboard/timeline`）で React 19 が console error
`Each child in a list should have a unique "key" prop` を出力していた。実測は以下 3 箇所。

- `YearViewMonth.tsx` day button: `{dayjs(date).format("D")}` と `<div ...yearViewDayIndicators>`
- `AgendaView.tsx` date group: `<Text ...agendaViewDateHeader>` と `{eventNodes}`
- `MobileMonthView.tsx` day button: `{dayjs(dayDate).format("D")}` と `<div ...mobileMonthViewDayIndicators>`

### 発生条件の確定（compiled chunk 調査による）

Turbopack の JSX transform は、**`key` / `ref` を持つ JSX element を
`createElement(type, { ..., children: [...] })` に compile する**（`jsxDEV` を使わない）。
この `createElement` 経路では props 内の `children` 配列が検証されず、配列内の
inline element child は `_store.validated` が立たない。React 19 の
`reconcileChildrenArray` → `warnOnInvalidKey` / `warnForMissingKey`
（`react-dom-client.development.js`）が key の無い element child を検出して警告する。
文字列 / 配列 child は対象外で、inline の element child だけが warning になる。

一方、key / ref を持たない element は `jsxDEV(type, props, key, true, ...)`
（`isStaticChildren=true`）に compile され、この経路は children 配列を逐次検証するため
warning が出ない。このため、Week view の all-day 領域、CurrentTimeIndicator、MoreEvents、
ScheduleHeaderBase 等の key / ref 無し親の inline children は対象外と確定した。

同構造は upstream `@mantine/schedule` にも存在し、本日時点で upstream fix は未確認である。

## Decision

1. vendored copy を最小変更する。発生が確定した 3 箇所の inline element child に stable な
   key（`"yearViewDayIndicators"` / `"date-header"` / `"day-indicators"`）を付与して
   warning を解消する。その他の view は compiled chunk 解析で warning が出ないことを確認し、
   変更しない。
2. upstream が同等の fix を出した時点で、ADR と合わせて vendored copy の対応を再評価する
   （vendored 差分の削減 or 残置）。この変更は upstream PR の代替であり、`AGENTS.md` の
   vendored 編集規約に従い本 ADR で記録する。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| 最小 key 付与 | 採用 | React の配列 children 規約に従う標準的修正。挙動変化なし |
| children を Fragment で包む | 不採用 | 構造変更を伴い、DOM 出力も変わるため diff が大きい |
| 発生確認済み 3 箇所以外へも予防的 key 付与 | 不採用 | compiled chunk 解析で warning が出ないことを確認済み。vendored 差分を増やすだけ |
| upstream PR 待ち | 不採用 | 現行 console に warning が残る。本変更は将来 revert 可能 |

## Consequences and re-evaluation

- warning は消え、各 view の DOM 構造は不変。
- `@mantine/schedule` の upgrade / re-vendor 時に upstream の対応と突き合わせ、差分を整理する。