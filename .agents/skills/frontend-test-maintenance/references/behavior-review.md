# Reviewing behavior value and mock boundaries

Read this for quality audits, shortlists, and cleanup. The live owner testing policy remains authoritative; this procedure turns its requirements into review evidence.

## Find candidates outside the queues

For a free search, start with a concrete contract such as URL navigation, input coercion, persistence, permissions or stream cancellation. Follow its production path and nearby tests; use `rg` to locate replacements, not to classify violations. Partial `importOriginal` mocks, utility modules, imported factories and environment adapters deserve inspection even without a hook/store/JSX signal.

Choose a small coherent area, trace its shared dependencies and consumers, and stop expanding when there is a reviewable cleanup batch. Record what was examined and why cases were retained; do not imply an exhaustive audit. For a broad quality search, complement ranked leads with this method. For a user-selected list, keep that list and disclose any necessary consumer expansion.

## Trace the test before deciding

For each candidate, inspect the whole test body, setup/factories, production owner, and nearby tests for the same contract. Record:

- **Claim:** the reachable user action or public API behavior the test claims to protect.
- **Owner:** the production function/component that decides or transforms the asserted result.
- **Replacements:** which parts of that path are mocked, including transitive shared helpers. Compare the replacement's inputs and outputs with the real producer: can the real boundary produce those values, and which transformations or checks were bypassed? Separate service/browser/SDK isolation from internal feature behavior and interactive primitives.
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
| Partial mock preserves some fields but changes meaning | Rewriting a URL retains query params while discarding its path/origin, or a fake drops authorization, errors or cancellation semantics | Configuring a deployment origin while keeping the real URL builder and message checks |
| Mock supplies already parsed or validated inputs | The claimed entry-point behavior skips its parser, or fabricated values cannot come from that producer | A pure coercion function whose documented public input genuinely accepts those values |

The scanner supplies leads only: path-normalized internal hook/store mocks, local JSX factories, direct named tests with call-only assertions, render-smoke checks, classes and snapshots. It cannot determine owners, equivalent coverage, mock fidelity, or whether assertions observe a supported contract. Callback assertions at network boundaries and legitimate snapshots remain candidates, not violations. Inspect examples from both queues; do not just raise the weight of total mock count.

## Preserve the contract when isolating the environment

Keep transformations real when they are part of the claimed behavior. Drive URL defaults through actual URL parameters, for example, and check real destinations when testing navigation. Retain invalid-input cases that users can reach; replace cases manufactured only by a mock with a supported scenario or remove them when no distinct regression remains.

For an embedded-page test, changing `src` to `about:blank` also changes the origin used by message validation and replies. Prefer isolating remote document loading while retaining the real URL and frame identity. Web's existing `test/iframe-navigation.ts` is one happy-dom adapter for that purpose; check its current contract and use only where needed. Synthetic message events prove handler behavior, not browser delivery or cross-origin enforcement. Keep actual navigation and message-delivery claims at the runtime required by the owner policy.

A boundary correction may replace a business-function mock with a configuration fixture without lowering module-mock count. Explain what now runs for real and which failures become visible. Do not add blanket rules against utility mocks, `about:blank`, callback assertions or environment adapters; their value depends on the contract under review.

## Resolve uncertainty proportionately

A static dependency trace can establish that a mocked implementation is never exercised. It cannot establish that the remaining control wiring has no value. Compare the intended boundary with owner coverage before recommending removal.

When a material doubt remains, use a focused mutation experiment; it is optional, not a requirement for every cleanup:

1. Name a realistic regression within the claimed contract and establish that the relevant unmodified cases pass.
2. Save exact source bytes. Temporarily change that behavior, run the original and rewritten cases against the same mutation when comparing protection, and keep unrelated inputs and runner settings comparable.
3. Restore every touched source/test in `finally`, confirm restoration, and validate the final unmutated tests. Do not mutate a dirty production file, overwrite unsaved test edits, or run concurrent work against the temporary files.
4. Record the mutation, case selection, exit results and actual failed assertion. A timeout, import error or unrelated failure is not evidence that the rewritten assertion caught the regression.

For example, switching a plugin route from `/plugins/...` to `/bundles/...` can leave a query-only test green while a destination assertion fails. This establishes that specific gap, not an overall quality score. A surviving mutation outside the intended boundary is not automatically a defect. Do not run a repository-wide mutation campaign by default.

## Report and carry decisions forward

For each confirmed finding, include test path/lines, production owner path, affected case(s), evidence/overlap, proposed change, and retained contract. Record whether it came from ranking, a contract trace or a shared dependency. A semantic miss in a file with other scanner signals is different from a file absent from the quality queues. Report unresolved ownership/overlap separately. Record full-file dimension reviews even when the conclusion is retain; keep partial-case reviews in the finding report without deferring that file/dimension. The command/schema for history is in [metrics](metrics.md).

Report semantic outcomes first: unsupported or duplicate cases removed, internal behavior made real, assertions strengthened, and justified boundaries retained. Reduced `as` or `vi.fn` counts describe setup changes, not improved regression protection by themselves.
