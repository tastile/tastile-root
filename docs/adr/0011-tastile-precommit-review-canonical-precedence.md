# ADR-0011: 同一名 Agent Skill の canonical precedence と `.claude/skills/` thin adapter rule

- 日付: 2026-09-20
- 状態: Accepted
- 対象: Tastile root workspace および全 child repository の Agent Skill 配置 (`.agents/skills/`, `.claude/skills/`, `.codex/skills/`) と、同一 `name` を持つ Skill 間の precedence 解決
- 先行 ADR: [ADR-0001](./0001-agent-toolchain.md) (関連, root agent 構成), [ADR-0005](./0005-skills-and-mcp-extensions.md) (関連, Skills catalog 境界)
- 後続 ADR: なし
- canonical policy: [agent orchestration policy](../agent-orchestration.md) §1, §5

## Context

2026-08 〜 2026-09 の運用で、Agent Skill 配置に関する次の gap が顕在化した。

1. **canonical location が ADR で pin されていない**: ADR-0005 は Skills catalog
   と Codex role canonical を導入したが、Skill file 自体は全て `.agents/skills/<name>/SKILL.md`
   だけを扱い、Claude Code が読む `.claude/skills/<name>/SKILL.md` の位置づけを pin
   していない。`tastile-web/CLAUDE.md` および `tastile-web/AGENTS.md` は
   `[ADR-0011]` を back-reference しているが、`docs/adr/0011-*.md` が存在せず、
   broken pointer 状態が続いていた。
2. **`.claude/skills/` adapter の形状が統一されていない**: 2026-09 時点で
   `.claude/skills/` 配下の 8 Skill のうち 7 は thin adapter (canonical への pointer)
   だが、`react-doctor` のみ canonical と byte-for-byte 同形で重複している。Skill の
   正本性が失われ、canonical 側を編集しても adapter が追従しない事故が起きうる。
3. **同名 Skill が web と workspace の両方に存在する場合の precedence rule が未定義**:
   `.agents/skills/tastile-precommit-review/SKILL.md` は workspace 側にあり、
   `tastile-web/.agents/skills/tastile-precommit-review/SKILL.md` も同名で存在する。
   同一 agent 起動時にどちらが binding かが Skill 記述内で個別の "precedence" 注記
   (`.claude/skills/tastile-precommit-review/SKILL.md` の `## precedence (per recon
   audit 2026-09-12)`) で暫定的に運用されている。ADR 化されていないため、fresh agent
   や別 contributor が同じ衝突を再生成しうる。
4. **`tastile-web/AGENTS.md:18` の ADR 件数記述**: 「`../docs/adr/` 配下 11 件
   (Accepted)」と書かれているが、カタログは `0001` … `0010` の 10 件で 1 件不足して
   いた。本 ADR 採択で記述と実態が一致する。

これらを解決するため、Skill 配備と precedence を ADR で pin する。

## Decision

### D-1. canonical Skill location の固定

- **canonical location は `.agents/skills/<name>/SKILL.md` のみ**とする。`.codex/skills/`
  を含む他ディレクトリ配下に同名 Skill を canonical として複製しない。`.codex/`
  配下は Codex 固有の role / agent 設定 (`.codex/agents/*.toml`) の置き場であり、
  Skill 本体はここに置かない。
- **frontmatter `name:` はリポジトリ内で一意**とする。同一 `name` を 2 か所以上の
  canonical に置く場合は D-2 の precedence rule に従う。
- Skill 本文 (binding workflow) は必ず canonical に書き、adapter 側には書き写さない
  (canonical 編集時に adapter 追従漏れが発生するのを防ぐ)。

### D-2. `.claude/skills/` は thin adapter のみ

- Claude Code は `.claude/skills/<name>/SKILL.md` を `.agents/skills/<name>/SKILL.md`
  より優先して読む。`.claude/skills/` 配下には **必ず thin adapter** を置く。
- thin adapter の必須要件:
  1. canonical への pointer を本文に明示する (`canonical source: .agents/skills/<name>/SKILL.md` 等)。
  2. canonical の本文 (workflow / 判定基準 / コマンド) を **複製しない**。
  3. Claude Code 固有の framing (description メタデータ、起動 routing、cwd-based
     precedence 注記など) が必要なら、adapter 側に **明示的に区切ったセクション**
     で追加する。`## precedence` / `## web-specific additions` 等の見出しで
     canonical 内容と視覚的に分離する。
- canonical と `.claude/skills/` adapter が乖離した場合、adapter を canonical 側へ
 寄せて修復する (canonical が正本)。

### D-3. 同一 `name` Skill が複数 canonical に存在する場合の precedence

- 同一 `name` の Skill が `.agents/skills/` 配下の **異なる child repository** に
  存在しうる (例: `tastile-precommit-review` は workspace 側
  `../.agents/skills/tastile-precommit-review/SKILL.md` と web 側
  `tastile-web/.agents/skills/tastile-precommit-review/SKILL.md` の両方に存在)。
- precedence rule:
  1. 起動 agent の **cwd** が `tastile-web/` 配下にあるとき、web 側 canonical
     (`tastile-web/.agents/skills/<name>/SKILL.md`) を binding とする。
  2. cwd が root workspace または `tastile-core/` / `tastile-desktop/` /
     `tastile-android/` / `tastile-brands/` 配下のときは、workspace 側 canonical
     (`../.agents/skills/<name>/SKILL.md`) を binding とする。
  3. orchestration layer (`.agents/skills/subagent-coordination/SKILL.md`) が同名を
     発見した場合、cwd-based rule を優先ルートとし、他方を補助参照として扱う。
- 同一 `name` が **同一 child repository 内** で重複して存在してはならない
  (`.agents/skills/<name>/SKILL.md` と `.claude/skills/<name>/SKILL.md` のペアは
  D-2 の adapter / canonical 関係のみ許可)。

### D-4. Skill 配置と precedence の repair pattern

- 既存 Skill のうち、`.claude/skills/<name>/SKILL.md` が canonical と乖離している
  場合は次の順で修復する:
  1. canonical 側 (`./agents/skills/<name>/SKILL.md`) を正本として確定する。
  2. adapter 側を thin pointer 形に置換する。web 固有追加は `## web-specific
     additions` 等の限定セクションに移す。
  3. 検証として `diff <canonical> <adapter>` が non-empty (delegate のみ) になる
     ことを確認する。
- 同一 `name` の canonical が複数 child に跨る場合、各 adapter / dispatch doc に
  precedence rule (D-3) を **必ず** 明示する。description メタデータで precedence
  を暗示しない (機械可読性が低下する)。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| D-1 + D-2 + D-3 を本 ADR で一括 pin | 採用 | gap 1〜3 を単一の決定で閉じ、broken pointer も同時解消。canonical 配置・adapter 形状・precedence の 3 観点を 1 ADR に閉じると freshness 検証と reviewer 負荷が小さい |
| `.claude/skills/` を廃止し canonical のみ参照 | 不採用 | Codex / Claude Code / Cursor 等の harness ごとに Skill 探索 path が異なるため、Claude Code 専用 adapter は引き続き必要。ADR-0005 §「Skills と MCP 拡張」の境界も維持される |
| Skill 探索に動的 resolver を入れる | 不採用 | host / harness ごとに探索 path が固定されており、外部 resolver を入れると harness 更新追従コストが増える。cwd-based precedence (D-3) で十分 |
| `.codex/skills/` を canonical として許可 | 不採用 | Codex 側 skill は role 設定 (`.codex/agents/*.toml`) と一体化しており、独立 canonical は役割重複。Codex 拡張が必要なら ADR-0005 §「Codex role」経路で別途扱う |
| Skill を完全廃止して docs/ 配下の prose に置換 | 不採用 | Skill メタデータ (`description`, `metadata`) による trigger 制御と lazy load が失われる。fresh agent の trigger 精度も低下 |

## Security、license、再現性

- thin adapter には secret、machine-specific path、private reasoning を含めない
  (ADR-0008 D-2 checkpoint と同じ secret / path 排除規則を適用する)。
- adapter の frontmatter は YAML 1.2 互換 (multi-line description は折り畳み可)。
  Harness による YAML 差 parse を避けるため、複雑な構造体は本文側に置く。
- Skill 自体の配置規則は repository 配下の file 配置のみに依存し、network /
  binary / container 等の外部依存を要求しない。fresh clone + Bun + ripgrep で
  検証可能。

## Consequences and re-evaluation

### 直接的な影響

- `tastile-web/AGENTS.md:18` の「11 件」記述が本 ADR 採択で実態と一致する。
- `tastile-web/AGENTS.md:34` と `tastile-web/CLAUDE.md:21, 25, 32, 96` の
  `[ADR-0011]` pointer が有効になる (CLAUDE.md の path 表現
  `../adr/0011-…` は別途 `../docs/adr/0011-…` へ repair する)。
- `.claude/skills/<name>/SKILL.md` のうち canonical と重複している adapter
  (2026-09 時点で `react-doctor`) は thin pointer 形に置換される。canonical 側を
  編集したときに追従漏れが起きなくなる。
- 同一 `name` Skill の precedence が cwd-based rule で pin され、orchestration
  layer (`.agents/skills/subagent-coordination/SKILL.md`) と reviewer はこの rule
  だけを信頼すればよくなる。

### トレードオフ

- canonical 編集時に `.claude/skills/<name>/SKILL.md` の **構造** (frontmatter) を
  いじると D-2 に抵触するため、adapter 形状の変更は別 commit / 別 ticket に分離
  する運用が前提となる。contributor の commit 粒度が細かくなる。
- cwd-based precedence (D-3) は host の `cwd` を信頼するため、agent が別 cwd で
  起動された場合に precedence が反転する。orchestration layer が cwd を明示するか、
  harness 設定で cwd を固定する運用が必要 (ADR-0008 D-5 recovery algorithm step 1
  と組み合わせる)。
- `.claude/skills/` が canonical と乖離していないかを定期検証する仕組みがない
  (現状は contributor の code review 依存)。weekly cron
  (`.github/workflows/recovery-drill.yml`) に `diff` 検証 step を追加するかは
  別 ADR で判断する。

### 再評価 trigger

- Claude Code / Cursor / Codex の Skill 探索 path 仕様が変更され、本 ADR の
  `.claude/skills/` 優先 rule が obsolete になったとき。
- `.codex/skills/` を独立 canonical として許可する要件が Codex 拡張で顕在化した
  とき (D-3 の scope を拡張する形で supersede)。
- 同一 child repository 内で同名 Skill が 3 つ以上出現する要件が生じたとき
  (canonical 配置の再設計が必要な兆候)。

### 関連 ADR / 関連 Skill

- [ADR-0001](./0001-agent-toolchain.md): root agent 構成 (Bun / ripgrep /
  Biome / Knip / Vitest 等)。本 ADR の canonical location (`.agents/skills/`) は
  ADR-0001 と整合する。
- [ADR-0005](./0005-skills-and-mcp-extensions.md): Skills catalog 境界。本 ADR は
  ADR-0005 が不問だった `.claude/skills/` 形状を補完する。
- [ADR-0008](./0008-structured-recovery-checkpoint.md): recovery 時に cwd-based
  precedence (D-3) を判断材料に含める。`active_children` の role 解決にも適用。
- `.agents/skills/subagent-coordination/SKILL.md`: orchestration layer として
  D-3 を発火条件付きで参照する first-party Skill。
- `.agents/skills/tastile-precommit-review/SKILL.md` (workspace 側) /
  `tastile-web/.agents/skills/tastile-precommit-review/SKILL.md` (web 側):
  D-3 の precedence rule 適用対象ペア。両 adapter (`.claude/skills/...`) は
  D-3 を必須記載する。
- `.agents/skills/plugin-version-audit/SKILL.md`: Skill 自体の pinned 依存
  (MCP / Bun / Node 等) を監査する。本 ADR は配置規則のみを扱い、依存
  freshness は plugin-version-audit の管轄。
