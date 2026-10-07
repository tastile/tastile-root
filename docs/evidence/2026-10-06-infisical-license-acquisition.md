# Infisical 本番セルフホストの license 取得経路

2026-10-06、公式資料のみを read-only で確認。問い合わせ・フォーム送信・決済・account変更は実行していない。

## 確認結果

- [公式 pricing](https://infisical.com/pricing) は self-hosting を Enterprise にのみ掲載し、Enterprise は個別価格・年払い・営業窓口への導線を示す。公開 minimum seats / self-hosted price / self-serve checkout は確認できない。
- Pro / Advanced の公開 identity 単価を、そのまま本番 self-hosted license の価格に使わない。custom roles は Advanced の機能だが、self-hosting の提供条件は別である。
- 既存の canonical risk と 2026-10-05 journal には、10月2日の公式 sales 返信「self-host Pro 最少10 identities、Cloud Pro 比で約30% premium、正式価格は email で提示不可」が記録されている。これは公開 Enterprise 表示とは別の個別商用案内であり、公開ページだけでその提案を不存在と判断しない。正式 quote・entitlement・license key は未取得で、両方を vendor に確認する必要がある。
- 有料プランの trial の案内はあるが、self-hosted Enterprise の trial key が自動発行される手順は公開 pricing から確定できない。
- [公式 self-hosted / air-gapped 案内](https://infisical.com/blog/infisical-update-march-2024) は Enterprise license / POC について support / 営業窓口への連絡を案内する。連絡は第三者への送信の明示的な許可を得てから行う。
- [導入 tag v0.165.15 の EE license](https://github.com/Infisical/infisical/blob/v0.165.15/backend/src/ee/LICENSE.md) の development/testing 例外と本番の有効な Enterprise license の条件を区別する。既存 ADR-0022 の overlay は dev/staging だけで、production の代替 entitlement ではない。
- [同 tag の entitlement code](https://github.com/Infisical/infisical/blob/v0.165.15/backend/src/ee/services/license/license-fns.ts) は `LICENSE_KEY` / `LICENSE_KEY_OFFLINE` を読み、entitlement が無ければ `rbac` / `secretsFolderRbac` を無効とする。

## 取得時に確定させる情報

1. 既存 self-hosted deployment / organization に対して発行され、v0.165.15 が検証できる license。公開 Enterprise / 既存個別 self-host Pro のどのSKUが必要な entitlement を満たすかを vendor に確認する。
2. production を含む custom project roles と secret folder/key condition に必要な `rbac` / `secretsFolderRbac` の entitlement。
3. POC key の production eligibility、期限、終了時の扱い。未確認の trial を本番の恒久 license としない。
4. 年額・最小 identity 数・利用条件・更新条件。未提示の費用を zero と推定しない。

本資料だけで license 取得・paid entitlement・production mutation を完了扱いにしない。現在の3 project設計を維持し、dev/staging の source/runtime 検証は継続する。
