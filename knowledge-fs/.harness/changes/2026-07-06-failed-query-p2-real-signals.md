# Failed-query loop P2 — real triage signals (apps/api)

Date: 2026-07-06

Implements the real `RelevanceTriageSignals` the P2 core left injectable, and wires them.

## What landed
- `apps/api/src/relevance-triage-signals.ts`:
  - **graphRelevance** — query content-tokens vs the knowledge graph's entity names + aliases
    (the corpus's concept index, independent of the chunk retriever that failed).
  - **answerability** — an LLM judge (the answer provider) over the corpus's topic sample; replies
    are parsed to `retrieval-miss | coverage-gap | uncertain`, defaulting conservatively to
    `uncertain` (and on any LLM error).
  - **summaryRelevance** — query tokens vs document/section titles + summaries. Real code, but see
    the gap below.
  - Per-space corpus is loaded once and cached with a TTL, so a triage batch pays for it once.
- `createApiRelevanceTriageOptions` builds the signals from the graph + (optional) summaries + answer
  LLM and is spread into the gateway; returns `{}` when there is no graph.
- Wired the **database graph-index repository** in `repository-options.ts`.

## Blast radius / gaps (please verify)
- **Graph is now DB-persisted in database mode.** The graph index was previously the gateway's
  in-memory default in apps; triage needs a persistent graph (extraction writes + triage reads must
  share it), so `graphIndex` now uses `createDatabaseGraphIndexRepository`. This is the correct
  production behavior and additive (the `graph_entities`/`graph_relations` tables already exist), but
  it changes graph persistence for extraction/retrieval too — worth a look in review/CI.
- **summaryRelevance is empty in database mode** — document outlines are not yet DB-persisted (no
  `document_outlines` table / DB repo), so summaries only exist in-memory. The signal code is real and
  works wherever outlines are available; graph relevance carries triage until outline persistence (or
  a coarse summary-embedding index) is added.
- **The LLM judge needs calibration** against real data (precision-first; over-eager relevance floods
  annotation). The prompt defaults to `uncertain` when unsure.

## Tests
- `relevance-triage-signals.test.ts` — tokenization; verdict parsing; signal overlap + answerability +
  corpus caching (fake loader/judge); corpus loader building entity+summary vocab from fake graph/
  outlines (and empty summaries without outline sources); judge mapping + error fallback.
