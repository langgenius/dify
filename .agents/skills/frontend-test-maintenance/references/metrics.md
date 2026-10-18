# Audit commands and metric definitions

Run from the Git repository root with repository dependencies installed. The scanner uses the repository's TypeScript parser; it does not install packages or execute tests. Substitute the desired directories and an existing report directory. Paths in manifests are repository-relative, one per line.

```bash
node .agents/skills/frontend-test-maintenance/scripts/audit.cjs "$PWD" /tmp/test-before.json web
node .agents/skills/frontend-test-maintenance/scripts/report.cjs rank /tmp/test-before.json 40 /tmp/test-hotspots.json
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

| Owner policy area | Signals and required judgment |
| --- | --- |
| Web: Testing Mindset / Coverage | Weak render checks, duplicate scenarios, and cast-manufactured inputs are candidates. Identify a reachable regression and existing owner coverage. No scanner count or coverage percentage establishes value. |
| Web: Choose the Right Boundary / Mock at Real Boundaries | Inspect local/hook/store/UI mocks against the asserted behavior owner. Keep interactive primitives real; preserve fresh query clients, valid builders, and isolation. Service or SDK isolation can be appropriate. |
| Web: Assert Behavior, Not Implementation | Inspect class/CSS queries, snapshots, private callbacks, and referential identity. Protect observable contracts; do not mechanically replace class assertions with computed-style assertions. |
| Web: Queries, Interaction, and Accessibility | Review test IDs and fireEvent in context; favor semantic queries and RTL setup instances. Browser direct userEvent calls have different semantics. Query choice alone cannot prove accessibility. |
| Web: Async, Time, and Isolation / Dify Test Setup | Check bare async calls, fixed waits, afterEach resets, shared stores, URL behavior, and timer restoration against current setup defaults. Mock restoration is distinct from resetting the next test's state. |
| Web: Browser Mode Admission | Review force/sleep/snapshot candidates plus the scenario's value, additional browser evidence, and faithful production boundary. Geometry, native defaults, or emulator limitations alone do not justify new browser coverage. |
| Dify UI: Test boundary / Type contracts | Distinguish documented stories and play interactions from ordinary integration specs and compile-only API fixtures. Preserve intentional type-error cases; avoid duplicate stories/specs and primitive passthrough tests. Both package projects run in a browser. |
| Dify UI: accessibility / Animation setup | Inspect accessibility exceptions and animation setup manually. Do not add broad exceptions or replace an accessibility fix with interaction coverage. The scanner does not establish these requirements. |
| Both owners: validation guidance | Read current test/static-check commands from owner docs. Validate affected contracts and fixture consumers; report gaps. These commands are not duplicated in this skill. |

## Interpreting counts

Each finding has file, line, column, scope, and metric. Aggregate metrics have **occurrences** and **affected files** per scope. An occurrence is an AST call/node/chain, not a runtime invocation or generated test case. A mock in a loop counts once.

| Metric | Meaning and interpretation |
| --- | --- |
| `module_mock` | All `vi.mock` / `vi.doMock` call sites, including dynamic targets. Subcategories overlap this total. |
| `vi_fn`, `vi_spyOn`, `vi_stubGlobal`, `vi_stubEnv` | Separate mock mechanisms; report them separately rather than calling their sum independent mocked dependencies. |
| `mock_hook_target`, `mock_store_target`, `mock_other_local` | Path heuristics for boundary review; imports are not resolved and target ownership is not proven. |
| `mock_dify_ui`, `mock_nuqs` | Specific imports to inspect under current policy; they do not by themselves establish that the asserted behavior was mocked away. |
| `type_assertion_nodes` | Every `as T` / angle-bracket assertion except `as const`. An unknown bridge has two nodes. Ordinary assertions need review, not automatic deletion. |
| `unsafe_assertion_chains` | One outer chain containing `any`, `never`, or multiple assertions with `unknown`. This operational definition is narrower than all unsafe TypeScript. |
| `assertion_chains_any`, `assertion_chains_never`, `assertion_chains_unknown_bridge` | Overlapping breakdown of unsafe chains; do not add them to the union count. |
| `double_assertion_chains` | All multi-assertion chains, including those without unknown. |
| `non_null_assertions`, `any_type_nodes`, `as_const` | Separate context metrics; an `as any` also contributes an `any` node. |
| `testid_queries`, `css_dom_queries`, `class_assertions` | Selector/implementation coupling candidates. Test IDs can be appropriate for nonsemantic boundaries; inspect the contract. |
| `fireEvent_calls`, `direct_userEvent_call` | Interaction inventory. Low-level event contracts and Browser Mode APIs require different judgments from RTL defaults. |
| `afterEach_mock_reset_candidate` | Reset/clear calls inside `afterEach`; compare with setup and runner defaults before removing. |
| `afterEach_mock_restore` | Restoration, intentionally separate from preparation of the next test. Not included in ranking. |
| `render_existence_assertion_candidate` | Weak defined/truthy checks whose expression mentions render/container/baseElement. Inspect before labeling low-value. |
| `bare_async_call_candidate` | A standalone findBy/waitFor/user-event call with no surrounding await/return. Not full promise dataflow analysis. |
| `fixed_wait_candidate`, `promise_timer_candidate` | Delay helpers or promise timers. Distinguish incorrect synchronization from a timer contract. |
| `snapshots`, `visual_snapshots`, `browser_force_true` | Evidence to evaluate against serialization/visual/browser admission rules. |
| `ts_ignore`, `ts_nocheck`, `ts_expect_error` | Comment directives, excluding text inside fixture strings. Intentional compile-only API errors can be valuable. |
| `test_execution_modifier` | Skip/todo/only and conditional execution candidates; inspect intent. |

The scanner recognizes common imported aliases for `vi` and `userEvent`, but not all destructuring, re-exports, wrappers, computed access, or shadowed names. Some call-name heuristics can match unrelated APIs. It fails on parse errors rather than silently undercounting. It does not determine whether a test is low-value.

## Ranking and comparison

`rank` emits its weights with each queue. The heuristic weights unsafe chains, weak render assertions, bare async calls, fixed waits, and ignore/nocheck comments at 3; module mocks, afterEach resets, and promise timers at 2; mock functions/spies and test-ID/CSS/class coupling at 1. Remaining metrics have weight 0. Ordinary type assertions and restore calls are context, not scoring penalties. Ties use file length then path. Review the leading files before presenting a cleanup recommendation; scores are neither violations nor a quality scale.

`compare` rejects different scopes, metric schemas, scanner hashes, or applicable policy hashes. It reports selected-file totals and whole-scope totals, plus added/removed paths and changes outside the selection. Renames appear as removal plus addition. Relate them manually before interpreting a reduction; moving mocks to a new filename is not elimination. A newly added helper outside the audited scope remains invisible—include helper directories from the start, or regenerate both baselines with the expanded scope using preserved baseline sources. Do not fabricate a missing baseline from post-cleanup contents.

Use a separate reviewed finding list for confirmed violations: path/line, owner rule, behavior at risk, and delete/merge/rewrite/retain decision. Summarize unresolved or deliberately retained candidates separately from confirmed fixes.
