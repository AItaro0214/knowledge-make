// Selector: a light model that picks domains (L0) and conclusions (L1) so the main model reads little.
//
// Provider interface: { name, available(): boolean, complete(prompt): Promise<string> }.
//   claude - spawns `claude -p --model <haiku> --output-format json`, prompt on stdin, stdin closed.
//   none   - never available; callers fall back to keyword ranking.
// Env: KB_SELECTOR (claude|none, default claude), KB_SELECTOR_MODEL (default haiku),
//      KB_SELECTOR_TIMEOUT_MS (default 90000), KB_CLAUDE_BIN (default "claude").
import { spawn } from 'node:child_process';

export class SelectorError extends Error {}

export function getProvider(name = process.env.KB_SELECTOR || 'claude') {
  switch (name) {
    case 'none':
      return noneProvider();
    case 'claude':
      return claudeProvider();
    default:
      throw new SelectorError(`unknown selector provider: ${name}`);
  }
}

function noneProvider() {
  return {
    name: 'none',
    available: () => false,
    complete: async () => {
      throw new SelectorError('selector "none" cannot complete');
    },
  };
}

function claudeProvider() {
  const bin = process.env.KB_CLAUDE_BIN || 'claude';
  const model = process.env.KB_SELECTOR_MODEL || 'haiku';
  const timeoutMs = Number(process.env.KB_SELECTOR_TIMEOUT_MS || 90000);
  return {
    name: 'claude',
    available: () => true,
    complete: (prompt) => runClaude({ bin, model, timeoutMs, prompt }),
  };
}

function runClaude({ bin, model, timeoutMs, prompt }) {
  return new Promise((resolve, reject) => {
    // A nested `claude -p` must not inherit the parent session's markers.
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const args = ['-p', '--model', model, '--output-format', 'json'];
    let child;
    try {
      child = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      reject(new SelectorError(`cannot spawn ${bin}: ${err.message}`));
      return;
    }
    let out = '';
    let errText = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new SelectorError(`selector timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (errText += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new SelectorError(`cannot spawn ${bin}: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new SelectorError(`${bin} exited ${code}: ${errText.trim().slice(0, 300)}`));
        return;
      }
      try {
        const parsed = JSON.parse(out);
        const text = typeof parsed.result === 'string' ? parsed.result : out;
        resolve(text);
      } catch {
        resolve(out);
      }
    });
    child.stdin.end(prompt);
  });
}

// Pulls the first JSON array or object out of free text. The model is told to answer with JSON only,
// but code fences or a leading sentence must not break us.
export function extractJson(text) {
  const s = String(text || '');
  const start = s.search(/[[{]/);
  if (start < 0) throw new SelectorError('selector answer contains no JSON');
  for (let end = s.length; end > start; end--) {
    const ch = s[end - 1];
    if (ch !== ']' && ch !== '}') continue;
    try {
      return JSON.parse(s.slice(start, end));
    } catch {
      // keep shrinking
    }
  }
  throw new SelectorError('selector answer is not valid JSON');
}

function validIds(answer, allowed, max) {
  const list = Array.isArray(answer) ? answer : Array.isArray(answer?.ids) ? answer.ids : null;
  if (!list) throw new SelectorError('selector answer is not an id array');
  const set = new Set(allowed);
  const seen = new Set();
  const out = [];
  // Light models sometimes drop the "domain/" prefix of an entry id; accept a bare number when it is unique.
  const bySuffix = new Map();
  for (const id of allowed) {
    const tail = String(id).split('/').pop();
    bySuffix.set(tail, bySuffix.has(tail) ? null : id);
  }
  for (let x of list) {
    if (typeof x !== 'string') continue;
    if (!set.has(x) && bySuffix.get(x.split('/').pop())) x = bySuffix.get(x.split('/').pop());
    if (!set.has(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (max && out.length >= max) break;
  }
  return out;
}

const RULES = 'Answer with a JSON array of ids only, each id copied exactly as listed (including any "domain/" prefix). No prose, no code fence. Return [] when nothing fits.';

// L0: which domains of the catalog could hold conclusions relevant to the task.
export async function selectDomains(provider, query, catalog, { max = 3 } = {}) {
  const lines = catalog.map((d) => `${d.id} | ${d.name} | ${d.scope} | ${d.count} entries`).join('\n');
  const prompt = `You route a task or question to the knowledge domains most likely to hold relevant conclusions. Domains can be about software, tools, projects or any research field.
Pick at most ${max} domain ids. ${RULES}

TASK:
${query}

DOMAINS (id | name | scope | size):
${lines}`;
  const answer = extractJson(await provider.complete(prompt));
  return validIds(answer, catalog.map((d) => d.id), max);
}

// L1: which conclusions the main model should actually read for this task.
export async function selectEntries(provider, query, candidates, { k = 8 } = {}) {
  const lines = candidates.map((e) => `${e.id} | ${e.claim}`).join('\n');
  const prompt = `You select the conclusions an AI agent should know before doing the task or answering the question below.
Pick at most ${k} ids, most relevant first. Only pick conclusions that would change or inform the work or the answer. ${RULES}

TASK:
${query}

CONCLUSIONS (id | claim):
${lines}`;
  const answer = extractJson(await provider.complete(prompt));
  return validIds(answer, candidates.map((e) => e.id), k);
}

// Similarity guard: which existing conclusions say the same thing (or contradict) the new claim.
export async function selectSimilar(provider, claim, candidates, { max = 5 } = {}) {
  const lines = candidates.map((e) => `${e.id} | ${e.claim}`).join('\n');
  const prompt = `A new conclusion is about to be added to a knowledge library.
List the ids of existing conclusions that state the same fact, a narrower/wider version of it, or contradict it.
Pick at most ${max}. ${RULES}

NEW CLAIM:
${claim}

EXISTING (id | claim):
${lines}`;
  const answer = extractJson(await provider.complete(prompt));
  return validIds(answer, candidates.map((e) => e.id), max);
}

// `kb add --domain auto`: pick an existing domain or propose a new one.
export async function proposeDomain(provider, claim, catalog) {
  const lines = catalog.map((d) => `${d.id} | ${d.name} | ${d.scope}`).join('\n');
  const prompt = `Choose the knowledge domain for the conclusion below.
Answer with JSON only, one of:
  {"domain":"<existing id>"}
  {"new":{"id":"<lowercase-kebab-id>","name":"<short name>","scope":"<one sentence on what belongs here>"}}
Prefer an existing domain. Propose a new one only when none fits.

CLAIM:
${claim}

DOMAINS (id | name | scope):
${lines || '(none yet)'}`;
  const answer = extractJson(await provider.complete(prompt));
  if (answer && typeof answer.domain === 'string' && catalog.some((d) => d.id === answer.domain)) {
    return { domain: answer.domain };
  }
  const n = answer?.new;
  if (n && typeof n.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(n.id) && typeof n.name === 'string') {
    return { new: { id: n.id, name: n.name, scope: String(n.scope || '') } };
  }
  throw new SelectorError('selector did not return a usable domain');
}
