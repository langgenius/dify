# Builder first MVP safety foundations implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Prevent diagnostic credential disclosure, unapproved sensitive repairs and out-of-scope node generation through actual backend owner paths.

**Architecture:** Add focused deterministic Builder policies around existing cognition/preflight/write owners. Preserve native workflow execution and immutable verification evidence. Implement sequentially because tasks share Fix cognition/preflight code.

**Tech Stack:** Python, dataclasses, pytest, Flask service owners, existing graphon validation.

**Spec:** `docs/superpowers/specs/2026-10-09-builder-mvp-safety-design.md`.

## Global Constraints

- Product changes are backend-only; frontend gaps remain recorded.
- Do not rewrite or delete original native Runs, failed Runs, published versions or unrelated graph configuration.
- Preserve tenant/app/actor ownership and execution-revision CAS checks.
- Do not change shared cmd+K behavior or graphon dependencies.
- No secret plaintext in diagnostic prompts or new logging.
- Run backend commands through `uv run --project api`; integration tests remain CI-owned.
- Reuse `/Users/chongbinyao/dify/dify/api/.venv` with `UV_PROJECT_ENVIRONMENT` and `--no-sync`; do not change dependency manifests/locks.
- Keep source changes in this isolated worktree; release only after independent review and meaningful checks.

## Review Focus

- Known graph credentials repeated inside free-text errors must be redacted before truncation.
- Nested arrays/objects and authorization/header containers must not evade sanitization.
- Whole-node updates containing an unchanged model must remain eligible for a genuinely low-risk repair.
- An existing old Agent/HITL node must not make unrelated supported graph edits fail.
- Direct draft-write callers must not bypass the candidate node boundary.

### Task 1: Safe Fix diagnostic context

**Files:** Create `api/services/dify_builder/diagnostic_context.py`; modify `api/services/dify_builder/agent/fix.py`; create `api/tests/unit_tests/services/dify_builder/test_diagnostic_context.py`; extend `test_fix_cognition.py`.

**Interfaces:** Produce `redact_run_context(failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> tuple[Run, list[NodeOutput]]` for the model-facing copy. Inputs and persisted objects must remain unmodified. Reuse the existing redaction sentinel where appropriate; do not broaden configuration-write sentinel handling.

- [ ] Write a failing owner-path test capturing the diagnostic prompt for a failed HTTP node containing nested `api_key`/authorization/header values and an error repeating a graph credential. Assert each credential is absent, the useful failure/status fields remain, and original Run/Graph/NodeOutput objects equal deep copies. Include a launch failure, long text, falsey values and an innocuous ordinary field named `key`.

```python
before = deepcopy((failed_run, graph, outputs))
fix.diagnose(model, failed_run, graph, outputs)
assert secret not in captured_prompt
assert "connection refused" in captured_prompt
assert (failed_run, graph, outputs) == before
```

- [ ] Run the new tests and record the expected secret-in-prompt RED failure.
- [ ] Implement recursive safe copying, structured-sensitive-field redaction and known graph credential replacement in text; call the adapter before building the diagnostic prompt. Preserve useful safe error text rather than hiding every failure.
- [ ] Run diagnostic/Fix cognition owner suites and scoped lint/type checks; save actual command/output in the report.
- [ ] Self-review and commit only the task-owned source/tests. Hand the controller the commit range, exact test evidence and limitations.

### Task 2: Deterministic sensitive mutation approval

**Files:** Create `api/services/dify_builder/mutation_policy.py`; modify `api/services/dify_builder/agent/fix.py`; create `api/tests/unit_tests/services/dify_builder/test_mutation_policy.py`; extend `test_fix_cognition.py`.

**Interfaces:** Produce `sensitive_change_reasons(graph: Graph, intents: list[MutationIntent]) -> list[str]`, comparing real before/after semantics without trusting the model's risk label. Existing `_shape_risk` consumes reasons and requires approval when nonempty.

- [ ] Write RED regressions for LLM provider/name changes, tool credential/resource switches, Start input/End output contract changes, HTTP target/auth changes, and conversation-variable/data-access changes. Include whole-node replacement with identical model/resource fields and a Prompt-only change as positive controls.

```python
risk = fix._shape_risk(model_switch_intents, graph, Risk(level="low"))
assert risk.level == "high"
assert fix._shape_risk(prompt_only_intents, graph, Risk(level="low")).level == "low"
```

- [ ] Observe the unapproved model-switch RED failure through production risk shaping.
- [ ] Implement deterministic before/after inspection using existing graph mutation semantics; preserve structural/external guards and ensure malformed proposals still fail native preflight.
- [ ] Run mutation-policy, Fix cognition and core Fix handler suites; save the tested commit and covering evidence.
- [ ] Self-review and commit task-owned changes; receive independent task review before the next task.

### Task 3: Enforced first-phase node boundary

**Files:** Create `api/services/dify_builder/node_policy.py`; modify `api/services/dify_builder/preflight.py`, `api/services/dify_builder/dify_port.py`, `api/services/dify_builder/agent/build.py`; extend `test_preflight.py`, `test_dify_port_preflight.py`, `test_build_cognition.py`; create `api/tests/unit_tests/services/dify_builder/test_node_policy.py`.

**Interfaces:** Produce `proposal_policy_rejections(graph: Graph, intents: list[MutationIntent]) -> list[str]`. Both preflight and the final write entry consume the same policy. Apply it to proposed effects/operations, rather than rejecting a historical graph merely because it contains old nodes.

- [ ] Add RED tests for create/insert of Knowledge Retrieval, legacy Agent, fabricated New Agent and old HITL; config/binding changes on Retrieval; direct write bypass attempts. Positive controls preserve unchanged historical Agent/HITL/Retrieval and support Code/LLM/List Operator/container markers.

```python
vetted = preflight.vet_intents(graph, forbidden_intents, all_builtin_types)
assert vetted.rejections or vetted.would_run_wrong
assert preflight.vet_intents(historical_graph, safe_intents, all_builtin_types).applicable
```

- [ ] Observe candidate/direct-write RED failures before changing production code.
- [ ] Enforce the policy at candidate and write boundaries, route rejection into existing corrective/error handling, remove the Builder-specific Retrieval/HITL recommendations and dataset grounding. Do not alter shared cmd+K prompts or remove historical graph nodes.
- [ ] Run affected preflight/write/build/Fix/Edit owner suites; preserve all known supported-node tests.
- [ ] Self-review and commit task-owned changes; receive independent task review.

### Task 4: Whole-slice verification and handoff

**Files:** Task reports/progress/review packages in this plan's ignored SDD workspace; no additional product feature.

- [ ] Review the full range from the recorded base, resolving Important/Critical findings with scoped fix/re-review cycles.
- [ ] Run the affected Builder service/core suites once on the final source and scoped lint/type checks. Report baseline issues by name; do not claim a whole-repository green state.
- [ ] Verify tracked primary checkout is unchanged; inspect committed worktree diff for unrelated files or secret literals.
- [ ] Update ENG-1178 with exact implemented scope and validation; keep safe execution consent and the broader lifecycle/resource roadmap explicitly outstanding.

## Subsequent backend slices

The audit at `/Users/chongbinyao/dify/dify/.superpowers/sdd/2026-10-09-mvp-gap-audit/mvp-gap-assessment.md` remains the roadmap. After this slice: safe external execution/consent, Conversation/Task ownership with Stop/Suspended, atomic DSL diff adaptation, actor-aware resources and published Agent binding, admin configuration, semantic acceptance/minimum regression, bounded repair/idempotency, and plan/attachment/metadata completion each get their own concrete spec/plan. This plan does not declare those deliverables complete.
