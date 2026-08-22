# ADR-0003: i18n inline literal remediation across web / android / desktop

- 日付: 2026-08-22
- 状態: Accepted
- 対象: `tastile-web` / `tastile-android` / `tastile-desktop` の UI レイヤー
- 先行 ADR: `AGENTS.md` の「常時適用する不変条件」、各 child の AGENTS.md / README.md / CLAUDE.md

## Context

`AGENTS.md` には「UI レイヤーの inline literal を翻訳キー経由に統一する」旨の規約が横断的に
存在するが、各 child で実装が完全には遵守されていない。2026-08-22 の read-only 調査で以下の
規模を確認した（各 child の詳細は §「監査サマリ」参照）。

- tastile-web: 48 file に約 320 件の inline literal
- tastile-android: 30 file に約 90 行
- tastile-desktop: 13 file に 63 件 / 41 unique phrase

調査で発見した主要な drift:

1. **同じ意味の文言が複数 client で別 key / inline として並存** している。
   - 例: `"Cancel"` が web の `common.cancel` / android の `@string/common_cancel` /
     desktop の `Settings.CancelButton` に分散。さらに desktop は `CreateTile.CancelButton`
     でも重複定義。
   - 例: `"Mo"/"Tue"/"Mon"/"Tue"/"月"/"火"` (weekday label) が Android の
     `MonthCalendarScreen.kt`, `QuickCreateSheet.kt`, `SubpanelComponents.kt` の 3 file に
     重複、desktop の `DetailedBody.xaml` にも inline。
2. **既存 i18n bundle のキー命名規約が client ごとに不整合**:
   - web: `quickCreate.cancel` (lowerCamelCase + dot)、`panels.calendar.day`、`app.shell.*`、
     `marketing.*`、`system.account.*`、`features/dashboard.*` が混在
   - android: `quick_create_cancel` と `quickcreate_panel_schedule_*` が `features_quickcreate.xml`
     内で混在、`system_account` vs `app_account` の命名分岐
   - desktop: `Settings.CancelButton` (ピリオド) と `Settings_ManualAccent` (アンダースコア) の
     2 形式が併存、`Strings.Designer.cs` の `Strings.Get(name)` は両方を受理
3. **進行中の uncommitted work (WIP) が全 3 child にまたがって大量に存在する**:
   - web: marketing i18n buildout (`LocaleSwitcher`, `resolveMarketingLocale`,
     `SiteFooter.tsx` の footer.language 追加)
   - android: `QuickCreateSubpanels.kt` を 30+ subpanel file に分割 + workflow chip/menu の
     string resource 追加（8 locale 全てに同期反映）
   - desktop: `Views/CreateTileWindow.xaml.cs` の 960 行規模 refactor + 新 `Views/CreateTile/`
     directory への分割、`Strings.QuickCreate.*.resx` の 8 locale 整備
4. **既存 ADR-0002 で vendored copy の例外が確立**しているが、inline literal remediation の
   範囲・命名規約・reuse 方針は未確立。

このまま放置すると、各 client の翻訳 key drift が拡大し、translation memory 最適化が効かず、
locale 追加コストが線形に増える。

## Decision

### D-1. スコープ

UI レイヤーの inline literal を「翻訳キー経由に統一する」対象に限定する。view-model /
repository / data 層 / notification service 内部の文字列（`"Failed to load profile"` 等の
status message）は別 task（Compose UI 用の `String?` または `UiText` sealed class 化）で扱う。
スコープ境界は §「監査サマリ」のテーブルのみとする。

### D-2. 命名規約（client 毎）

各 client の既存流儀を尊重しつつ、新規追加分の形式を以下に固定する。既存 key の rename は
本 ADR の対象外（後続 ADR）。

| client | 形式 | 例 |
| --- | --- | --- |
| web | lowerCamelCase + dot ネスト | `quickCreate.relations.heading`、`panels.schedule.alerts.noTilesBody` |
| android | snake_case（`features_*.xml` / `system_*.xml` 内） | `quickcreate_panel_relations_heading`、`panels_schedule_alerts_no_tiles_body` |
| desktop | PascalCase + アンダースコア区切り | `QuickCreate_Panel_Relations_Heading`、`Panels_Schedule_Alerts_NoTilesBody` |

descriptor 部分の命名規則:
- `<domain>.<feature>.<element>.<role>` の 4 段を基本。例: `quickCreate.panel.relations.heading`
- `domain`: `common` / `app` / `panels` / `quickCreate` / `dashboard` / `marketing` / `system`
- `feature`: 機能名（`calendar`, `schedule`, `tasks`, `tiles`, `dashboard.*` 等）
- `element`: UI 構成要素名（`alerts`, `sections`, `table`, `nav`, `tabs` 等）
- `role`: 文の role（`title`, `body`, `label`, `placeholder`, `aria`, `tooltip`, `heading`,
  `description`, `empty`, `cta`, `submit` 等）

### D-3. パラメータ形式

| client | format | 例 |
| --- | --- | --- |
| web | ICU MessageFormat 互換（`{name}`, `{count}`） | `"{count} tasks"` |
| android | Android 標準（`%1$s`, `%1$d`） | `"%1$d tasks"` |
| desktop | .NET 標準（`{0}`, `{1}`） | `"{0} tasks"` |

複数 param の順序は web / android / desktop で揃える（数字昇順、UI の左→右 / 上→下の順）。

### D-4. Reuse policy（積極 reuse）

次の優先順位で既存 key を再利用する:

1. **意味が完全一致 → 既存 key を使う**。`common.cancel`, `common.save`, `common.delete`,
   `common.confirm`, `common.close`, `common.loading` を web / android / desktop 全箇所で使う。
2. **意味が近似 → 既存 key に寄せる**。`"Create"` (新規作成) と `"Save"` (保存) を
   区別が必要な場合のみ別 key。
3. **意味が client 固有 → client 専用の key を切る**。例: web 固有の marketing copy、
   desktop 固有の notification channel name。

新規 key は「既存 key で代替不能」なものだけ追加する。`t("...") || "fallback"` 形式で
fallback 文字列を書いている箇所は、key 値そのものなので **fallback を削除**する。

### D-5. Locale coverage（全 locale に MT 展開）

| client | locale |
| --- | --- |
| web | en, ja, zh-CN, ko, es（5 locale） |
| android | en (default), ja, zh-CN, ko, es, de, fr, pt-rBR（8 locale） |
| desktop | en (default .resx), ja, zh-CN, ko, es, de, fr, pt-BR（8 locale） |

新規 key は全 locale に値を追加する。MT（機械翻訳）は web であれば Google Translate 等の
generic MT で初期展開し、translation memory の整備は別 task。`tastile-desktop` の既存
`scripts/translate-quickcreate.ps1` と同じ形式で per-locale map を生成する。

### D-6. WIP 競合の取り扱い

各 child の uncommitted work と重なる file は本 ADR のスコープから除外し、所有者の commit /
stash 後に着手する。これは `AGENTS.md` の「同一 file の並列編集禁止」に従う。

#### WIP-blocked files（2026-08-22 時点、`git diff --name-only` ベース）

**tastile-web**:
- `src/app/auth/shell.tsx`
- `src/app/download/page.tsx`
- `src/app/marketing-layout.test.tsx`
- `src/app/page.tsx`
- `src/app/pricing/page.tsx`
- `src/shared/i18n/sections/marketing/marketing.ts` (footer.language)
- `src/shared/i18n/server-translations.ts`
- `src/shared/ui/SiteFooter.tsx` (LocaleSwitcher 統合)
- `src/lib/api/v1/openapi-generated.d.ts`（auto-generated, 対象外）

**tastile-android**:
- `app/src/main/java/app/tastile/android/MainActivity.kt`
- `app/src/main/java/app/tastile/android/core/designsystem/**` 配下（AppComponents,
  Background, Button, Card, IconButton, LoadingWheel, Navigation, Tabs, Tag, TopAppBar,
  ViewToggle, Theme, ThemeExtensions）
- `app/src/main/java/app/tastile/android/ui/mobile/sheets/quickcreate/**` 全 30+ file
  （QuickCreateSubpanels.kt の分割進行中）
- `app/src/main/java/app/tastile/android/ui/mobile/sheets/QuickCreateState.kt`,
  `QuickCreateSheetMobile.kt`, `TileEditSheet.kt`
- `app/src/main/res/values*/features_quickcreate.xml` 8 file
- `app/src/main/res/values/strings.xml`
- `app/src/main/java/app/tastile/android/data/**`, `notifications/**`, `ui/dashboard/*`,
  `ui/mobile/tabs/ExecuteScreen.kt`, `ui/mobile/tabs/ProjectsScreen.kt`
- `app/src/test/**`（テスト file、ADR のスコープ外）

**tastile-desktop**:
- `src/TastileDesktop/MainWindow.xaml(.cs)`
- `src/TastileDesktop/Models/CreateTileModels.cs`
- `src/TastileDesktop/Resources/Features/Strings.QuickCreate.*.resx` 6 file
- `src/TastileDesktop/Resources/System/Strings.Settings.*.resx` 5 file
- `src/TastileDesktop/Services/CreateTileParityResolver.cs`,
  `CreateTileWindowContractResolver.cs`
- `src/TastileDesktop/ViewModels/MainViewModel.cs`, `SettingsViewModel.cs`
- `src/TastileDesktop/Views/CreateTileWindow.xaml(.cs)`（960 行 refactor 進行中）
- `src/TastileDesktop/Views/SettingsWindow.xaml(.cs)`
- `src/TastileDesktop/Views/TilesWindow.xaml(.cs)`
- `src/TastileDesktop/Views/TimelineWindow.xaml`
- `tests/TastileDesktop.Tests/{SettingsLayoutTests, TilesWindowContractsTests,
  TimelineWindowLayoutTests}.cs`

#### WIP-unblocked files（本 ADR で着手可能）

**tastile-web**（40+ file）: `src/features/create-tile/ui/{Relation,FlowSequence,
PlacementRules,SourceWindow,Behavior,SourceGeneration}Panel.tsx`、`QuickCreate*.tsx`、
`TaskDefinitionEditorModal.tsx`、`EssentialRow.tsx`、`ConditionEditor.tsx`、
`RequiredTimePanel.tsx`、`QuickCreateHeader.tsx`、`QuickCreateSubmitButton.tsx`、
`SubmitBar.tsx`、`PanelErrorBanner.tsx`、`RecurringDetailsSubPanel.tsx`、
`EventDetailsSubPanel.tsx`、`TaskDetailsSubPanel.tsx`、`CreateProjectModal.tsx`、
`src/features/manage-{projects,tasks,schedule,settings}/ui/**`、
`src/features/execute-tile/ui/TimelineAxis.tsx`、
`src/features/view-notifications/ui/NotificationsMenu.tsx`、
`src/features/marketing/ui/{PricingTeaser,DemoSiteBanner,LocaleSwitcher,Manifesto}.tsx`、
`src/views/dashboard/{RuntimePage,QuotaPage,EventsPage,ApiExplorerPage,
BillingPage,AccountSettingsPage,GeneralPreferencesPage}.tsx`、
`src/widgets/{floating-header/ui/ExecutionControls,app-shell/ui/{Header,AccountMenu,
AppShell,TimelineAxis},side-tool-panel/ui/SideToolPanel}.tsx`、
`src/shared/ui/{SearchOverlay,SiteHeaderMobileNav,SecurityLockGate}.tsx`、
`src/app/auth/{signup,email,email/verify,confirm,desktop/complete}/page.tsx`、
`src/app/auth/mfa-setup-client.tsx`、
`src/app/app/{tiles,settings,prompt,execute}/page.tsx`、
`src/app/dashboard/{page,schedule,projects,tasks}/page.tsx`、
`src/app/not-found.tsx`、`src/app/{terms,privacy,tokushoho}/page.tsx`、
`src/tile/ui/{TileStatusIcon,TileCardCompact}.tsx`

**tastile-android**（15+ file）: `ui/profile/ProfileScreen.kt`、
`ui/dashboard/{DashboardCards,DashboardScreens,MonthCalendarScreen,
ManagementScreens,QuickCreateSheet}.kt`、
`ui/dashboard/components/{DurationPickerContent,HelpBadge,PickerDialogs}.kt`、
`ui/mobile/{MobileScaffold,MobileTopBar,SidePanelDrawerContent}.kt`、
`ui/mobile/EndpointsCatalog.kt`、
`ui/mobile/calendar/{MonthEventIndicator,MonthViewFrame}.kt`、
`ui/mobile/panels/timeline/*.kt`、`ui/mobile/account/TokensSheet.kt`、
`ui/now/NowScreen.kt`、`ui/avatar/AvatarLoader.kt`

**tastile-desktop**（5+ file）: `Views/InterventionWindow.xaml(.cs)`、
`Views/IntegrationsWindow.xaml(.cs)`、
`Views/CreateTile/{CreateTileHeader,Sections/*,Bodies/*}.xaml(.cs)` 配下

### D-7. 翻訳キー追加の実装順序

各 child で 6 tier に分割し、Tier 1 → Tier 6 の順で着手する。各 tier は 1 PR 単位で
commit 可能。

| Tier | 内容 | 想定新規 key 数（web / android / desktop） |
| --- | --- | --- |
| 1 | 既存 key 利用のみ（`\|\| "fallback"` 削除、既存 key への切替） | 0 / 0 / 0 |
| 2 | `common.*` 拡張（`refresh`, `creating`, `saving`, `continue`, `reset`）+ `system.execution.status.*` | ~7 / ~3 / ~3 |
| 3 | `panels.{schedule,projects,tasks}.*` 拡張 | ~30 / ~10 / 0 |
| 4 | `dashboard.{events,api,quota,runtime,billing}.*`（debug page 群） | ~50 / 0 / 0 |
| 5 | `quickCreate.{panel.relations,panel.flow,panel.placementRules,panel.sourceWindow,tab.*,subpanel.*}.*` | ~90 / ~25 / 0 |
| 6 | `app.auth.*` / `app.securityLock.*` / `marketing.*` / `legal.*` / `nav.*` / `system.preferences.*` | ~30 / ~10 / ~10 |

合計: 約 207 / 48 / 13 key。新規 key は各 client の bundle / .resx に追加し、5〜8 locale
全てに翻訳値を設定する。

### D-8. 検証

各 child で PR 完了時にその child の local gate を実行する:

- web: `bun run check` = lint:biome + lint + typecheck + knip + test:unit
- android: `./gradlew verify` + `./gradlew lintDebug` + `./gradlew testDebugUnitTest`
- desktop: `.\scripts\check.ps1`

UI 変更を含む PR は、tastile-web では実 browser screenshot を `.tmp/` に残す。translate
helper script（desktop `scripts/translate-quickcreate.ps1` 相当）の再生成結果が deterministic
であることを確認する。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| ADR で規約確定 → 非 WIP 着手 | 採用 | AGENTS.md の不変条件と整合。translation memory と key drift を最小化 |
| WIP 上書きを強行 | 不採用 | AGENTS.md の同一 file 並列編集禁止に違反。所有者の作業が破壊される |
| WIP 所有者の commit / stash 待ち | 不採用 | 待機時間が unbounded。並行着手できる箇所から先に進めたい |
| 命名規約を既存混在のまま流用 | 不採用 | key drift が拡大し、locale 追加コストが線形増加 |
| en / ja のみ実装、他は placeholder | 不採用 | user の選択（#5）に従い、全 locale MT を展開する |
| view-model / repository の status message まで含む | 不採用 | UI レイヤーのみに限定。`UiText` sealed class 化は別 ADR |
| decoration glyph（`✓`, `▶`, `○`, `·`, `›`, `▴` 等）も string resource 化 | 不採用 | glyph は invariant、locale 依存ではない。`AGENTS.md` の翻訳キー規約も該当せず、現状維持で OK |

## 監査サマリ

§「Context」の数字の根拠。2026-08-22 時点 read-only 調査。

| client | inline literal 件数 | 既存 key で再利用可 | 新規 key 必要 | 影響 file 数 |
| --- | --- | --- | --- | --- |
| tastile-web | ~320 | ~30 (~70 occurrences) | ~180 | 48 |
| tastile-android | ~90 行 | ~15 | ~50 + enum 構造変更 3 件 | ~30 |
| tastile-desktop | 63 / 41 unique | 44 | 13 (× 8 locale = 104 データ要素) | 13 |
| 合計 | ~470 | ~90 | **~243** | ~90 |

各 client の調査 file 一覧と inline literal テーブルは `tastile/.agents/notes/
i18n-inline-literal-audit-2026-08-22/` に保管（本 ADR には要約のみ記載）。重複・類似
literal で複数箇所に出現する reuse 統合候補は次の通り:

| literal / 意味 | 既存 / 新規 key | 出現 file |
| --- | --- | --- |
| `"Cancel"` | `common.cancel` (web, android, desktop 全て既存) | web: 7+ file / android: 2 / desktop: 1 |
| `"Loading..."` / `"Loading…"` | `common.loading` (既存) | web: 10+ / android: 数件 / desktop: 0 |
| `"Delete"` | `common.delete` (web, android) / `CreateTile.DeleteButton` (desktop) | web: 1+ / android: 1 / desktop: 1 |
| weekday label (`"Mo"`/`"月"`) | 新規 `calendar_weekday_short_*` (android) / 既存 `Timeline_WeekdayMon..Sun` (desktop) | android: 3 file / desktop: 1 |
| `"Daily"` / `"Weekly"` | `quickCreate.repeatDaily` / `repeatWeekly` (web, android 既存) | web: 1 / android: 1 |
| `"No projects yet."` | `@string/empty_projects_title` (android 既存) | android: 1 |
| `"Display Name"` | `@string/account_display_name_label` (android 既存) | android: 1 |
| `"Pro"` / `"Free"` | 新規 `account.subscription.planBadge.{pro,free}` (web) | web: 1 |
| `"${n} min"` duration suffix | 新規 `panels.schedule.units.minuteSuffix` (web) | web: 1 |
| `"${preset} min"` / `"${preset / 60} h"` | 新規 `CreateTile_DurationPresetMinutesFormat` / `HoursFormat` (desktop × 8 locale) | desktop: 1 |

## Consequences and re-evaluation

### 直接的な影響
- 新規翻訳 key 約 243 件、8 locale × 1 = 最大 1,944 データ要素の追加
- 各 child の i18n bundle / .resx の肥大化（+ 約 5〜20%）
- locale 切替時の UI 漏れが translation tooling で機械的に検出可能になる
- 進行中 WIP との衝突は所有者の commit / stash 後に解消

### トレードオフ
- 命名規約を client 毎の形式（lowerCamelCase vs snake_case vs PascalCase）に揃えると、
  cross-client translation memory 統合は引き続き手作業
- 既存 key の rename は含めないため、命名混在は残存
- 装飾 glyph（`✓`, `▶` 等）は invariant として残す方針のため、locale 切替時の見た目は
  client ごとに異なる可能性がある

### 再評価 trigger
- いずれかの client で translation tooling（BabelEdit, Lokalise, Crowdin 等）を導入する場合
- 新規 client（iOS, Mac）が追加され、命名規約を 4 client で揃える必要が出た場合
- WIP の QuickCreate subpanel 分割 / CreateTileWindow refactor が完了し、保留 file に
  着手可能になった時点で本 ADR の「WIP-unblocked files」リストを更新

### 関連 ADR
- ADR-0001: Project-local AI agent toolchain（agent loop / skill 構成）
- ADR-0002: vendored schedule components React key fix（vendor copy 例外）

### 関連 skill
- `.agents/skills/cross-repo-contract-check`: 本 ADR のような複数 child に跨る contract 変更
  に対する検証
- `.agents/skills/verify-tastile-change`: 各 child PR の commit / merge 直前に実行
