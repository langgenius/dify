# Research Stage Timing and Judge Budget

## Summary

- Made durable Research progress transitions follow the actual V3 orchestration boundaries:
  planning, initial recall, evidence analysis, and answer generation.
- Started the generating stage before the answer provider runs instead of after the completed
  `query.answer` trace span is emitted.
- Counted every physical Research reasoning call, including a structured-output recovery, against
  the durable model-call budget and retrieval metrics.
- Increased the first structured reasoning response allowance from 1,024 to 2,048 tokens and the
  bounded recovery allowance from 2,048 to 4,096 tokens. This avoids the observed case where a
  healthy reasoning model reached the first cap and repeated the entire evidence judgement.
- Raised the V3 hard model-call budget from two to three so a complex query can use one planner,
  one evidence judge, and at most one truncation recovery without hiding the physical call.
- Kept non-zero subsecond stages visible in the Console timeline as milliseconds.

## Observed Baseline

The test-environment task used to diagnose this change lasted 86,094 ms. Its persisted progress
ledger reported 7 ms planning, 78,528 ms retrieving, 6,909 ms analyzing, and 21 ms generating. The
cost ledger showed that the 78,528 ms bucket included two `research.judge` calls: the first reached
the 1,024-token output limit and the bounded recovery made a second provider call. Answer synthesis
was therefore charged to the analyzing bucket, while generating contained only terminal
persistence.

These values are evidence for the defect and not a post-change performance claim. A post-deployment
run is required before reporting a measured latency improvement.

## Regression Contract

- V3 emits retrieving after planning and analyzing before the evidence judge.
- The query generator emits generating before invoking the answer provider.
- The durable runtime no longer advances a Research job from planning before those callbacks.
- A truncated judgement reserves and reports two physical model calls.
- Historical progress events below one second render in milliseconds rather than `0s`.
