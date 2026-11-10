# Builder task continuity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement the approved three-part ENG-1185 backend scope. Steps use checkbox syntax for tracking.

**Goal:** Complete deterministic Task summaries, confirmed unrelated Fix switching, and durable abandon/clear without weakening existing execution controls.

**Architecture:** Extend existing Builder context, SQL repository, owner-scoped controls and native cancellation. A stable logical task ID is distinct from execution generation; one new intent table and one additive Run lineage column support durable Fix intake without interrupting the current worker.

**Tech Stack:** Python, existing Flask Console transport, SQLAlchemy/PostgreSQL JSONB, Redis/Celery, existing native execution and Builder contracts.

**Spec:** `docs/superpowers/specs/2026-10-30-builder-task-continuity-design.md`.

## Global constraints

- Dify monorepo only; no frontend implementation or ENG-1240 change.
- Keep the existing Graphon dependency, native execution and safety confirmations.
- Never replay unknown external effects or unknown enqueue acknowledgements.
- Preserve account/tenant/app ownership, Session CAS, stable Run evidence and the single workflow writer.
- Clear performs no revision/DSL read, cognition request, ProcessTrace or new Run.
- No new test-double/ignore exceptions; use existing fixtures and real database races.

## Review focus

- Resume changes the execution generation but not the logical task identity.
- Preparing a Fix must not change Session.version while a worker is active.
- Cancellation pending/unknown must not become a new task or duplicate dispatch.
- Cleared historical payloads must stay inaccessible through old cursors, receipts, attachments, SSE and native commands.
- A worker cleared between its last check and checkpoint/Run/input insertion must be fenced in that SQL transaction.

### Task 1: Stable task identity and deterministic completion history

**Owner:** task-summary implementer.

**Files:** `api/core/dify_builder/models.py`, `api/services/dify_builder/serde.py`, new `task_lifecycle.py`, `conversation_tasks.py`, six completion exits in application handlers, existing agent/LLM context scope; focused unit tests.

**Interfaces:** Export `task_identity`, `advance_task_identity`, `record_task_completion`, `mark_task_abandoned` as specified. Add context fields `logical_task_id`, `logical_task_ordinal`, `task_status`, `task_summaries`, and domain Run `origin_task_id` defaulting to empty for legacy data. Do not edit service/controller/SessionView DTO files owned by integration.

- [ ] Add failing tests for generation-independent identity, repeated completion, false/missing verification, publish failure, redaction and raw-output exclusion.
- [ ] Implement typed bounded summaries and serialization compatibility; call only actual keep/publish completion exits.
- [ ] Consume bounded summaries in subsequent cognition without recursive goals or inherited consent.
- [ ] Test abandoned settled continuation and preservation of old immutable Run evidence.
- [ ] Pin attachment receipt compatibility: execution generation remains its existing scope, is not treated as logical task ownership, and cannot carry pending material into a switched task.
- [ ] Run focused conversation/summary/handler tests, Ruff and type checks; hand off the exact diff and results for review.

### Task 2: Durable abandon/clear and cancellation reuse

**Owner:** lifecycle implementer.

**Files:** new `api/services/dify_builder/conversation_lifecycle.py`, existing `repository.py`, task/native admission and native projection owners, focused real-DB/unit tests. Root integration owns the direct SSE forwarding in `wiring.py`; no lifecycle implementer service/controller/domain DTO edits.

**Interfaces:** `clear(service, session_id, actor, *, base_version, client_action_id, expected_task_id='', confirmed=False) -> dict`; `abandon` same without confirmation; `is_conversation_cleared(context)`; `cleared_session_view(session,context)`; `stop_task_for_switch(...)`; `observe_task_stop(..., deliver=False) -> settled|pending|unknown`.

- [ ] Add failing no-graph/no-cognition/no-enqueue clear tests, idempotent receipts, stale task/key conflicts and actor scoping.
- [ ] Add Session transaction lifecycle controls, permanent clear floor/tombstone, public-history/material/native-projection isolation and safe private execution audit retention.
- [ ] Reuse cancellation outside SQL; preserve pending/unknown and compare-release only the captured writer.
- [ ] Fence checkpoint/Run/test-input inserts within SQL; derive/read the new `origin_task_id` Run lineage.
- [ ] Test clear/Resume/new-task races, stale worker writes, old receipt/cursor/SSE/native commands and unchanged Draft/published/Run data.
- [ ] Run focused tests and real PostgreSQL/Redis integration; provide the control interfaces to Fix implementation.

### Task 3: Independent Fix intent persistence and confirmed switching

**Owner:** Fix implementer.

**Files:** new `fix_intents.py`, `fix_intent_repository.py`, `api/models/dify_builder.py`, one additive migration, focused tests. Do not edit root integration files or the main repository.

**Interfaces:** `prepare_fix_intent(...)`, `submit_fix_intent(...)`, `pending_fix_projection(...)`; repository `select_conversation(actor,app_id,requested_session_id=None)` and locked prepare/activate/replay methods. Consume stable task identity and lifecycle stop/observe helpers.

- [ ] Add failing tests for preparing while a worker runs without advancing the Session head, exact related Run lineage, cross-app rejection and one pending intent.
- [ ] Add the FixIntent row and nullable Run origin-task column using the current migration head, with valid downgrade and no data rewriting.
- [ ] Implement owner-scoped validated intake and generic explicit decision; preserve the current task on dismiss.
- [ ] Confirm stop before switch, block pending/unknown, re-read current DSL and activate same-Conversation Fix atomically with immutable source Run and once-only dispatch receipt.
- [ ] Cover Completed/Idle/safely Abandoned intake and natural completion while an offer is pending: no unnecessary stop, no Completed-to-Abandoned rewrite, and no bypass of unsettled/unknown effects.
- [ ] Test stale intent/task, conflicting idempotency key, enqueue ACK unknown, late worker write and historical Run from another logical task.
- [ ] Run focused and real database tests; hand off model migration and exact APIs for integration.

### Task 4: API integration and existing create-Fix compatibility

**Owner:** root integrator.

**Files:** Console Builder route/fields, core contract SessionView, `service.py`, schema contract artifacts and integration tests.

- [ ] Add failing authenticated route/DTO tests for fix intake, explicit confirm, abandon and confirmed clear.
- [ ] Expose additive task metadata/summaries and Fix decision projection. Dispatch intent controls before ordinary busy/native gates; clear/abandon use independent JSON receipts and a no-graph cleared GET path.
- [ ] Make the existing create-Fix route select/reuse the caller's owned non-cleared conversation, with explicit-selection isolation and serialized no-conversation creation.
- [ ] Bind `dify_port._reserve_full_run` to the stable task ID under its existing fence; keep legacy attachment receipt generations separate from logical task identity.
- [ ] Preserve existing no-session Fix behaviour, ordinary action contracts, completed continuation and current-task repair.
- [ ] Generate required backend OpenAPI/type contracts without developing frontend UI; document examples and frontend integration gaps.
- [ ] Guard `wiring.py` direct SSE forwarding against cleared Sessions so already-open subscriptions cannot emit pre-clear payloads; verify that delayed native outcomes remain private audit only.

### Task 5: Review, Local E2E, CI and Dev acceptance

- [ ] Fresh independent review of spec coverage, authorization/clear privacy and all races; fix findings with meaningful tests.
- [ ] Run targeted suites, import contracts/type/style checks, strict Builder test inventory, migration dialect tests and complete Builder regressions.
- [ ] Local synthetic E2E: completed-task continuation/summary; unrelated Fix prepare/dismiss/confirm/settlement; abandon/new goal; clear while waiting and while blocked worker is late. Assert no duplicate Run/effect and no old history revival; preserve screenshots and sanitized Trace.
- [ ] Commit and push backend directly to `feat/dify-builder`; run full Main CI and Builder CI, fix any failure without ignores or weakening assertions.
- [ ] Build and qualify official same-commit image, review migration and safe drained Dev rollout, preserve live configuration/queues and unknown history.
- [ ] Dev synthetic E2E, source/schema/pod qualification, Linear evidence update and precise In Review decision for ENG-1185; create only the needed frontend follow-up documentation/ticket.
