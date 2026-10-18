---
name: frontend-test-maintenance
description: Audit and reduce maintenance cost in existing Dify frontend tests. Use for mock-boundary and behavior-value reviews, maintenance inventories, hotspot shortlists, or cleanup of low-value Vitest and React Testing Library tests under web/ or packages/dify-ui/. Also use when changing their testing policies to synchronize audit guidance and rules. Not for routine new-test authoring, backend tests, or e2e/.
---

# Frontend Test Maintenance

Turn test-maintenance signals into a reviewed cleanup queue, then verify authorized changes against the same baseline. Optimize regression protection per maintenance cost; do not optimize for zero mocks, minimum test count, or coverage percentages.

## Select the requested stage

- **Policy update:** synchronize affected guidance, metric interpretations, and executable rules; validate those changes without starting an unrelated test cleanup.
- **Analysis:** collect counts, interpret candidates against current policy, and report limitations. Analysis does not authorize cleanup.
- **Shortlist:** rank candidates, inspect contracts, and provide the requested number of files with reasons and proposed actions. Preserve any existing user-selected list.
- **Cleanup:** review every selected file, delete/merge/rewrite low-value cases, and retain valuable coverage with a reason. A selected file need not change if its tests are justified. Include dependent fixture consumers when necessary and disclose this expansion.

Read [frontend-testing](../frontend-testing/SKILL.md), the nearest `AGENTS.md`, and the owner's testing policy before interpreting violations or changing tests. Those documents own test boundaries and validation commands; this skill adds an audit workflow, not another testing policy.

## Keep the workflow aligned with test policy

On every invocation, read the current owner policy: `web/docs/test.md` for Web and `packages/dify-ui/docs/testing.md` for Dify UI. Also follow their linked validation guidance. Do not rely on remembered policy or a previous report. Read the policy-to-review mapping in [metrics and commands](references/metrics.md); use it to identify requirements that syntax counts cannot establish.

When changing either testing policy, check this skill, its mapping, and relevant scanner/ranking rules in the same change. Update affected guidance and executable rules, verify their behavior on representative examples, and leave unaffected rules alone. Do not copy the full policy here or create a competing command list. If policy and this workflow disagree, the current owner policy wins; explain any resulting change to the audit interpretation.

Reports include hashes of the applicable policy documents. A changed hash invalidates direct before/after comparison until both source baselines have been rescanned and reviewed under the same current rules. Do not edit old report hashes to bypass this check. A policy change may affect manual interpretation even when the scanner code does not change.

## Establish a reproducible baseline

Record the commit, working-tree changes, selected directories, runner projects, and exact candidate paths. Existing uncommitted changes are part of the baseline, not work to discard. Save reports outside source directories. Freeze a path manifest when a shortlist becomes the cleanup scope.

Read [metrics and commands](references/metrics.md) before running the bundled scripts. Inventory unit, browser, Storybook, and support files separately. Include shared fixtures and custom helpers in the audit scope, even when only spec files appear in the requested shortlist. Compare the scanner's filename conventions with the current runner configuration.

Use AST counts rather than raw text matches for mocks, assertions, and calls. Keep three distinct concepts:

- **Inventory:** syntactic occurrences and affected-file counts, including legitimate uses.
- **Candidates:** heuristic signals requiring review; report false-positive limitations.
- **Confirmed violations:** manually verified against a specific current owner rule, with file/line evidence. Never label all scanner findings as violations or add overlapping metrics into a total violation count.

## Prioritize and inspect

Default to **behavior quality** when the user asks to reduce maintenance cost or find low-value tests. Read [behavior review](references/behavior-review.md) before selecting files. The default ranking alternates independent mock-boundary and behavior-value queues. Type/assertion and test-setup hygiene has a separate opt-in queue; do not let easy type fixes fill a quality shortlist. Scores locate evidence to inspect, not violations. High mock count alone does not justify removal.

For each shortlisted file, trace **scenario → production behavior owner → replaced dependencies → assertion**, and inspect overlapping owner tests. Explain which realistic production regression would fail the test. Distinguish a useful isolated boundary from a test that only exercises its own replacement. Assign **delete**, **merge**, **rewrite**, or **retain** with source evidence. A callback assertion may protect a public integration contract; it is not automatically low-value. If the user asks for more files, extend the reviewed queue without silently replacing their selections.

Present confirmed findings separately from unresolved candidates and justified mocks. Include the owner, mock/expect evidence, overlap, proposed action, and valuable behavior to preserve. A quality shortlist must not consist of cast fixes with no behavior analysis. Use targeted temporary mutation experiments only when they resolve a material doubt; a surviving mutation proves a gap only for that mutation and the executed tests.

Carry review history **per dimension** (`mock-boundary`, `behavior-value`, `typing`). A typing cleanup never exempts a file from quality review. The ranking checks source, scanner, policy, and review-method hashes; optionally recorded owner/dependency hashes also invalidate stale decisions. Legacy whole-file records are displayed but do not defer anything. Record only dimensions actually reviewed and describe remaining gaps. Never translate an old `cleaned` label or a raw ranking into a quality-review decision.

Common cleanup candidates include empty render checks, unreachable inputs manufactured through casts, private implementation callbacks, incidental CSS assertions, repeated prop passthrough, and duplicated state matrices with no distinct failure mode. Validate this judgment against the actual scenario. Preserve meaningful permissions, message trust, races, caching, lifecycle, errors, keyboard, focus, and data-transformation regressions even when their setup is substantial.

## Refactor without hiding debt

Keep the behavior owner real and isolate dependencies at the boundary allowed by current policy. Replace incomplete cast-heavy objects with valid typed fixtures or builders; use existing fixtures before introducing a shared abstraction. Remove a case when its supposed behavior is unsupported or already proved by a stronger owner test.

- Do not trade `as never` or `as unknown as T` for `any`, non-null assertions, broad partial types, suppression comments, or weaker assertions merely to improve counts.
- Moving setup into a helper is consolidation, not elimination. Audit changed/new helpers and their consumers before claiming reduced mocks or unsafe assertions.
- Keep justified external SDK or browser-environment adapters narrow. Explain the missing contract instead of encoding a particular emulator workaround as universal practice.
- Removing a shared hook mock may activate real query dependencies. Update affected consumers with fresh clients and valid seed/service data, then run those consumers.
- Preserve isolation when sharing fixtures. Avoid accidentally modifying globally shared spies through a fake instance.

## Verify and report

Work in coherent batches and use the owner's required commands. Run affected contracts and all consumers of changed shared fixtures. Expand verification for a concrete unresolved risk, not merely to rerun passing checks.

Investigate failures under comparable conditions: commit, dirty state, runner, worker count, coverage, timers, and timeouts. A parallel timeout and a passing serial run do not establish a pre-existing failure. Correct the interaction sequence or boundary model before introducing sleeps or retries. If verification remains blocked, report the exact gap; do not claim completion or silently drop the failing contract.

Rescan using the same scanner and directory scope. Compare the frozen manifest and the entire audited scope, including added/removed files and changes outside the shortlist. Explain retained unsafe adapters and files left unchanged. Lead with behavior owners restored, low-value cases removed/merged, regression contracts preserved, and justified mocks retained. Report syntax deltas separately, followed by validation outcomes and unresolved gaps. Distinguish successful focused reruns from a single green aggregate run. Do not call a percentage reduction in syntax a percentage improvement in test quality.
