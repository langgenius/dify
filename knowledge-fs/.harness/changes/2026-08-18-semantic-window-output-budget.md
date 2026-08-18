# Bound semantic-window output complexity

Date: 2026-08-18

## What changed

- Bumped new semantic compilations to `semantic-chunking-v3`.
- Limited each v3 model request to 32 core parser units and 8 look-ahead units in addition to the
  existing grapheme budgets.
- Excluded documents above the same 32-unit bound from atomic-record mode, so a compact document
  cannot force an unbounded structured response merely because its source text is short.
- Grounded a model-proposed section path back to the immutable parser prefix when the model tries
  to replace that prefix, while still accepting valid semantic child levels.
- Preserved the exact v2 planner and prompt payload for stored v2 generation receipts and
  checkpoints. Existing published data therefore keeps its original replay contract.

## Why

Character-only input budgeting does not bound structured output. The supplied HTML document has
many short parser units and repeated provenance paths. Its first v2 request contained 112 core
units, used 18,329 input tokens, reached the configured 6,000 output-token limit, and returned
truncated invalid JSON. One oversized request was cheaper in call count but could never publish a
document.

The v3 unit limits retain cross-section semantic context while bounding the number of ranges,
section summaries, entities, and relations that one response may need to encode.

Section provenance is parser-owned metadata. Rejecting an otherwise valid chunk merely because the
model failed to repeat that prefix made a single response invalidate the whole document. The
materializer now discards only the untrusted path proposal and preserves the trusted parser path.

## Measured result

Using the exact persisted parse artifact for `权责蓝图.html`:

- parser elements: 171;
- atomic semantic units: 232;
- legacy planner windows: 80 (recorded baseline);
- v2 character-budgeted windows: 3;
- v3 character-and-unit-budgeted windows: 8;
- maximum v3 core units per request: 32;
- maximum v3 look-ahead units per request: 8.

V3 still reduces deterministic model-call count by **90%** versus the 80-call legacy baseline. It
intentionally gives back part of v2's theoretical 96.25% call reduction so responses remain below
the observed output ceiling. No elapsed-time percentage is inferred from these deterministic
counts.

## Verification

- Added a 96-unit compact-document regression proving v3 produces three bounded requests while an
  explicit v2 replay still produces its original single request and v2 metadata.
- The complete semantic chunker test file passes, including v1/v2/v3 planning, atomic records,
  durable checkpoints, compact receipt replay, Graph grounding, and source-span validation.
