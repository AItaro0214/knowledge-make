---
name: knowledge-daily
description: Scheduled update of a knowledge-make library - light-model agents search fixed fields in parallel and explore adjacent fields (divergent), run the previous run's one-off deep-dive questions, a strong model verifies, keeps only facts the model did not already know, writes them with kb, forms hypotheses and rewrites the next deep dive (convergent), then backs up. Use when run by a scheduler or when asked to "run the knowledge update".
---

# Knowledge daily update (example - adapt the fields, models and paths)

You are the editor (a strong model). Light-model agents search; you judge and write. Same procedure every run. This usually runs unattended: finish in one pass and never ask the user anything.

Roles:
- **Searchers (light model) = restless explorers.** Thorough and greedy: follow every promising thread, jump to neighbouring industries and disciplines.
- **Editor (you) = the nitpicking manager.** Beyond de-duplicating, interrogate: "So this means X? Then why hasn't anyone checked Y? Who would disagree?" Your output includes a sharp list of what to dig into next.

Paths used below (change them): library `$KNOWLEDGE_DIR` (default `~/knowledge`), work area `~/knowledge-daily/`, CLI `kb` (or `node <path>/bin/kb.mjs`).

## 0. Setup
- `TODAY=$(date +%F)`; create `~/knowledge-daily/$TODAY/`; log to `log.md` there.
- Read `$KNOWLEDGE_DIR/CONVENTIONS.md` if present and obey it.
- If `~/knowledge-daily/next-deepdive.md` exists, read it and copy it to `$TODAY/deepdive-used.md`.
- Read `~/knowledge-daily/explored.md` (adjacent fields explored, newest first) to avoid repeating recent ones.
- For each domain below, dump its live claims to `$TODAY/known-<domain>.txt` (`id | claim`, from `$KNOWLEDGE_DIR/domains/<domain>.json`) so searchers can skip them.

## 1. Fields (edit this table)
| agent | field | domain id | domain name | scope |
|---|---|---|---|---|
| A | example: psychotherapy and counselling | psychotherapy | Psychotherapy | new techniques and their evidence |
| A | example: neuroscience | neuroscience | Neuroscience | latest findings |
| B | example: consumer behaviour | consumer-behavior | Consumer behaviour | purchase models and evidence |
| B | example: B2B sales | b2b-sales | B2B sales | buying process and sales methods |

Create a missing domain with `kb domain add <id> --name "<name>" --scope "<scope>"` only when writing its first entry.

## 2. Search and explore (all agents in one message, in parallel)
One agent per row group (light model, high effort, background). Prompt:

```
FIELDS: <field 1> (domain <d1>), <field 2> (domain <d2>). Cover all; say which field each finding belongs to.
GOAL: NEW findings published or reported in the last 14 days before TODAY (up to 60 if nothing that recent), that a model trained up to its cutoff would not know.
SKIP anything in ~/knowledge-daily/TODAY/known-<d1>.txt and known-<d2>.txt.
YOU ARE A RESTLESS EXPLORER: follow methods, populations, datasets and terms you have not checked; breadth over depth.
EXPLORE: pick 3 adjacent fields not in RECENT_ADJACENT, up to 4 searches each; report only findings that connect back (say how).
PRIORITY: anything after the model's cutoff and anything that UPDATES earlier knowledge (replication, retraction, new meta-analysis, revised figures). Report all of these.
RULES: verify papers via Europe PMC (https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=<url-encoded>&format=json&resultType=core). Every item: title, authors/org, outlet, date, URL/DOI, design and N, key numbers. Never cite from memory.
REPORT: no limit on the number of findings; strongest first, per field: claim / evidence / source / strength / "updates: ..." when relevant. Then ADJACENT, then BLOCKED BUT VALUABLE (URLs you could not open), then NOTHING NEW if so.
```

Deep-dive agents (at most 2, same model): split the questions from `next-deepdive.md` between them; per question search deeper (primary data, strongest counter-evidence, replications, who disagrees; up to 8 searches) and end with a verdict: supported / weakened / unclear.

## 3. Blocked pages (optional)
If valuable pages refused fetching and you have a browser-capable agent, send it at most 10 URLs; it must return extracted facts only (title, author, date, quoted key sentences), no HTML.

## 4. Verify and judge
- Re-check every paper you will use (Europe PMC by DOI). Drop what you cannot verify and say so in the log.
- Keep what passes the first rule in CONVENTIONS.md: not already known to you, not already stored (`kb search "<claim>" --no-llm -k 5`), specific.
- No quota and no upper bound. An updating finding updates or supersedes the entry it concerns.

## 5. Write
Claims and bodies per CONVENTIONS.md. Collect entries in `$TODAY/entries.json` (`[{domain, claim, tags[], confidence, source, body}]`) and add them one by one: body to a temp file, then `kb add --domain .. --claim .. --body-file .. --tags .. --confidence .. --source ..`. If the guard refuses (exit 2), choose `--update`, `--supersede` or `--new` deliberately.

## 6. Converge: review, hypotheses, next deep dive
- In `$TODAY/review.md`, interrogate the important findings: "So this means ...? Then we should also check ...": missing populations, confounds, practical vs statistical size, replication, conflicts with stored entries, commercial bias, the adjacent-field view.
- Write 1-3 hypotheses that connect at least two findings and what would support or refute each. Never store hypotheses as entries.
- Pick the 3-5 challenges that would change the most if answered. OVERWRITE `~/knowledge-daily/next-deepdive.md`: per question - question / hypothesis tested / why (sources) / what to look for. It is used once and replaced.
- Prepend today's adjacent fields to `~/knowledge-daily/explored.md`.

## 7. Back up and report
- `kb sync -m "Daily update TODAY: N entries"`.
- Optional: send a notification with the count and the next deep-dive topics.
- Finish `log.md`: per field - searched, adjacent fields, kept (ids), dropped with reasons, blocked pages; deep-dive verdicts; hypotheses; next questions; entries added and the sync exit code.

## Scheduling
Run it with your agent's headless mode on weekdays, e.g. `claude -p "Run the knowledge-daily skill for today." --model <strong model> --permission-mode auto` from the library directory, via cron or Task Scheduler. Allow ~1-2 hours; check the first runs' logs.
