# Bounded Unstructured response normalization

## What changed

- Admit raw provider JSON before Zod cloning and layout normalization: scan JSON depth before decoding, then enforce raw element count, tree nodes, and response-byte budgets. Invalid or excessive provider output remains a non-retryable `provider_response_invalid` error.
- Replace repeated full-document CJK glyph scans with a conservative page-local spatial grid. Only neighboring buckets are examined, consumed candidates are removed, and exact adjacency plus the existing deterministic distance/tie ordering are preserved.
- Apply an explicit comparison budget to dense/adversarial buckets instead of silently omitting evidence or allowing quadratic work to continue.
- Bound heading ancestry depth and cumulative emitted section-path items before their repeated expansion.
- Detect request deadline overruns using monotonic elapsed time as well as the timeout callback. Synchronous work cannot report success merely because it delayed the event-loop timer.
- Bound HTML `colspan` / `rowspan` expansion before each cell assignment, including empty cells and the logical width of sparse carried rows. A parse-local budget spans all native HTML tables, HTML tokens within Markdown/MDX, and provider `text_as_html` tables. It also charges the extra padding needed to scan ragged rows as rectangular tables. Independent parses never share this counter. Bound dense header/headerless scans and joined header bytes before projection, and compute maximum width without variadic argument expansion.
- Charge projected table text bytes against the same document-local state before joining header-only labels or constructing data-row strings. Ordinary Markdown tables and HTML tables share this byte counter, preventing repeated individually-admitted tables from allocating many output-sized strings before the final artifact guard. Temporary flattened-header bytes remain a separate admission check and are not double charged.

Defaults:

| Resource | Limit |
|---|---:|
| Raw provider elements | 50,000 |
| Raw provider / final artifact tree nodes | 1,000,000 |
| JSON structural depth | 128 |
| Raw response bytes | Existing configured `maxResponseBytes` (default 32 MiB) |
| Heading depth | 64 |
| Cumulative emitted section-path items | 100,000 |
| Vertical candidate comparisons | 1,000,000 |
| Expanded HTML table columns | 4,096 |
| Cumulative expanded HTML table cells / dense traversal cells, per document | 500,000 |
| Flattened HTML header bytes | 32 MiB |
| Cumulative projected table text bytes, per document | 32 MiB |

The existing final `maxElements` remains unchanged (default 20,000). Native structured-record budgets remain separate. All over-budget cases fail explicitly; no truncation or empty-artifact fallback was introduced.

## Why

The all-format audit reproduced two distinct post-response amplification paths: repeated glyph scans across unrelated pages, and quadratic ancestry-array expansion. An HTTP byte cap alone did not constrain either path. Element filtering and final limits were also too late to protect schema and normalization work.

The implementation preserves transport-owned cancellation and single-flight. Shared operations must not inspect the first caller's cancelled signal while serving another active caller.

## Verification

- TDD: five existing-behavior tests failed before the normalization/deadline implementation (parent-chain depth, category depth, cumulative path expansion, dense candidate work budget, delayed-timer deadline); three raw-response tests failed before raw admission (filtered raw elements, hidden metadata tree nodes, excessive JSON depth).
- Dedicated tests cover local candidate counts, page separation, negative/spatial bucket boundaries, large finite coordinates, tie ordering, coordinate-system compatibility, geometry overflow, boundary admission, and rejection classification.
- The 17 normalization/grid tests plus 5 raw-admission tests passed.
- HTML table TDD: four existing-behavior regressions failed before implementation (empty overwide colspan, cumulative empty cells, carried rowspans, and sparse carried logical width). Four follow-up regressions confirmed separate HTML / Markdown / MDX / provider tables could otherwise reset this counter, and one further test caught aggregate ragged-row padding. Nineteen dedicated tests now pass, including independent-parse isolation, exact-boundary admission, unchanged multirow-header/carry output, pre-projection traversal limits, and pre-join header bytes. These tests use small mocked budgets to exercise the real parser paths without large allocations.
- Document table-byte TDD: five regressions failed before the shared byte counter (HTML headers/data rows, Markdown and MDX tables, and provider tables). Ten dedicated tests now pass, including ordinary Markdown mixed with HTML tokens, exact cumulative byte admission, and independent native/provider parses.
- Independent JSON/resource helper tests also exposed and verified root-agent fixes for prototype-shaped JSON fields and invalid numeric budget options. Together these five dedicated test files contain 90 passing tests.
- Four focused helper modules measured 100% statement/line/function coverage and 97.79% branch coverage; each exceeded 90% branch coverage. Parser TypeScript checking passed.
- The original parser suite passed after the localized changes; full workspace verification remains the responsibility of the parent task's integrated verification after concurrent parser edits finish.
- After the final parse-local table cell/byte budget changes, all 442 parser tests, parser TypeScript checking, and `git diff --check` passed. Broader workspace checks remain with the parent task.
- Bounded diagnostic only: a simulated 2,352,895-byte response containing 12,000 cross-page CJK glyphs retained all 12,000 output elements in 221 ms locally, compared with about 2.2 seconds in the audit's previous implementation. These timings are not a production benchmark or SLA, and no OOM-scale inputs or network provider requests were run.

## Remaining boundaries

- Monotonic checks recognize overruns but cannot forcibly interrupt JavaScript currently executing on the same event loop. Hard CPU/RSS cancellation still requires worker/subprocess isolation.
- Raw response buffering and native `JSON.parse` allocation still occur in the API process, within the existing byte/depth bounds. The structural pass runs after decoding but before schema cloning and normalization.
- The spatial grid is conservative, not a claim of constant time for all inputs. Dense or extreme-geometry inputs can exhaust the explicit comparison budget and be rejected.
- New finite structural limits can reject unusually deep or complex otherwise-readable documents. This is explicit resource admission, not a promise that all previously accepted files remain accepted.
- The raw JSON tree budget does not inspect the internal semantics of strings. HTML table expansion now has its own pre-expansion budget; future nested content decoders must also enforce their own structural limits.
- No commit, push, deployment, or database migration was performed by this subtask.
