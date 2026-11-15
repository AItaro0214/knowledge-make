---
name: knowledge-library
description: Use the external long-term knowledge library (kb CLI / knowledge-library MCP server) - search it at the start of a task that touches a known domain, read only the entries you need, and write back one-sentence conclusions after you learn something that will matter again. Also covers the manual maintenance checklist.
---

# Knowledge library

The library is a three-level store so you read little:

- L0 `catalog.json` - the domains (git, deploy, project-x, ...).
- L1 `domains/<domain>.json` - one-sentence **conclusions** per entry, not topic names.
- L2 `entries/<domain>/<nnnn>.md` - the body: context, evidence, how to apply.

A light model (the "selector") picks L0/L1 for you. You only see `id | claim` lines and open bodies on demand.

## When to search

Search **before** starting a task that touches a domain the library may know: a repo you have worked in before, a tool with known pitfalls (git, CI, a cloud provider, a framework), a recurring kind of job (release, migration, data export).

- MCP: `library_search({ task: "<what you are about to do>" })`
- CLI: `kb search "<what you are about to do>"`

Describe the task, not keywords: "add a Cloudflare Worker route that proxies to R2" ranks better than "cloudflare r2". Then `library_read` / `kb read <id>` only the entries whose claim changes what you would do. Do not read all of them.

Skip the search for tasks that are trivial or entirely inside this conversation's context.

## How to write a good entry

Write back when you learned something that would have saved time had you known it at the start: a non-obvious failure cause, a command sequence that works, a project convention, a decision and its reason.

The **claim** is the whole value. It is one sentence, in the shape **"When X, do Y because Z"**:

- Good: `When wrangler login runs in the background, run it in the foreground because the OAuth callback is never received.`
- Bad: `wrangler login notes` (a topic, not a conclusion)
- Bad: `Wrangler is a CLI for Cloudflare` (true, but changes nothing)

Rules:

1. One fact per entry. Two conclusions = two entries.
2. The body carries the evidence: what was tried, the error text, the fix, the date. Keep it under ~400 tokens.
3. Prefer **update** over new. The write guard shows similar claims first; if one of them is the same fact, update it (`--update <id>` / `mode: "update"`). If the old claim is now wrong, **supersede** it (`--supersede <id>` / `mode: "supersede"`) so the history stays. Only use `--new` / `mode: "new"` when the similar claims are genuinely different facts.
4. Set `confidence`: `verified` (reproduced or tested), `observed` (seen once), `hypothesis` (believed, not checked). Default is `observed`.
5. Set `source` when there is one: a file path, URL, ticket, or "conversation 2026-01-15".
6. Pick the domain yourself when you know it; use `--domain auto` / `domain: "auto"` to let the selector choose or propose one.

- MCP: `library_write({ domain, claim, body, tags, confidence, source })` - returns `similar` instead of writing when the guard fires; call again with `mode`.
- CLI: `kb add --domain <d> --claim "..." --body-file notes.md --tags a,b`

## Language and conventions

If `KNOWLEDGE_DIR/CONVENTIONS.md` exists, read it once before your first write in a session and follow it (which language claims and bodies are written in, tag style, domain naming). It overrides the examples here. Without it, write everything in English.

## After writing

Run `kb sync` (git add/commit/push in the data repo). That is the backup; nothing else does it. Use `kb sync --dry-run` to see what would be committed.

## Manual maintenance checklist

There is no automatic maintenance. Every few weeks, or when `kb stats` looks off:

- [ ] `kb stats` - any domain over 50 entries? Split it (`kb domain add`, then move entries by superseding into the new domain).
- [ ] Oldest entries: still true? Update the body and `confidence`, or supersede.
- [ ] Claims that read like topics instead of conclusions: rewrite with `kb update <id> --claim "..."`.
- [ ] `hypothesis` entries that have since been tested: promote to `verified` or supersede.
- [ ] Domains with a vague `scope`: tighten the sentence so the selector routes correctly.
- [ ] `kb sync` when done.
