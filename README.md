# knowledge-make

[English](#knowledge-make-1)

## 日本語

Claude Code や Codex のようなコーディングエージェントに、外付けの長期記憶を持たせるための道具です。知識は分野ごとに3つの階層に分けて保存します。エージェントは、作業に関係する結論の数行だけを読みます。

| 階層 | ファイル | 中身 |
| --- | --- | --- |
| 大分類 | `catalog.json` | 分野の一覧と、それぞれの範囲 |
| 中分類 | `domains/<分野>.json` | 結論を1文で書いた見出し（「Xのときは、Zなので、Yする」） |
| 本文 | `entries/<分野>/<番号>.md` | 手順や細かい条件 |

`kb search "<作業の説明>"` を実行すると、軽量モデル（既定は `claude -p` 経由の Claude Haiku）が大分類から分野を選び、その分野の見出しから関係するものを選びます。メインのモデルに返るのは `id | 結論` の行だけで、本文は必要になったときに `kb read` で開きます。中分類の見出しを結論の文で書くのは、本文を開かなくても判断できるようにして、トークンを減らすためです。

書き込みは、似た結論がすでにあるかどうかを先に調べます。似たものが見つかると `kb add` は書き込みを止めるので、`--new`（別の知識として足す）、`--update <id>`（更新する）、`--supersede <id>`（置き換える）のどれかを選んでください。置き換えた古い項目はファイルに残りますが、検索には出ません。

データベースも、裏で動く定期処理もありません。保存先は自分で用意したgitリポジトリ（非公開をおすすめします）で、`kb sync` でコミットとpushを行い、これがバックアップになります。手入れは手作業で行う前提で、`kb stats` は項目の多すぎる分野や古い項目を一覧にするだけです。

中身を新しく保つための手引きは、LLM・エージェント向けに `docs/for-agents.md` にまとめました。入れる価値のある知識（学習の締め切り後の事実と、前の知識を書き換える事実）、重複を積まずに更新・置き換えする方法、出典の決まり、平日に自動で中身を足す手順の例（`examples/daily-update/SKILL.md`）を載せています。

導入の手順、コマンドの一覧、MCPサーバーの設定（Claude Code と Codex）は、下の英語の説明を見てください。

---


# knowledge-make

An external long-term knowledge library for coding agents (Claude Code, Codex, anything that speaks MCP).

Agents forget between sessions. This tool gives them a place to keep **conclusions** - "When X, do Y because Z" - and a cheap way to find the few that matter for the task at hand, so the main model reads little.

## How it works

Three levels, all plain files in a git repo of your own (`KNOWLEDGE_DIR`, default `~/knowledge`):

```
catalog.json               L0  domains            [{id,name,scope,count}]
domains/<domain>.json      L1  conclusions        [{id,claim,tags,updated,confidence,body_tokens,supersedes,superseded_by,source}]
entries/<domain>/<nnnn>.md L2  bodies             markdown
```

`kb search "<task>"` asks a light model (the *selector*, default Claude Haiku via `claude -p`) to pick domains from L0, then conclusions from L1. The main model receives only `id | claim` lines and opens bodies with `kb read`. With `--no-llm` (or `KB_SELECTOR=none`) a keyword/tag score is used instead.

Writes go through a similarity guard: `kb add` shows existing claims that look like the new one and refuses until you say `--new`, `--supersede <id>`, or `--update <id>`. Superseded entries stay on disk but are hidden from search.

There is no database and no background job. `kb sync` commits and pushes the data repo; `kb stats` is a manual maintenance aid.

## Install

Requires Node 24+.

```sh
git clone https://github.com/AItaro0214/knowledge-make
cd knowledge-make
npm install
npm link            # optional: puts `kb` and `kb-mcp` on PATH
```

Create the data repo (private is a good idea):

```sh
git clone <your-private-knowledge-repo> ~/knowledge
# or: mkdir ~/knowledge && git -C ~/knowledge init
export KNOWLEDGE_DIR=~/knowledge   # optional; this is the default
kb domain add git --name "Git" --scope "Branching, remotes, history rewriting, hooks."
```

The default selector runs `claude -p --model haiku`, so the [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI must be installed and logged in. Set `KB_SELECTOR=none` to run without it.

## CLI

```
kb search "<task>" [-k 8] [--no-llm]       conclusions relevant to a task (id | claim)
kb read <id...>                             body text
kb list [--domain d] [--tag t] [--confidence verified] [--since YYYY-MM-DD] [--limit n]
                                            headings filtered without any model
kb add --domain <d|auto> --claim "<one sentence>" --body-file <f>
       [--tags a,b] [--confidence verified|observed|hypothesis] [--source <s>]
       [--new | --supersede <id> | --update <id>]
kb update <id> [--claim ..] [--body-file ..] [--tags ..] [--confidence ..] [--source ..]
kb domains
kb domain add <id> --name <n> --scope <s>
kb stats                                    counts, domains over 50 entries, oldest entries
kb sync [--dry-run] [-m <message>]          git add -A / commit / push in KNOWLEDGE_DIR
```

`--json` prints machine-readable output for `search`, `read`, `domains`, `stats`. Exit code 2 means `add` was refused because similar claims exist.

Example:

```sh
kb add --domain git \
  --claim "When a push is rejected as non-fast-forward, fetch and rebase instead of force-pushing because teammates lose commits." \
  --body-file notes.md --tags push,rebase --confidence verified
kb search "my push to main got rejected"
# git/0001 | When a push is rejected as non-fast-forward, fetch and rebase ...
kb read git/0001
kb sync
```

## MCP server

`bin/kb-mcp.mjs` is a stdio MCP server with three tools:

| tool | purpose |
| --- | --- |
| `library_search` | `{task, k?, llm?}` -> `id \| claim` lines |
| `library_list` | `{domains?, tags?, confidence?, since?, limit?}` -> filtered `id \| updated \| confidence \| claim` lines, no model call |
| `library_read` | `{ids}` -> bodies |
| `library_write` | `{domain, claim, body, tags?, confidence?, source?, mode?, target?}` -> writes, or returns `similar` candidates when the guard fires |

### Claude Code

```sh
claude mcp add knowledge-library -s user -e KNOWLEDGE_DIR=$HOME/knowledge -- node /path/to/knowledge-make/bin/kb-mcp.mjs
```

Copy `skill/knowledge-library/` into `~/.claude/skills/` so Claude knows when to search and how to write entries.

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.knowledge-library]
command = "node"
args = ["/path/to/knowledge-make/bin/kb-mcp.mjs"]

[mcp_servers.knowledge-library.env]
KNOWLEDGE_DIR = "/home/you/knowledge"
```

Point Codex at `skill/knowledge-library/SKILL.md` from your `AGENTS.md`, or paste its "When to search" and "How to write a good entry" sections there.

## Environment

| variable | default | meaning |
| --- | --- | --- |
| `KNOWLEDGE_DIR` | `~/knowledge` | data repo |
| `KB_SELECTOR` | `claude` | `claude` or `none` |
| `KB_MAX_DOMAINS` | `3` | how many domains a search may open; only the headings of those domains are read |
| `KB_SELECTOR_MODEL` | `haiku` | model passed to `claude -p --model` |
| `KB_SELECTOR_TIMEOUT_MS` | `90000` | selector timeout; on failure falls back to keywords and says so on stderr |
| `KB_CLAUDE_BIN` | `claude` | path to the Claude Code binary |
| `KB_PREFILTER_LIMIT` | `200` | candidate lists longer than this are keyword-prefiltered before the selector sees them |

## For LLMs and agents

- [docs/for-agents.md](docs/for-agents.md): what to store, how to update instead of piling up, source rules, token habits, and a self-updating loop.
- [examples/CONVENTIONS.md](examples/CONVENTIONS.md): a house-rules file to copy into your `KNOWLEDGE_DIR`.
- [examples/daily-update/SKILL.md](examples/daily-update/SKILL.md): a scheduled update procedure (parallel light-model search with adjacent-field exploration, a strong-model editor, one-off deep dives).

## Writing good entries

See [skill/knowledge-library/SKILL.md](skill/knowledge-library/SKILL.md). The short version: one fact per entry, the claim is a conclusion sentence, prefer update over new, run `kb sync` after writing.

## Development

```sh
npm test              # node test/smoke.mjs (temp dir, no model calls)
node bin/kb.mjs --help
```

`lib/text.mjs` is the seam for a full-text prefilter (e.g. SQLite FTS5) if the library outgrows keyword scoring.

## License

MIT
