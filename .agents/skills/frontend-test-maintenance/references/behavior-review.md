# Reviewing behavior value and mock boundaries

Read this for quality audits, shortlists, and cleanup. The live owner testing policy remains authoritative; this procedure turns its requirements into review evidence.

## Trace the test before deciding

For each candidate, inspect the whole test body, setup/factories, production owner, and nearby tests for the same contract. Record:

- **Claim:** the reachable user action or public API behavior the test claims to protect.
- **Owner:** the production function/component that decides or transforms the asserted result.
- **Replacements:** which parts of that path are mocked, including transitive shared helpers. Separate service/browser/SDK isolation from internal feature behavior and interactive primitives.
- **Evidence:** the assertion that would fail for a named realistic owner regression. Note whether it only echoes a configured mock value, checks an internal callback, or asserts props sent to a mocked child.
- **Overlap:** the existing owner case and what additional failure this candidate catches. Similar titles or multiple states do not establish duplication.
- **Decision:** delete, merge, rewrite, or retain; identify valuable permissions, errors, races, lifecycle, keyboard/focus, caching, or transformations to preserve.

One file can contain both valuable regressions and low-value cases. Name the affected cases instead of condemning or retaining the entire suite.

## Candidate patterns and counterexamples

| Candidate to inspect                                             | Evidence needed before recommending cleanup                                                                                        | Legitimate counterexample                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Internal hook/store mock plus callback-only assertions           | The mocked hook owns the claimed outcome; a broken implementation is invisible, and the remaining wiring adds no distinct contract | A control must pass a transformed value to a public callback, or must never call it when access is denied |
| JSX mock factory for a local child                               | The replacement supplies the interaction, disabled behavior, or output that the test claims to verify                              | An independently tested expensive editor isolated while its parent owns save/cancel orchestration         |
| Primitive or feature-wrapper mock                                | The stub discards relevant roles, portals, focus, disabled semantics, or interaction state forbidden by the owner policy           | A noninteractive icon or an external browser API adapter                                                  |
| Configured response echoed in the assertion                      | No real owner transforms, rejects, persists, or routes that response                                                               | Cache, mapping, error, or authorization behavior occurs between the response and assertion                |
| Prop/callback matrix or multiple layers testing the same outcome | A stronger owner test covers the same failure, with no additional boundary risk                                                    | A distinct readonly, retry, cancellation, or lifecycle transition                                         |
| Mock factory reimplements business logic                         | The test's expected result comes from copied filtering/state/validation in the factory                                             | Minimal protocol adaptation that does not make the business decision                                      |

The scanner supplies leads only: path-normalized internal hook/store mocks, local JSX factories, direct named tests with call-only assertions, render-smoke checks, classes and snapshots. It cannot determine owners, equivalent coverage, mock fidelity, or whether assertions observe a supported contract. Callback assertions at network boundaries and legitimate snapshots remain candidates, not violations. Inspect examples from both queues; do not just raise the weight of total mock count.

## Resolve uncertainty proportionately

A static dependency trace can establish that a mocked implementation is never exercised. It cannot establish that the remaining control wiring has no value. Compare the intended boundary with owner coverage before recommending removal.

When necessary, temporarily alter one concrete production behavior (for example, drop a branch-specific filter), run the focused scenario, and restore the exact source in a finally step. Do not mutate a dirty production file or run concurrent work against that mutation. Record the mutation, test selection, outcome, and interpretation. A test passing after a change outside its intended boundary is not automatically a defect; choose a rewrite only if that boundary should include the changed behavior. Do not run a repository-wide mutation campaign by default.

## Report and carry decisions forward

For each confirmed finding, include test path/lines, production owner path, affected case(s), evidence/overlap, proposed change, and retained contract. Report unresolved ownership/overlap separately. Record examined quality dimensions even when the conclusion is retain; leave unexamined dimensions absent. The command/schema for history is in [metrics](metrics.md).

Report semantic outcomes first: unsupported or duplicate cases removed, internal behavior made real, assertions strengthened, and justified boundaries retained. Reduced `as` or `vi.fn` counts describe setup changes, not improved regression protection by themselves.
