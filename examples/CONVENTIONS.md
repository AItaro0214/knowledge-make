# Conventions for this library (example - copy to your KNOWLEDGE_DIR and edit)

## What goes in (the first rule)

Record only what the model does NOT already know from its training data: facts confirmed by research or by work in this environment that are new, post-cutoff, or more specific than general knowledge. Textbook facts the model would state unprompted stay out.

- Every entry from research carries its sources: URL, the study or document name (authors / journal / organisation), and the publication date, in a `## Sources` section of the body; the main URL also goes in `source`.
- The body says how it was confirmed: "Confirmed by research on <date>; not in the model's base knowledge" (or "observed in this environment on <date>").
- A claim resting on one small or preliminary study is worded cautiously and marked `hypothesis` or `observed`; `verified` is for replicated findings, meta-analyses or direct tests here.
- A finding that updates an existing entry updates or supersedes it; two contradicting live entries are not allowed.

## Format

- **claim**: one sentence, a conclusion. Language: <the language your readers use - claims are short, so a non-English claim costs few tokens>.
- **body**: English is cheapest in tokens for long text; quote error messages, commands and UI text verbatim.
- **tags**: lowercase kebab-case; reuse existing tags.
- **domain id**: kebab-case; **domain name** and **scope**: one line each, in the readers' language.
- Never store secrets, API keys, emails or phone numbers.
