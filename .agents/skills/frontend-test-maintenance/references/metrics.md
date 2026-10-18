# Audit commands and metric definitions

Run from the Git repository root with repository dependencies installed. The scanner uses the repository's TypeScript parser; it does not install packages or execute tests. Substitute the desired directories and an existing report directory. Paths in manifests are repository-relative, one per line.

```bash
node .agents/skills/frontend-test-maintenance/scripts/audit.cjs "$PWD" /tmp/test-before.json web
node .agents/skills/frontend-test-maintenance/scripts/report.cjs rank /tmp/test-before.json 40 /tmp/test-hotspots.json --focus quality
# Review the queue; edit the generated manifest if the chosen scope differs.
# After authorized cleanup, use exactly the same audit scopes:
node .agents/skills/frontend-test-maintenance/scripts/audit.cjs "$PWD" /tmp/test-after.json web
node .agents/skills/frontend-test-maintenance/scripts/report.cjs compare /tmp/test-before.json /tmp/test-after.json /tmp/test-comparison.json /tmp/test-hotspots.json.files.txt
```

`40` is an example, not a required batch size. User-selected paths take precedence over a newly generated ranking. `rank` writes both the JSON queue and `<output>.files.txt`; do not overwrite a frozen manifest by reranking after edits. Omit the manifest argument to compare all baseline files.

Pass `packages/dify-ui` instead of `web` for that package, or pass both to inventory both owners. Extra scope arguments can name custom helper files outside recognized support directories. Include them in both snapshots. The scanner includes tracked and nonignored untracked JS/TS files, excludes declarations and deleted files, and recognizes:

- `*.spec.*` / `*.test.*` as specs. Web `.browser.spec.*` / `.browser.test.*` files are browser; other Web specs are unit.
- Dify UI specs as browser and its `*.stories.*` as Storybook, matching the current package runtime. Web stories are not automatically included.
- Support under `__tests__`, `__mocks__`, `test`, `tests`, `test-utils`, Vitest setup files, and the Web TSSLint test helper. Explicit file scopes include other helpers.

These are conventions, not execution discovery. Check the owner configuration for exceptions and mention missing/custom helpers. Storybook counts include story setup, not just `play` functions. The report records hashes and local dirty state; its commit alone does not identify all audited source content.

## Policy-to-review mapping

This is an index into the current owner policies, not an independent policy. Read their live contents before classifying a finding. When a policy changes, update the affected rows, guidance, and script rules together.

| Owner policy area                                        | Signals and required judgment                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web: Testing Mindset / Coverage                          | Weak render checks, duplicate scenarios, and cast-manufactured inputs are candidates. Identify a reachable regression and existing owner coverage. No scanner count or coverage percentage establishes value.                                                     |
| Web: Choose the Right Boundary / Mock at Real Boundaries | Inspect local/hook/store/UI mocks against the asserted behavior owner. Keep interactive primitives real; preserve fresh query clients, valid builders, and isolation. Service or SDK isolation can be appropriate.                                                |
| Web: Assert Behavior, Not Implementation                 | Inspect class/CSS queries, snapshots, private callbacks, and referential identity. Protect observable contracts; do not mechanically replace class assertions with computed-style assertions.                                                                     |
| Web: Queries, Interaction, and Accessibility             | Review test IDs and fireEvent in context; favor semantic queries and RTL setup instances. Browser direct userEvent calls have different semantics. Query choice alone cannot prove accessibility.                                                                 |
| Web: Async, Time, and Isolation / Dify Test Setup        | Check bare async calls, fixed waits, afterEach resets, shared stores, URL behavior, and timer restoration against current setup defaults. Mock restoration is distinct from resetting the next test's state.                                                      |
| Web: Browser Mode Admission                              | Review force/sleep/snapshot candidates plus the scenario's value, additional browser evidence, and faithful production boundary. Geometry, native defaults, or emulator limitations alone do not justify new browser coverage.                                    |
| Dify UI: Test boundary / Type contracts                  | Distinguish documented stories and play interactions from ordinary integration specs and compile-only API fixtures. Preserve intentional type-error cases; avoid duplicate stories/specs and primitive passthrough tests. Both package projects run in a browser. |
| Dify UI: accessibility / Animation setup                 | Inspect accessibility exceptions and animation setup manually. Do not add broad exceptions or replace an accessibility fix with interaction coverage. The scanner does not establish these requirements.                                                          |
| Both owners: validation guidance                         | Read current test/static-check commands from owner docs. Validate affected contracts and fixture consumers; report gaps. These commands are not duplicated in this skill.                                                                                         |

## Interpreting counts

Each finding has file, line, column, scope, and metric. Aggregate metrics have **occurrences** and **affected files** per scope. An occurrence is an AST call/node/chain, not a runtime invocation or generated test case. A mock in a loop counts once.

| Metric                                                                              | Meaning and interpretation                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module_mock`                                                                       | All `vi.mock` / `vi.doMock` call sites, including dynamic targets. Subcategories overlap this total.                                                                                                                                                                              |
| `vi_fn`, `vi_spyOn`, `vi_stubGlobal`, `vi_stubEnv`                                  | Separate mock mechanisms; report them separately rather than calling their sum independent mocked dependencies.                                                                                                                                                                   |
| `mock_hook_target`, `mock_store_target`, `mock_other_local`                         | Path heuristics for boundary review; imports are not resolved and target ownership is not proven.                                                                                                                                                                                 |
| `mock_dify_ui`, `mock_nuqs`                                                         | Specific imports to inspect under current policy; they do not by themselves establish that the asserted behavior was mocked away.                                                                                                                                                 |
| `mock_internal_hook_or_store_candidate`                                             | Relative and Web `@/` paths normalized; local hook/store targets excluding service/navigation/test helper paths. Not semantic ownership or module resolution.                                                                                                                     |
| `local_mock_jsx_factory_candidate`                                                  | A local non-service mock has JSX in its inline factory. Inspect for substituted behavior; legitimate expensive child shims also match. Imported factories and `createElement` are not expanded.                                                                                   |
| `mock_call_assertions`                                                              | Recognized `expect(...).toHaveBeenCalled*` matcher calls, including negative assertions. Public callback and service assertions can be valuable.                                                                                                                                  |
| `callback_only_test_candidate`                                                      | A direct named `it`/`test` body has visible assertions and all use call matchers. Helpers, `it.each`, test/expect aliases and indirect assertions are not expanded; mixed helper assertions can cause false positives.                                                            |
| `type_assertion_nodes`                                                              | Every `as T` / angle-bracket assertion except `as const`. An unknown bridge has two nodes. Ordinary assertions need review, not automatic deletion.                                                                                                                               |
| `unsafe_assertion_chains`                                                           | One outer chain containing `any`, `never`, or multiple assertions with `unknown`. This operational definition is narrower than all unsafe TypeScript.                                                                                                                             |
| `assertion_chains_any`, `assertion_chains_never`, `assertion_chains_unknown_bridge` | Overlapping breakdown of unsafe chains; do not add them to the union count.                                                                                                                                                                                                       |
| `double_assertion_chains`                                                           | All multi-assertion chains, including those without unknown.                                                                                                                                                                                                                      |
| `non_null_assertions`, `any_type_nodes`, `as_const`                                 | Separate context metrics; an `as any` also contributes an `any` node.                                                                                                                                                                                                             |
| `testid_queries`, `css_dom_queries`, `class_assertions`                             | Selector/implementation coupling candidates. Test IDs can be appropriate for nonsemantic boundaries; inspect the contract.                                                                                                                                                        |
| `fireEvent_calls`, `direct_userEvent_call`                                          | Interaction inventory. Low-level event contracts and Browser Mode APIs require different judgments from RTL defaults.                                                                                                                                                             |
| `afterEach_mock_reset_candidate`                                                    | Reset/clear calls inside `afterEach`; compare with setup and runner defaults before removing.                                                                                                                                                                                     |
| `afterEach_mock_restore`                                                            | Restoration, intentionally separate from preparation of the next test. Not included in ranking.                                                                                                                                                                                   |
| `render_existence_assertion_candidate`                                              | Defined/truthy checks of a render call, its result, or container/baseElement bindings from that call. Inspect only the expect subject: business expressions such as renderedStore.getState().backupDraft and DOM queries are excluded. Still a candidate, not proof of low value. |
| `bare_async_call_candidate`                                                         | A standalone findBy/waitFor/user-event call with no surrounding await/return. Not full promise dataflow analysis.                                                                                                                                                                 |
| `fixed_wait_candidate`, `promise_timer_candidate`                                   | Delay helpers or promise timers. Distinguish incorrect synchronization from a timer contract.                                                                                                                                                                                     |
| `snapshots`, `visual_snapshots`, `browser_force_true`                               | Evidence to evaluate against serialization/visual/browser admission rules.                                                                                                                                                                                                        |
| `ts_ignore`, `ts_nocheck`, `ts_expect_error`                                        | Comment directives, excluding text inside fixture strings. Intentional compile-only API errors can be valuable.                                                                                                                                                                   |
| `test_execution_modifier`                                                           | Skip/todo/only and conditional execution candidates; inspect intent.                                                                                                                                                                                                              |

The scanner recognizes common imported aliases for `vi`, `userEvent`, and `render`, but not all destructuring, re-exports, wrappers, computed access, or shadowed names. Some call-name heuristics can match unrelated APIs. It fails on parse errors rather than silently undercounting. It does not determine whether a test is low-value.

## Ranking and comparison

`rank` defaults to `--focus quality`: independent **mock-boundary** and **behavior-value** queues, alternated and deduplicated into the requested shortlist. `--focus typing` selects type/assertion and test-setup hygiene; `--focus all` alternates all three. Only files with a positive signal in an active dimension enter the queue; the result can contain fewer than COUNT files. Each queue and its size is also reported, so the other dimension remains visible even for a small shortlist.

Mock-boundary signals are normalized internal hook/store targets (weight 3), local JSX factories (4), Dify UI mocks (4), and nuqs mocks (2). Behavior-value signals are callback-only test bodies (3), render-smoke checks (4), class assertions (3), and snapshots (1). Typing/setup signals are unsafe chains, unawaited async calls, fixed waits and TS suppressions (3), and afterEach preparation (2). Each metric contributes at most five occurrences per queue score; overlapping signals are selection heuristics, not additive violation counts. Module mocks, mock functions/spies and test-ID/CSS query counts are capped at ten each and only break ties; file path is the final tie-breaker. A large cast backlog cannot displace quality candidates.

Mock counts alone cannot justify a cleanup. Run the [behavior review](behavior-review.md) on the selected candidates and inspect overlapping owner tests. A type-only report is not an acceptable result for a behavior-quality request.

### Dimension-specific review history

```bash
node .agents/skills/frontend-test-maintenance/scripts/report.cjs rank /tmp/test-after.json 40 /tmp/next-hotspots.json /tmp/reviewed.json --focus quality
```

Copy source/scanner/policy hashes from the audit and `reviewMethodSha256` from the ranking output after actually reviewing under that method:

```json
{
  "scannerSha256": "<audit scanner hash>",
  "reviewMethodSha256": "<ranking review-method hash>",
  "policies": [{ "file": "web/docs/test.md", "sha256": "<policy hash>" }],
  "files": [
    {
      "file": "web/path/owner.spec.tsx",
      "sha256": "<reviewed test source hash>",
      "dependencies": [{ "file": "web/path/owner.tsx", "sha256": "<reviewed owner hash>" }],
      "reviews": {
        "typing": {
          "decision": "cleaned",
          "reason": "Replaced incomplete fixture with typed data."
        },
        "mock-boundary": {
          "decision": "retain",
          "reason": "Real owner transforms service data; only the external response is replaced."
        }
      }
    }
  ]
}
```

Use `retain` or `cleaned` only for an inspected dimension. `behavior-value` is absent in this example and remains eligible. Do not mark a known unresolved problem cleaned/retained just to move it out of the queue. Legacy whole-file decisions are listed in `legacyReviewFiles` but never defer files. `deferredReviewed` contains file/dimension pairs, not a count of fully reviewed files.

The review-method hash includes the ranker, SKILL.md, metrics, and behavior-review guidance. Source, scanner, policy or method changes invalidate decisions; optional recorded owner/dependency hashes are checked against the current filesystem. Record important owner/helper dependencies during manual review. The tool cannot discover all transitive dependencies, so manually invalidate a decision when other relevant behavior changes. Never relabel old hashes to bypass invalidation; re-review under the new method. Raw rankings are rejected as review history. Explicit user-selected scopes always take precedence.

Render-result bindings are recognized syntactically, including imported aliases and destructuring aliases. Custom wrapper names, reassignment, and lexical shadowing need manual review; this is not semantic dataflow analysis. The rule deliberately avoids substring matching on business-state identifiers.

After changing scanner or ranking behavior, run the regression checks from the repository root:

```bash
node --test .agents/skills/frontend-test-maintenance/scripts/audit.test.cjs
```

These verify AST candidate boundaries, quality queues independent of type volume, per-dimension review invalidation (including method and owner changes), business-state false positives, and moved debt.

`compare` rejects different scopes, metric schemas, scanner hashes, or applicable policy hashes. It reports selected-file totals and whole-scope totals, plus added/removed paths and changes outside the selection. Renames appear as removal plus addition. Relate them manually before interpreting a reduction; moving mocks to a new filename is not elimination. A newly added helper outside the audited scope remains invisible—include helper directories from the start, or regenerate both baselines with the expanded scope using preserved baseline sources. Do not fabricate a missing baseline from post-cleanup contents.

Use a separate reviewed finding list for confirmed violations: path/line, owner rule, behavior at risk, and delete/merge/rewrite/retain decision. Summarize unresolved or deliberately retained candidates separately from confirmed fixes.
