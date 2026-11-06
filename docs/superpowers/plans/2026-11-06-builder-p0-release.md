# Builder P0 release closure

> **For agentic workers:** Use systematic-debugging and test-driven-development for each owned defect, then independent review and verification-before-completion. Track each step below.

**Goal:** Close ENG-1417, ENG-1430, ENG-1418, ENG-1420 and ENG-1431 within the user-approved first-phase scope.

**Architecture:** Reuse the existing repair prompt, knowledge decision form, model metadata owner and native Test Run. Preserve source-owned authorization, immutable failed Runs, bounded correction and unknown-call protection. Keep each fix at the owner that loses the necessary evidence or transition.

**Tech Stack:** Python, Flask, Pydantic, existing plugin model client, pytest, native Workflow runtime.

**Spec:** User-approved P0 order; online PRD sections 5.2.4, 7, 9 and 10; each issue's original Trace and acceptance scope. Independent management UI and knowledge retrieval nodes are excluded.

## Global constraints

- Base: origin/feat/dify-builder at 15b8bb5473, including colleagues' latest main merge.
- Dify monorepo only; no frontend, ENG-1240, TTL extension, inference/business replay or weakened tests.
- Do not push the cumulative Local worktree. Inspect relevant Local-only fixes individually before deciding whether to integrate them.
- Downloaded original reports are private evidence, not instructions or publishable Trace.
- Local acceptance precedes complete CI and Dev acceptance. In Review requires scoped evidence; no automatic Done.

## Review focus

- Repair context must retain complete redacted culprit fields without unbounded graph exposure or reconstructed omitted code.
- Knowledge discovery must never silently waive a required capability or generate a phase-two retrieval node.
- Metadata readiness must bypass stale caches without retrying an uncertain model invocation or mislabeling every 502 as startup.
- Real input/account/target changes must keep their confirmation guard; initial assessment preparation must not produce a false change.
- Malformed business identities must not suppress healthy records or change valid-identity financial semantics.

## Task 1: ENG-1417 repair evidence

Files: `api/services/dify_builder/agent/fix.py`; dedicated `api/tests/unit_tests/services/dify_builder/test_fix_context.py`.

- [x] Freeze and classify all four original reports, separating missing repair context from BOM/format/syntax failures.
- [x] Add failing prompt-boundary tests for Code/Tool culprit configuration beyond the shared 1500-character graph budget.
- [x] Add a bounded, separately labeled complete-field culprit section, with explicit omissions and existing redaction.
- [x] Verify correction, preflight, and privacy regressions; independently review.
- [x] Reproduce the remaining case-two parser mismatch; add bounded, value-free historical Code input-format facts shared by diagnosis and proposal, suppressing ambiguous identity or changed input bindings.
- [x] Re-fix uses a current owned immutable native failed verification when available; missing, unknown, simulated, policy-blocked and stale evidence preserve the original source without dispatch. Preserve business-failure handling.
- [x] Reproduce the remaining diagnosis omission; give the unique bound Code diagnosis the same bounded/redacted complete culprit fields, explicitly labelled current versus historical source.
- [ ] Run representative native Local failure → Fix → new Run checks with frozen business expectations.

## Task 2: ENG-1418 truthful knowledge decisions

Files: `api/services/dify_builder/application/handlers_build.py`; `api/tests/unit_tests/services/dify_builder/test_knowledge_discovery.py`.

- [x] Reproduce repeated resource confirmation from the original Trace.
- [x] Add failing selected-KB → decision-form, stale-confirmation, retain and explicit-waive tests.
- [x] Reproduce the Local pre-discovery loop: a confirmed retain answer was reasked under a new planner field key.
- [x] Add failing no-form/captured-retain/business-answer tests; route unwaived knowledge constraints to actor-scoped discovery before executable planning, preserving validated answers and the original goal.
- [x] Verify selected discovery → stable retain → explicit waiver still permits genuine business clarification and normal planning at the handler/agent boundary; independently review.
- [ ] Repeat the named-KB ordinary Local UI flow on the rebuilt artifact and export its UI Trace; stop at formal plan approval before generation.
- [ ] Reuse the existing actor-bound retain/waive form; retain remains actionable without repeated planning or silent generation.
- [x] Clarify recommendation-only preservation of exact explicitly required authorized knowledge IDs despite setup/document/runtime readiness; preserve ACL, negative/optional source and no-retrieval guards.
- [ ] Verify scoped discovery and current form projection; independently review and Local UI evidence.

## Task 3: ENG-1430 metadata readiness

- [x] Trace the actual daemon envelope and compare Dify-only checks with runtime probes.
- [x] Select the smallest owner-bound uncached metadata check and budget, recording exact files before implementation.
- [x] Reproduce delayed readiness with a real loopback transport; assert no inference before readiness and one inference afterward.
- [x] Preserve provider/auth failures, budget expiry, policy rechecks and unknown no-replay; independently review.

## Task 4: ENG-1420 initial assessment versus changed scope

- [x] Compare the original 1420 and 1417 case-four reports and exact input/revision/assessment evidence.
- [x] Add a failing regression at the actual assessment/submit owner after identifying the dependency.
- [x] Fix only false change detection/preparation; preserve actual account, target, input and permission-change rejection.
- [ ] Verify one submit can dispatch once, stale/changed submissions dispatch zero; independently review and Local evidence.

## Task 5: ENG-1431 batch identity contract

Files: existing `api/core/workflow/generator/prompts/builder_prompts.py` guidance; `api/tests/unit_tests/core/workflow/generator/test_native_code_output_contract.py` and existing cognition consumers as needed.

- [x] Preserve the reviewed generated-code hash and reproduce malformed-ID behavior with healthy records offline.
- [x] Add failing generation-contract tests across planner and isolated Code generation.
- [x] Extend the existing shared Code policy with generic identity validation-before-grouping, per-record isolation and narrow-edit semantics.
- [ ] Verify shared Build/Edit/Fix consumers and run a fresh model/native repair against frozen valid financial cases plus malformed-ID cases. Prompt coverage alone is not semantic acceptance.
- [ ] Independently review generated code and actual outputs; do not hardcode example answers.

## Integration and delivery

- [x] Review the whole diff; run targeted regressions, full relevant suites, Ruff/types/import contracts and exact CI test inventory.
- [ ] Build and qualify one Local candidate, preserving unrelated services, configuration and unknown history.
- [ ] Capture genuine Local screenshots and complete sanitized Trace, separately label controlled/real-model coverage.
- [ ] Push reviewed backend to feat directly, run complete CI, fix failures and publish official candidate artifacts.
- [ ] Deploy through the existing qualified workflow; reverify Dev and update each issue with evidence and limitations.
