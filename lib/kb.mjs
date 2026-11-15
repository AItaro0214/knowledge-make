// Library operations shared by the CLI (bin/kb.mjs) and the MCP server (bin/kb-mcp.mjs).
import { spawnSync } from 'node:child_process';
import { Store, CONFIDENCE, estimateTokens, isDomainId, parseEntryId, today } from './store.mjs';
import { rankByKeywords, claimSimilarity } from './text.mjs';
import {
  getProvider, selectDomains, selectEntries, selectSimilar, proposeDomain, SelectorError,
} from './selector.mjs';

// Candidate lists longer than this are keyword-prefiltered before the selector sees them.
// This is the seam for an FTS prefilter later.
const PREFILTER_LIMIT = Number(process.env.KB_PREFILTER_LIMIT || 200);
const SIMILAR_MIN = 0.2;
const SIMILAR_MAX = 5;

export class SimilarClaimsError extends Error {
  constructor(similar) {
    super('similar claims exist; pass --new, --supersede <id>, or --update <id>');
    this.similar = similar;
  }
}

export class KB {
  constructor({ dir, provider, warn = (m) => process.stderr.write(m + '\n') } = {}) {
    this.store = new Store(dir);
    this.provider = provider || getProvider();
    this.warn = warn;
  }

  // ----- read side -----

  async search(query, { k = 8, llm = true } = {}) {
    await this.store.ensureLayout();
    const catalog = await this.store.readCatalog();
    const useLlm = llm && this.provider.available();
    if (!useLlm) {
      const all = await this.store.readAllEntries();
      return rankByKeywords(query, all, k).map(brief);
    }
    try {
      let domainIds = catalog.map((d) => d.id);
      if (catalog.length > 1) {
        domainIds = await selectDomains(this.provider, query, catalog, { max: 3 });
        if (!domainIds.length) return [];
      }
      let candidates = [];
      for (const d of domainIds) {
        const entries = await this.store.readDomain(d);
        for (const e of entries) if (!e.superseded_by) candidates.push({ ...e, domain: d });
      }
      candidates = prefilter(query, candidates);
      if (!candidates.length) return [];
      const ids = await selectEntries(this.provider, query, candidates, { k });
      const byId = new Map(candidates.map((e) => [e.id, e]));
      return ids.map((id) => brief(byId.get(id)));
    } catch (err) {
      if (!(err instanceof SelectorError)) throw err;
      this.warn(`selector failed (${err.message}); falling back to keyword search`);
      const all = await this.store.readAllEntries();
      return rankByKeywords(query, all, k).map(brief);
    }
  }

  async read(ids) {
    const out = [];
    for (const id of ids) {
      const { entry } = await this.store.findEntry(id);
      if (!entry) throw new Error(`no such entry: ${id}`);
      out.push({ ...entry, body: await this.store.readBody(id) });
    }
    return out;
  }

  // ----- similarity guard -----

  async similar(claim, { domain, llm = true } = {}) {
    await this.store.ensureLayout();
    const pool = domain
      ? (await this.store.readDomain(domain)).filter((e) => !e.superseded_by).map((e) => ({ ...e, domain }))
      : await this.store.readAllEntries();
    const scored = new Map();
    for (const e of pool) {
      const s = claimSimilarity(claim, e.claim);
      if (s >= SIMILAR_MIN) scored.set(e.id, { ...brief(e), score: Number(s.toFixed(2)), via: 'keyword' });
    }
    if (llm && this.provider.available() && pool.length) {
      try {
        const candidates = rankByKeywords(claim, pool, 40);
        const ids = await selectSimilar(this.provider, claim, candidates.length ? candidates : pool.slice(0, 40), { max: SIMILAR_MAX });
        const byId = new Map(pool.map((e) => [e.id, e]));
        for (const id of ids) {
          const prev = scored.get(id);
          scored.set(id, { ...(prev || { ...brief(byId.get(id)), score: 0 }), via: prev ? 'keyword+selector' : 'selector' });
        }
      } catch (err) {
        if (!(err instanceof SelectorError)) throw err;
        this.warn(`selector failed (${err.message}); similarity check used keywords only`);
      }
    }
    return [...scored.values()]
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, SIMILAR_MAX);
  }

  // ----- write side -----

  // mode: 'guard' (default: refuse when similar claims exist) | 'new' | 'supersede' | 'update'
  async add({ domain, claim, body, tags = [], confidence = 'observed', source = '', mode = 'guard', target, llm = true }) {
    await this.store.ensureLayout();
    claim = oneLine(claim);
    if (!claim) throw new Error('claim is required');
    if (!body || !body.trim()) throw new Error('body is required');
    if (!CONFIDENCE.includes(confidence)) throw new Error(`confidence must be one of ${CONFIDENCE.join(', ')}`);

    if (mode === 'update') {
      if (!target) throw new Error('update mode needs a target id');
      return this.update(target, { claim, body, tags, confidence, source });
    }

    const catalog = await this.store.readCatalog();
    let proposed = null;
    if (domain === 'auto') {
      if (!llm || !this.provider.available()) throw new Error('--domain auto needs a selector (KB_SELECTOR=claude)');
      const pick = await proposeDomain(this.provider, claim, catalog);
      if (pick.domain) domain = pick.domain;
      else { proposed = pick.new; domain = pick.new.id; }
    }
    if (!isDomainId(domain)) throw new Error(`invalid domain id: ${domain}`);
    if (!catalog.some((d) => d.id === domain)) {
      if (!proposed) throw new Error(`unknown domain: ${domain} (run \`kb domain add\` first)`);
      await this.addDomain(proposed);
    }

    if (mode === 'guard') {
      const similar = await this.similar(claim, { domain: proposed ? undefined : domain, llm });
      if (similar.length) throw new SimilarClaimsError(similar);
    }

    let supersedes = null;
    let oldRecord = null;
    if (mode === 'supersede') {
      if (!target) throw new Error('supersede mode needs a target id');
      const found = await this.store.findEntry(target);
      if (!found.entry) throw new Error(`no such entry: ${target}`);
      if (found.entry.superseded_by) throw new Error(`${target} is already superseded by ${found.entry.superseded_by}`);
      supersedes = target;
      oldRecord = found;
    }

    const id = await this.store.nextId(domain);
    const record = {
      id,
      claim,
      tags: normTags(tags),
      updated: today(),
      confidence,
      body_tokens: estimateTokens(body),
      supersedes,
      superseded_by: null,
      source: source || '',
    };
    await this.store.writeBody(id, body);
    const entries = await this.store.readDomain(domain);
    entries.push(record);
    await this.store.writeDomain(domain, entries);

    if (oldRecord) {
      // The superseded entry may live in another domain; its file stays, only the link changes.
      const { entries: oldEntries, entry, domain: oldDomain } = oldDomainReload(oldRecord, entries, domain);
      entry.superseded_by = id;
      await this.store.writeDomain(oldDomain, oldEntries);
    }
    return record;
  }

  async update(id, { claim, body, tags, confidence, source } = {}) {
    const { entries, entry, domain } = await this.store.findEntry(id);
    if (!entry) throw new Error(`no such entry: ${id}`);
    if (claim !== undefined) entry.claim = oneLine(claim);
    if (tags !== undefined) entry.tags = normTags(tags);
    if (confidence !== undefined) {
      if (!CONFIDENCE.includes(confidence)) throw new Error(`confidence must be one of ${CONFIDENCE.join(', ')}`);
      entry.confidence = confidence;
    }
    if (source !== undefined) entry.source = source;
    if (body !== undefined) {
      await this.store.writeBody(id, body);
      entry.body_tokens = estimateTokens(body);
    }
    entry.updated = today();
    await this.store.writeDomain(domain, entries);
    return entry;
  }

  // ----- domains -----

  async domains() {
    await this.store.ensureLayout();
    return this.store.readCatalog();
  }

  async addDomain({ id, name, scope = '' }) {
    await this.store.ensureLayout();
    if (!isDomainId(id)) throw new Error(`invalid domain id: ${id} (lowercase letters, digits, hyphens)`);
    if (!name) throw new Error('domain name is required');
    const catalog = await this.store.readCatalog();
    if (catalog.some((d) => d.id === id)) throw new Error(`domain exists: ${id}`);
    const d = { id, name, scope, count: 0 };
    catalog.push(d);
    await this.store.writeCatalog(catalog);
    await this.store.writeDomain(id, []);
    return d;
  }

  // ----- maintenance aid (manual only) -----

  async stats({ oversized = 50, oldest = 5 } = {}) {
    await this.store.ensureLayout();
    const catalog = await this.store.readCatalog();
    const all = await this.store.readAllEntries({ includeSuperseded: true });
    const live = all.filter((e) => !e.superseded_by);
    const byConfidence = {};
    for (const e of live) byConfidence[e.confidence] = (byConfidence[e.confidence] || 0) + 1;
    return {
      domains: catalog.length,
      entries: live.length,
      superseded: all.length - live.length,
      body_tokens: live.reduce((s, e) => s + (e.body_tokens || 0), 0),
      by_confidence: byConfidence,
      oversized: catalog.filter((d) => d.count > oversized).map((d) => ({ id: d.id, count: d.count })),
      oldest: [...live].sort((a, b) => String(a.updated).localeCompare(String(b.updated))).slice(0, oldest).map(brief),
    };
  }

  // ----- backup -----

  sync({ dryRun = false, message } = {}) {
    const dir = this.store.dir;
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
      return r.stdout;
    };
    const status = git('status', '--porcelain');
    const changes = status.split('\n').filter(Boolean);
    const summary = summarize(changes);
    if (!changes.length || dryRun) return { changes, summary, committed: false, pushed: false };
    git('add', '-A');
    git('commit', '-m', message || summary);
    let pushed = false;
    let pushError = null;
    try {
      git('push');
      pushed = true;
    } catch (err) {
      pushError = err.message;
    }
    return { changes, summary, committed: true, pushed, pushError };
  }
}

// ----- helpers -----

function brief(e) {
  return { id: e.id, claim: e.claim, domain: e.domain || parseEntryId(e.id)?.domain, confidence: e.confidence, tags: e.tags || [] };
}

function prefilter(query, candidates) {
  if (candidates.length <= PREFILTER_LIMIT) return candidates;
  const top = rankByKeywords(query, candidates, PREFILTER_LIMIT);
  return top.length ? top : candidates.slice(0, PREFILTER_LIMIT);
}

function oneLine(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function normTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
}

// When the superseded entry is in the same domain as the new one, reuse the freshly written list so
// the second write does not clobber the first.
function oldDomainReload(oldRecord, newEntries, newDomain) {
  if (oldRecord.domain === newDomain) {
    return { entries: newEntries, entry: newEntries.find((e) => e.id === oldRecord.entry.id), domain: newDomain };
  }
  return oldRecord;
}

function summarize(changes) {
  let added = 0, modified = 0, deleted = 0;
  const domains = new Set();
  for (const line of changes) {
    const code = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (code.includes('?') || code.includes('A')) added++;
    else if (code.includes('D')) deleted++;
    else modified++;
    const m = file.match(/^(?:entries|domains)\/([^/.]+)/);
    if (m) domains.add(m[1]);
  }
  const parts = [];
  if (added) parts.push(`${added} added`);
  if (modified) parts.push(`${modified} modified`);
  if (deleted) parts.push(`${deleted} deleted`);
  const scope = domains.size ? ` (${[...domains].sort().join(', ')})` : '';
  return `kb sync: ${parts.join(', ') || 'no changes'}${scope}`;
}
