// Smoke test: temp KNOWLEDGE_DIR, no selector model. Run with `node test/smoke.mjs`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-smoke-'));
process.env.KNOWLEDGE_DIR = dir;
process.env.KB_SELECTOR = 'none';

const { KB, SimilarClaimsError } = await import('../lib/kb.mjs');
const kb = new KB({ warn: () => {} });

let step = '';
try {
  step = 'domain add';
  await kb.addDomain({ id: 'git', name: 'Git', scope: 'Branching, commits, remotes.' });
  assert.equal((await kb.domains()).length, 1);

  step = 'add';
  const a = await kb.add({
    domain: 'git',
    claim: 'When a push is rejected as non-fast-forward, fetch and rebase instead of force-pushing because teammates lose commits.',
    body: '# Rejected push\n\nRun `git fetch` then `git rebase origin/main`.\n',
    tags: ['push', 'rebase'],
    confidence: 'verified',
  });
  assert.equal(a.id, 'git/0001');

  step = 'similar guard';
  await assert.rejects(
    kb.add({
      domain: 'git',
      claim: 'When push is rejected non-fast-forward, fetch and rebase rather than force-push.',
      body: 'dup',
    }),
    (err) => err instanceof SimilarClaimsError && err.similar[0].id === 'git/0001',
  );

  step = 'add --new bypasses guard';
  const b = await kb.add({
    domain: 'git',
    claim: 'When committing generated files, add them to .gitignore because diffs become unreadable.',
    body: 'Generated files belong in .gitignore.',
    tags: ['gitignore'],
    mode: 'new',
  });
  assert.equal(b.id, 'git/0002');

  step = 'search (keyword fallback)';
  let hits = await kb.search('push rejected, should I force push?', { llm: false });
  assert.equal(hits[0].id, 'git/0001');
  hits = await kb.search('push rejected', { llm: true }); // provider none -> same path
  assert.equal(hits[0].id, 'git/0001');

  step = 'read';
  const [r] = await kb.read(['git/0001']);
  assert.match(r.body, /git rebase/);

  step = 'update';
  const u = await kb.update('git/0001', { body: 'New body.\n', tags: 'push,rebase,fetch' });
  assert.deepEqual(u.tags, ['push', 'rebase', 'fetch']);
  assert.match((await kb.read(['git/0001']))[0].body, /New body/);

  step = 'supersede';
  const c = await kb.add({
    domain: 'git',
    claim: 'When a push is rejected as non-fast-forward, rebase onto the remote branch because force-push drops teammates\' commits.',
    body: 'Superseding body.',
    mode: 'supersede',
    target: 'git/0001',
  });
  assert.equal(c.id, 'git/0003');
  assert.equal(c.supersedes, 'git/0001');
  const old = (await kb.read(['git/0001']))[0];
  assert.equal(old.superseded_by, 'git/0003');
  hits = await kb.search('push rejected', { llm: false });
  assert.ok(!hits.some((h) => h.id === 'git/0001'), 'superseded entry must be excluded from search');
  assert.ok(hits.some((h) => h.id === 'git/0003'));
  assert.equal((await kb.domains())[0].count, 2);

  step = 'stats';
  const s = await kb.stats();
  assert.equal(s.entries, 2);
  assert.equal(s.superseded, 1);

  step = 'files on disk';
  const domainJson = JSON.parse(await fs.readFile(path.join(dir, 'domains', 'git.json'), 'utf8'));
  assert.equal(domainJson.length, 3);
  await fs.access(path.join(dir, 'entries', 'git', '0003.md'));

  step = 'cli --help';
  const help = spawnSync(process.execPath, [path.join(root, 'bin', 'kb.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /kb search/);

  step = 'cli search --no-llm';
  const cli = spawnSync(process.execPath, [path.join(root, 'bin', 'kb.mjs'), 'search', 'gitignore generated', '--no-llm'], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /^git\/0002 \| /);

  console.log('smoke: ok');
} catch (err) {
  console.error(`smoke: FAILED at "${step}"`);
  console.error(err);
  process.exitCode = 1;
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
