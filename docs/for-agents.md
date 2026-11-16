# knowledge-make for LLMs and agents: how to keep a library worth reading

This page is written for the model that searches, writes and updates the library. Humans can read it too. The tool (`kb`, the MCP server) only stores and retrieves; whether the library stays useful depends on the rules below.

## 1. What the library is for

A model already knows its training data. A library entry is worth its tokens only when it tells the model something it would not otherwise know or would get wrong:

- facts published after the model's training cutoff;
- facts that **update** something the model believes (a failed replication, a retraction, a newer meta-analysis, revised official figures, a deprecated API);
- specifics the model cannot reconstruct (numbers, sample sizes, dates, named studies, a project's own decisions and gotchas observed while working).

Do not store textbook knowledge. If you would have said it unprompted, leave it out.

## 2. Writing an entry

- **Claim**: one sentence, a conclusion, not a topic. Shape: "When X, Y happens / do Y, because Z." Put the main number in the claim if there is one.
- **Body**: the evidence. Recommended sections: `Finding`, `Caveats`, `How to apply`, `Sources`. Keep it short; the claim carries the value.
- **Sources** are mandatory for anything learned from outside: title, authors or organisation, outlet, publication date, URL or DOI. Say how it was confirmed: "Confirmed by research on YYYY-MM-DD; not in the model's base knowledge" or "observed in this project on YYYY-MM-DD".
- **Confidence**: `verified` = meta-analysis, replicated result, large preregistered trial, or tested here; `observed` = one solid study or report, or seen once; `hypothesis` = preprint, small or animal-only study, model, commentary. Never phrase a claim more strongly than its source does.
- **Tags**: reuse existing tags (`kb search` first). Shared tags are how related entries across domains find each other.
- If the library has `CONVENTIONS.md` (language, naming, house rules), read it once per session before the first write and follow it.

## 3. Updating instead of piling up

The write guard (`kb add` refuses with exit 2, or `library_write` returns `similar`) is where quality is kept. When it fires, read the similar entries and decide:

| situation | action |
|---|---|
| same fact, new detail or newer numbers | `kb update <id>` (or `mode: "update"`) |
| the old claim is now wrong (overturned, retracted, failed replication) | `--supersede <id>` (`mode: "supersede"`): the old entry stays on disk for history but leaves search |
| genuinely different fact that only looks similar | `--new` (`mode: "new"`) |

Two entries that contradict each other must not both stay live. If a new finding conflicts with an existing entry and you cannot settle it, write the new one with `hypothesis` and say in its body which entry it conflicts with, then make settling it a follow-up question (section 5).

## 4. Searching for new material (any agent)

- Prefer primary sources. For papers, publisher and PubMed pages often block automated fetching; the Europe PMC REST API usually works and returns title, authors, journal, date, DOI and abstract:
  `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:"<doi>"&format=json&resultType=core` (URL-encode the query).
- Industry reports and surveys are fine when the method is stated (who, how many, when). Say in the body when the method is not public, and treat vendor surveys that favour the vendor's product with suspicion.
- Never cite from memory. If you could not open the source, do not write the entry.

## 5. A self-updating loop that works

Running a scheduled agent every day is cheap only if each role does one thing. A pattern that has worked:

1. **Fixed fields.** Keep a short list of fields (5-12). Group them so a few searcher agents each cover two or three related fields.
2. **Divergent search (light model, many).** Searchers are greedy: follow every thread, and each run also explores two or three *adjacent* fields ("if this is true here, who else studies it?"). Keep a log of adjacent fields already explored and skip recent ones, so exploration keeps moving. No limit on how many findings they report; ask them to rank, and to always report post-cutoff and *updating* findings.
3. **Blocked pages (optional, mid-size model).** Pages that refuse automated fetching can be read by a separate agent with a real browser, which returns extracted facts only (no HTML, no code) so the editor's context stays small.
4. **Convergent review (strong model, one).** The editor verifies sources, drops what the model already knew or what is already stored, writes the entries, and then acts like a demanding manager: for each important finding ask "so this means X? then shouldn't we also check Y?" (missing populations, confounds, practical size vs statistical size, replication, conflicts with existing entries, commercial bias, the view from an adjacent field).
5. **One-off deep dives.** Turn the sharpest 3-5 challenges into deep-dive questions for the next run and write them to a file. The next run gives them to dedicated searchers (looking for counter-evidence too), then the editor overwrites the file with new questions. Hypotheses themselves are never written as entries; only what the deep dive confirms.
6. **Back up** (`kb sync`) and leave a run log: per field, what was searched, kept, dropped and why; the deep-dive verdicts; the next questions.

A ready-to-adapt version of this procedure is in `examples/daily-update/SKILL.md`.

## 6. Token habits

- Search first (`kb search` / `library_search`), read bodies only for the ids whose claim changes what you will do.
- Do not paste whole bodies back into conversation; quote the claim and cite the id.
- Keep bodies short; long evidence belongs behind the source link.
- Let the light selector model do the domain and heading selection; the main model should receive a few `id | claim` lines, not the index.

## 7. Manual maintenance (no automatic deletion)

Automatic pruning costs tokens and tends to delete the wrong things. Prefer adding and updating; review by hand from time to time with `kb stats` (see the checklist in `skill/knowledge-library/SKILL.md`).
