// Keyword scoring used by the `none` selector fallback and by the similarity guard.
// Kept deliberately small; this is the seam where an FTS prefilter (e.g. SQLite FTS5) can replace
// `rankByKeywords` later without touching the callers.

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'be', 'it', 'this',
  'that', 'when', 'do', 'use', 'not', 'no', 'as', 'at', 'by', 'from', 'if', 'so', 'we', 'you', 'i',
]);

export function tokenize(text) {
  const out = new Set();
  const s = String(text || '').toLowerCase();
  // Latin words, digits, and CJK runs each become tokens. CJK runs are also split into bigrams so
  // that Japanese/Chinese queries without spaces still overlap.
  for (const m of s.matchAll(/[a-z0-9_][a-z0-9_.+-]*|[぀-ヿ㐀-鿿]+/g)) {
    const t = m[0];
    if (/^[a-z0-9_]/.test(t)) {
      if (t.length < 2 || STOP.has(t)) continue;
      out.add(t);
      if (t.length > 4 && t.endsWith('s')) out.add(t.slice(0, -1));
    } else {
      out.add(t);
      for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
    }
  }
  return out;
}

export function entryTokens(entry) {
  const claim = tokenize(entry.claim);
  const tags = tokenize((entry.tags || []).join(' '));
  return { claim, tags };
}

// Score an entry for a query: tag hits count double, claim hits single.
export function scoreEntry(queryTokens, entry) {
  const { claim, tags } = entryTokens(entry);
  let score = 0;
  for (const q of queryTokens) {
    if (tags.has(q)) score += 2;
    if (claim.has(q)) score += 1;
  }
  return score;
}

export function rankByKeywords(query, entries, k) {
  const q = tokenize(query);
  const scored = entries
    .map((e) => ({ entry: e, score: scoreEntry(q, e) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return (k ? scored.slice(0, k) : scored).map((x) => x.entry);
}

// Jaccard overlap between two claims; used to spot near-duplicates before writing.
export function claimSimilarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
