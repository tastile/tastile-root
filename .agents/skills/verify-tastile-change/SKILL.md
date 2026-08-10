---
name: verify-tastile-change
description: Tastile の変更を PASS、DONE、GREEN、commit / merge / ship 可能と述べる直前に使用する。
---

# Tastile change verification

code を読んだ `REVIEWED` と、command と挙動を観測した `VERIFIED` を区別する。変更した
package に現在の実行証跡がなければ PASS と述べない。

## Routing

| 変更 | 読む正本と検証場所 |
| --- | --- |
| domain、API、schema | `tastile-core/v1/02`、`v1/10`、`v1/14`、core instruction |
| Rust handler、store、worker | `tastile-core/AGENTS.md`、`tastile-core/HARNESS.md` |
| Web | `tastile-web/AGENTS.md` |
| Android | `tastile-android/README.md` |
| Desktop | `tastile-desktop/CLAUDE.md` |
| workspace / infrastructure | `docs/HARNESS.md` |

各対象 Git root で `git status --short` と `git diff --stat` を実行し、報告された file list を
鵜呑みにしない。

## Binding evidence

- PostgreSQL: 到達可能な実 PostgreSQL を使う。接続不可時に return する test は SQL 挙動を
  証明しない。pass / fail / ignored 件数を観測する。
- Backend: daemon を起動し、影響 endpoint を実 request で確認する。
- Web UI: 実 browser で flow、live DOM、console、必要な screenshot を確認する。
- Android: JDK 17+、対象 device の current APK、source / APK timestamp を確認する。
- Rust: この host の Windows build は証跡にせず WSL / wslc で実行する。
- freshness: 過去の CI、cache、stale binary、implementer の要約を現在の証跡にしない。

## 出力

対象 child、各 check の `REVIEWED` / `VERIFIED`、command、exit code、決定的出力を記録する。
必須証跡が欠ける場合は `BLOCKED` と、次に必要な正確な command を示す。
