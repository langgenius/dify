# Builder New Agent ordinary Test Run acceptance

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent fixes and review. The user approved this execution order on 2026-10-17.

**Goal:** Verify a published Workspace New Agent through discovery, a real Workflow binding, risk confirmation, ordinary native execution, persisted results and replay-safe recovery, Local before Dev.

**Architecture:** Reuse the existing Agent catalog, binding/publish owner, ordinary Workflow Test Run and Agent backend. Keep the confirmed-run reservation from `fcdab9395a`; adapt only demonstrated gaps at existing owners.

**Tech stack:** Dify API/Agent, PostgreSQL/Redis, Graphon 0.7.0, pytest, normal Builder image and Helm workflows.

**Spec:** `docs/superpowers/specs/2026-10-14-builder-unified-native-testing-design.md`, interpreted under root AGENTS.md and the user's 2026-10-17 ordinary-runtime/simplicity direction. This acceptance slice replaces obsolete cross-repository prerequisites, not the original product goals.

## Constraints and review focus

- No frontend implementation, external repository modification, dependency substitution or hotpatched runtime.
- Keep current Workspace permissions and published Agent identity/snapshot; disclosure does not grant new permissions.
- Mock is an explicit simulated result, initializes no real Agent backend and never qualifies publication.
- A confirmation must not silently execute a newly published snapshot, a different Agent or a revoked identity.
- Reuse the same parent Run on recovery. Record cancellation and uncertain outcomes honestly; a timeout does not prove remote cleanup.
- Acceptance data is synthetic; use the already configured DeepSeek model. No mailbox, destructive action or external business endpoint is part of this fixture.
- Distinguish actual planning/model execution from operator-seeded fixtures in all evidence.

## Task 1: Confirmed Agent selection at the ordinary node boundary

**Files:** Existing `services/dify_builder/native_testing/agent_binding.py`, existing Agent-v2 caller/resolver and their tests. Root owns any full-run caller integration.

- [x] Reproduce post-confirmation Agent publication/identity/permission drift before backend dispatch.
- [x] Reuse graph-selected Agent ID/snapshot and current actor authorization at the ordinary Builder node boundary; preserve non-Builder and pinned participant semantics.
- [ ] Run targeted unit and real PostgreSQL binding tests; independently review.

- [x] Carry allowlisted published input/dependency contracts and labeled public capability descriptions through initial planning, recommendation and selected generation; bind the resource on the Agent step.

## Task 2: Honest dependency-free Agent Mock

**Files:** `services/dify_builder/effect_mock.py`, existing `core/workflow/node_factory.py` caller, `test_effect_mock.py`.

- [x] Reproduce unconfirmed Agent backend initialization and legacy output/route shape failures.
- [x] Return a marked native-shape mock without creating real runtime dependencies; retain custom output declarations and configured routes.
- [x] Run mock/factory regressions; independently review.

- [x] Display selected Agent/snapshot and nested-target uncertainty in the existing confirmation interaction; keep legacy behavior and native Mock constructor/start-event invariants.

## Task 3: New Agent cancellation/recovery regression coverage

**Files:** Focused tests under existing Builder/Agent-v2 test owners; no overlapping production ownership.

- [x] Cover same saved-input recovery with an Agent graph, cancellation propagation and actual failure/uncertainty semantics.
- [x] Keep the parent's durable reservation as dispatch owner; do not claim an unused child idempotency field guarantees exactly-once execution.
- [x] Report any production gap before expanding this task; independently review test quality and claimed limits.

## Task 4: Real Local then Dev acceptance and publication of evidence

**Owner:** Root, sequential shared-stack operations.

- [ ] Create an owned published synthetic contract-review Agent and discover it through the current Builder resource owner; save a real Start → New Agent → End binding with declared `risks`/`summary` outputs.
- [ ] Verify unconfirmed Mock and explicitly confirmed real Agent execution, actual child/parent IDs, snapshot, model use and persisted output. Reenter the same attempt and verify no new parent or child launch.
- [ ] Verify drift refusal and cancellation/failure without hidden-state browser manipulation. Save complete redacted backend Trace and full-page screenshots of actual native results.
- [ ] Run appropriate checks and independent combined review, build normal images, verify Local on the exact source, then deploy through normal Helm CI and repeat Dev cases on verified actual Pods.
- [ ] Upload evidence to ENG-1177 and relevant linked tickets. Change status only for the acceptance actually completed; disclose residual gaps.
