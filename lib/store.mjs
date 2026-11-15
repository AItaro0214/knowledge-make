// Disk layout of the knowledge library (all paths relative to KNOWLEDGE_DIR):
//   catalog.json              [{id,name,scope,count}]
//   domains/<domain>.json     [{id,claim,tags,updated,confidence,body_tokens,supersedes,superseded_by,source}]
//   entries/<domain>/<nnnn>.md
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const CONFIDENCE = ['verified', 'observed', 'hypothesis'];
const DOMAIN_ID = /^[a-z0-9][a-z0-9-]*$/;
const ENTRY_ID = /^([a-z0-9][a-z0-9-]*)\/(\d{4})$/;

export function knowledgeDir() {
  return process.env.KNOWLEDGE_DIR || path.join(os.homedir(), 'knowledge');
}

export function isDomainId(id) {
  return typeof id === 'string' && DOMAIN_ID.test(id);
}

export function parseEntryId(id) {
  const m = typeof id === 'string' ? id.match(ENTRY_ID) : null;
  return m ? { domain: m[1], num: m[2] } : null;
}

export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export class Store {
  constructor(dir = knowledgeDir()) {
    this.dir = dir;
  }

  catalogPath() { return path.join(this.dir, 'catalog.json'); }
  domainPath(d) { return path.join(this.dir, 'domains', `${d}.json`); }
  entryPath(id) {
    const p = parseEntryId(id);
    if (!p) throw new Error(`invalid entry id: ${id}`);
    return path.join(this.dir, 'entries', p.domain, `${p.num}.md`);
  }

  async ensureLayout() {
    await fs.mkdir(path.join(this.dir, 'domains'), { recursive: true });
    await fs.mkdir(path.join(this.dir, 'entries'), { recursive: true });
    try {
      await fs.access(this.catalogPath());
    } catch {
      await writeJson(this.catalogPath(), []);
    }
  }

  async readCatalog() {
    return readJson(this.catalogPath(), []);
  }

  async writeCatalog(catalog) {
    await writeJson(this.catalogPath(), catalog);
  }

  async readDomain(domain) {
    if (!isDomainId(domain)) throw new Error(`invalid domain id: ${domain}`);
    return readJson(this.domainPath(domain), []);
  }

  async writeDomain(domain, entries) {
    if (!isDomainId(domain)) throw new Error(`invalid domain id: ${domain}`);
    await fs.mkdir(path.dirname(this.domainPath(domain)), { recursive: true });
    await writeJson(this.domainPath(domain), entries);
    await this.refreshCount(domain, entries);
  }

  // The catalog count only counts live entries (superseded ones stay on disk but are hidden).
  async refreshCount(domain, entries) {
    const catalog = await this.readCatalog();
    const d = catalog.find((x) => x.id === domain);
    if (!d) return;
    d.count = entries.filter((e) => !e.superseded_by).length;
    await this.writeCatalog(catalog);
  }

  async readBody(id) {
    return fs.readFile(this.entryPath(id), 'utf8');
  }

  async writeBody(id, text) {
    const p = this.entryPath(id);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, text.endsWith('\n') ? text : text + '\n', 'utf8');
  }

  async nextId(domain) {
    const entries = await this.readDomain(domain);
    let max = 0;
    for (const e of entries) {
      const p = parseEntryId(e.id);
      if (p) max = Math.max(max, Number(p.num));
    }
    return `${domain}/${String(max + 1).padStart(4, '0')}`;
  }

  // Every entry of every domain, each annotated with its domain record.
  async readAllEntries({ includeSuperseded = false } = {}) {
    const catalog = await this.readCatalog();
    const out = [];
    for (const d of catalog) {
      const entries = await this.readDomain(d.id);
      for (const e of entries) {
        if (!includeSuperseded && e.superseded_by) continue;
        out.push({ ...e, domain: d.id });
      }
    }
    return out;
  }

  async findEntry(id) {
    const p = parseEntryId(id);
    if (!p) throw new Error(`invalid entry id: ${id}`);
    const entries = await this.readDomain(p.domain);
    const entry = entries.find((e) => e.id === id);
    return { entries, entry, domain: p.domain };
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}
