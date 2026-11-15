<!-- JA -->

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
| `KB_SELECTOR_MODEL` | `haiku` | model passed to `claude -p --model` |
| `KB_SELECTOR_TIMEOUT_MS` | `90000` | selector timeout; on failure falls back to keywords and says so on stderr |
| `KB_CLAUDE_BIN` | `claude` | path to the Claude Code binary |
| `KB_PREFILTER_LIMIT` | `200` | candidate lists longer than this are keyword-prefiltered before the selector sees them |

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
