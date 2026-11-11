---
id: adr.root.0018
status: Accepted
date: 2026-09-29
scope: tastile-core, tastile-web, tastile-android, tastile-desktop
relates: [adr.root.0010, adr.root.0017]
gated_by: [poc.email-provider]
---

# ADR-0018: Notification & email — 何をいつ知らせるかは Core、鳴らすのは client、push は hint、email は Resend

## Context

- product の差別化は「目覚ましのような強制力を全 task に働かせる」こと (core product 定義)。一方 server 側の work 処理は
  sweep 間隔 (≈ 60 秒) の遅延を持つ (ADR-0017)。
- Android は FCM を外し、`ExecutionAlarmPlanner` が dead JNI snapshot から alarm を計算している (通知 feed が機能していない)。
  Desktop は `PromptNotificationPolicy` / `PromptAutoActionPolicy` 等の local policy で決めている。thin client 原則に反する。
- Core の Delivery は外部 HTTP adapter (`TASTILE_DELIVERY_PROVIDER=http`, `/push` `/web-push` `/email`) を前提にしているが、
  adapter は実装されていない (core docs/production/delivery-provider-contract.md)。
- 認証 mail は AWS SES から送っているが、SES の production access は不承認で sandbox のまま (raw corpus 2026-06)。
  2026-09-22 に production sign-up が HTTP 500。

## Decision

1. **通知の意味 (何を・いつ・どの強度で) は Core が決める。** Core は client 向けに「通知予定」read model を提供し
   (schema は core 所有、oq.alert-schedule)、client はそれを OS の alarm / toast / 介入 window に写すだけにする。
   client 独自の通知 policy class は撤去対象。
2. **即時性は client の local OS 機能で担保する。** Android exact alarm、Windows toast / 介入 window。server の遅延に依存しない。
3. **push は wake-up hint。** Core worker が FCM HTTP v1 (runtime service account で認証、key file 無し) と Web Push (VAPID) を
   直接呼ぶ。payload は ID だけで state を含まない。client は受信後 Sync + Read で正を取得する。外部 delivery adapter は作らない。
4. **transactional email は Resend** (auth mail は web、Delivery email は core worker)。domain `tastile.app` に SPF / DKIM /
   DMARC を設定し、sending は `mail.tastile.app`。provider は mailer port の背後に置き交換可能にする。SES は retire。
5. email / push の失敗は Decision / Session を再作成しない (core v1 Delivery 定義)。

## Alternatives considered

- **SES の再申請**: 不承認の理由が解消した evidence がなく、public launch の gate に不確実性を残す。
- **Cloudflare Email Service (sending)**: 同じ edge に集約できるが sending API は beta で deliverability 実績が乏しい (2026-04 比較記事)。
  poc.email-provider が失敗した場合の次候補とする。
- **server push を正本にする**: lost / duplicate / out-of-order に弱い。core v1 の「Push is not state SoT」に反する。

## Consequences

- Resend Free (3,000 / 月、100 / 日) で開始し、公開告知前に volume 見込みで Pro ($20) を判断する (deployment.yaml node.prod.email)。
- Firebase project は `tastile-prod` GCP project と同一にし、FCM を service account で呼べるようにする。
- Android の FCM 再導入、Desktop の local policy 撤去は ms.m5-clients。

## Verification

poc.email-provider (inbox placement ≥ 95%、p95 < 30 秒、DMARC pass) を ms.m4-web-staging の exit 条件にする。
