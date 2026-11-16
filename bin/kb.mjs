#!/usr/bin/env node
// kb - CLI for the knowledge library. See `kb --help`.
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { KB, SimilarClaimsError } from '../lib/kb.mjs';
import { getProvider } from '../lib/selector.mjs';

const HELP = `kb - external long-term knowledge library for coding agents

Usage:
  kb search "<task>" [-k 8] [--no-llm]       conclusions relevant to a task (id | claim)
  kb read <id...>                             body text of entries
  kb add --domain <d|auto> --claim "<one sentence>" --body-file <f>
         [--tags a,b] [--confidence verified|observed|hypothesis] [--source <s>]
         [--new | --supersede <id> | --update <id>] [--no-llm]
  kb update <id> [--claim ..] [--body-file ..] [--tags ..] [--confidence ..] [--source ..]
  kb domains                                  list domains
  kb domain add <id> --name <n> --scope <s>   create a domain
  kb stats                                    counts, oversized domains, oldest entries
  kb sync [--dry-run] [-m <message>]          git add/commit/push in KNOWLEDGE_DIR

Env:
  KNOWLEDGE_DIR       data directory (default ~/knowledge)
  KB_SELECTOR         claude | none (default claude)
  KB_SELECTOR_MODEL   model for the claude selector (default haiku)
  KB_SELECTOR_TIMEOUT_MS, KB_CLAUDE_BIN, KB_PREFILTER_LIMIT

Exit codes: 0 ok, 1 error, 2 similar claims exist (add refused)
`;

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  k: { type: 'string', short: 'k' },
  'no-llm': { type: 'boolean' },
  domain: { type: 'string' },
  claim: { type: 'string' },
  'body-file': { type: 'string' },
  tags: { type: 'string' },
  confidence: { type: 'string' },
  source: { type: 'string' },
  new: { type: 'boolean' },
  supersede: { type: 'string' },
  update: { type: 'string' },
  name: { type: 'string' },
  scope: { type: 'string' },
  'dry-run': { type: 'boolean' },
  message: { type: 'string', short: 'm' },
  json: { type: 'boolean' },
};

async function main(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [cmd, ...rest] = positionals;
  if (o.help || !cmd) {
    process.stdout.write(HELP);
    return 0;
  }
  const kb = new KB({ provider: o['no-llm'] ? getProvider('none') : undefined });
  const llm = !o['no-llm'];
  const out = (x) => process.stdout.write(x + '\n');

  switch (cmd) {
    case 'search': {
      const query = rest.join(' ');
      if (!query) throw new Error('search needs a task description');
      const hits = await kb.search(query, { k: Number(o.k || 8), llm });
      if (o.json) out(JSON.stringify(hits, null, 2));
      else for (const h of hits) out(`${h.id} | ${h.claim}`);
      return 0;
    }
    case 'read': {
      if (!rest.length) throw new Error('read needs at least one id');
      const entries = await kb.read(rest);
      if (o.json) { out(JSON.stringify(entries, null, 2)); return 0; }
      entries.forEach((e, i) => {
        if (i) out('');
        out(`# ${e.id} | ${e.claim}`);
        out(`confidence: ${e.confidence}  updated: ${e.updated}${e.tags.length ? '  tags: ' + e.tags.join(', ') : ''}`);
        out('');
        out(e.body.trimEnd());
      });
      return 0;
    }
    case 'add': {
      if (!o.domain || !o.claim || !o['body-file']) throw new Error('add needs --domain, --claim, --body-file');
      const body = await fs.readFile(o['body-file'], 'utf8');
      const modes = [o.new && 'new', o.supersede && 'supersede', o.update && 'update'].filter(Boolean);
      if (modes.length > 1) throw new Error('use only one of --new, --supersede, --update');
      const mode = modes[0] || 'guard';
      try {
        const rec = await kb.add({
          domain: o.domain, claim: o.claim, body, tags: o.tags, confidence: o.confidence || 'observed',
          source: o.source, mode, target: o.supersede || o.update, llm,
        });
        out(`${mode === 'update' ? 'updated' : 'added'} ${rec.id} | ${rec.claim}`);
        return 0;
      } catch (err) {
        if (!(err instanceof SimilarClaimsError)) throw err;
        process.stderr.write('Similar claims already exist. Re-run with --new, --supersede <id>, or --update <id>:\n');
        for (const s of err.similar) process.stderr.write(`  ${s.id} | ${s.claim}  [${s.via}${s.score ? ' ' + s.score : ''}]\n`);
        return 2;
      }
    }
    case 'update': {
      const [id] = rest;
      if (!id) throw new Error('update needs an id');
      const patch = {};
      if (o.claim !== undefined) patch.claim = o.claim;
      if (o['body-file'] !== undefined) patch.body = await fs.readFile(o['body-file'], 'utf8');
      if (o.tags !== undefined) patch.tags = o.tags;
      if (o.confidence !== undefined) patch.confidence = o.confidence;
      if (o.source !== undefined) patch.source = o.source;
      const rec = await kb.update(id, patch);
      out(`updated ${rec.id} | ${rec.claim}`);
      return 0;
    }
    case 'domains': {
      const list = await kb.domains();
      if (o.json) out(JSON.stringify(list, null, 2));
      else for (const d of list) out(`${d.id} | ${d.name} | ${d.count} | ${d.scope}`);
      return 0;
    }
    case 'domain': {
      const [sub, id] = rest;
      if (sub !== 'add' || !id) throw new Error('usage: kb domain add <id> --name <n> --scope <s>');
      const d = await kb.addDomain({ id, name: o.name, scope: o.scope || '' });
      out(`added domain ${d.id} | ${d.name}`);
      return 0;
    }
    case 'stats': {
      const s = await kb.stats();
      if (o.json) { out(JSON.stringify(s, null, 2)); return 0; }
      out(`domains: ${s.domains}  entries: ${s.entries}  superseded: ${s.superseded}  body tokens: ${s.body_tokens}`);
      out(`confidence: ${Object.entries(s.by_confidence).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}`);
      out(`oversized (>50): ${s.oversized.map((d) => `${d.id}(${d.count})`).join(', ') || 'none'}`);
      out('oldest:');
      for (const e of s.oldest) out(`  ${e.id} | ${e.claim}`);
      return 0;
    }
    case 'sync': {
      const r = kb.sync({ dryRun: o['dry-run'], message: o.message });
      if (!r.changes.length) { out('nothing to sync'); return 0; }
      out('changes:');
      for (const c of r.changes) out(`  ${c}`);
      out(`commit message: ${o.message || r.summary}`);
      if (!r.committed) { out('dry run; nothing committed'); return 0; }
      out(r.pushed ? 'committed and pushed' : `committed; push failed: ${r.pushError}`);
      return r.pushed ? 0 : 1;
    }
    default:
      throw new Error(`unknown command: ${cmd}\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`kb: ${err.message}\n`);
    process.exit(1);
  },
);
