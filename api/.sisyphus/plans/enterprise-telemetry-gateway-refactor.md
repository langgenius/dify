# Enterprise Telemetry Gateway Refactor

## TL;DR

> **Quick Summary**: Refactor enterprise telemetry into a unified gateway pattern. Gateway becomes the single entrance for all telemetry data, making two routing decisions (data type + CE eligibility), then dispatching to existing trace pipeline or a new enterprise metric/log pipeline. CE trace path stays completely untouched.
>
> **Deliverables**:
> - `TelemetryGateway` — single entrance, routing decisions, before-queue (handles both EE and CE routing)
> - `EnterpriseMetricHandler` — after-queue case processor for metric/log events
> - Envelope contracts (Pydantic models) for queue payloads
> - Dedicated Celery queue + worker for enterprise metric/log events
> - Idempotency store (Redis TTL) for counter deduplication
> - Event handlers migrated to enqueue-only producers
>
> **Estimated Effort**: Medium (multiple PRs, ~2-3 days)
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6

---

## Context

### Original Request
Refactor enterprise telemetry so that:
1. A single gateway is the only entrance for all telemetry data.
2. Gateway routes by data type (trace vs metric/log) and CE eligibility.
3. Metric/log-only events move off the synchronous request path into async processing.
4. Large payloads are handled via pointer+fallback pattern.
5. CE trace pipeline remains completely unchanged.

### Interview Summary
**Key Discussions**:
- Gateway lives before-queue (producer-facing), not after-queue.
- "Gateway" in earlier drafts was actually a case handler; renamed to `EnterpriseMetricHandler`.
- `EnterpriseOtelTrace` stays as enterprise trace signal handler (spans + companion logs + counters for trace-shaped events). Gateway does NOT replace it for trace cases.
- `TraceQueueManager` stays as dumb transport (no routing logic changes).
- Unified enqueue routes to correct queue based on data type classification.
- Event handlers (`event_handlers.py`) become enqueue-only producers.
- Oracle review confirmed: keep CE dispatch in `process_trace_tasks`, gateway enterprise-only for metric/log path, two transport paths.

**Research Findings**:
- 5 scattered routing checks today across `facade.py`, `ops_trace_manager.py`, `ops_trace_task.py`, `enterprise_trace.py`. Gateway consolidates producer-side decisions to 2 checks in 1 place.
- `_ENTERPRISE_ONLY_TRACES`: `DRAFT_NODE_EXECUTION_TRACE`, `NODE_EXECUTION_TRACE`, `PROMPT_GENERATION_TRACE`.
- `EnterpriseOtelTrace` (845 lines) has 3 span methods + 7 metric-only methods + shared helpers.
- Community trace instances (Langfuse, MLflow, Langsmith, Weave, Opik, Aliyun, Tencent, ArizePhoenix) all extend `BaseTraceInstance`.

### Metis Review
**Identified Gaps** (addressed below):
- No rollback strategy → feature flag added to plan
- Failure modes undefined → degraded-path handling specified per task
- Idempotency spec incomplete → Redis TTL key schema defined
- Dual-path events → addressed: trace events go to trace queue where `process_trace_tasks` already dispatches to both enterprise + CE
- Blinker handler async safety → validation step added before migration

---

## Architecture

### Flow Diagram

```
BEFORE (current):

Business code → TelemetryFacade.emit() → TraceQueueManager → Celery → process_trace_tasks
                                                                          ├── EnterpriseOtelTrace (EE)
                                                                          └── trace_instance (CE)

event_handlers.py → emit_metric_only_event() + increment_counter()  [SYNC in request path]


AFTER (proposed):

Business code ─┐
               ├──→ TelemetryGateway.emit()  (replaces TelemetryFacade entirely)
event_handlers ┘      │
                      ├── Decision 1: data type
                      │     trace-shaped? ──→ TraceQueueManager (EXISTING, unchanged)
                      │                        → Celery ops_trace queue
                      │                        → process_trace_tasks
                      │                          ├── EnterpriseOtelTrace (EE)
                      │                          └── trace_instance (CE)
                      │
                      │     metric/log? ───→ Celery enterprise_telemetry queue (NEW)
                      │                        → EnterpriseMetricHandler.handle(envelope)
                      │                        → case routing → emit/counter functions
                      │
                      └── Decision 2: CE eligibility (judged before decision 1) 
                            enterprise-only + EE disabled → DROP
                            otherwise → enqueue
```

### Component Responsibilities

```
Component                        Owns                              Does NOT own
───────────────────────          ──────────────────────────         ─────────────────────
TelemetryGateway                 routing decisions (2 checks)      processing logic
(NEW, before-queue)              envelope creation                 OTEL SDK calls
                                 queue selection                   data construction

EnterpriseMetricHandler          case-by-case metric/log policy    transport/queue
(NEW, after-queue worker)        rehydration (ref→data)            trace dispatch
                                 idempotency enforcement           CE routing
                                 emit_metric_only_event calls
                                 counter/histogram calls

TraceQueueManager                in-process batching               routing decisions
(UNCHANGED)                      Celery handoff                    business policy

process_trace_tasks              enterprise vs CE dispatch         routing decisions
(UNCHANGED)                      file cleanup                      metric-only events

EnterpriseOtelTrace              span emit (workflow/node/draft)   metric-only events
(UNCHANGED initially)            companion logs + trace counters   (after handler exists)

EnterpriseExporter               OTEL SDK transport                business decisions
(UNCHANGED)                      span/counter/histogram/log        routing/policy
```

### What Changes vs What Stays

```
UNCHANGED                              NEW / MODIFIED
──────────────────────────             ──────────────────────────
TraceTask (data factory)               TelemetryGateway (new)
TraceQueueManager (batching)           EnterpriseMetricHandler (new)
process_trace_tasks (trace dispatch)   enterprise_telemetry_task.py (new worker)
EnterpriseOtelTrace (span methods)     contracts.py (new envelope models)
CE trace instances (all 8 providers)   event_handlers.py (enqueue-only)
EnterpriseExporter (sink)              TelemetryFacade REMOVED (replaced by gateway)
BaseTraceInstance contract             core/telemetry/__init__.py (re-export gateway)
                                       10+ business call sites (import change)
ops_trace_manager.py internals
```

---

## Work Objectives

### Core Objective
Consolidate enterprise telemetry routing into a single gateway that classifies events by data type and CE eligibility, then dispatches to the appropriate async pipeline — preserving all existing trace and metric emission behavior.

### Concrete Deliverables
- `enterprise/telemetry/gateway.py` — `TelemetryGateway` class
- `enterprise/telemetry/contracts.py` — envelope + context Pydantic models
- `enterprise/telemetry/metric_handler.py` — `EnterpriseMetricHandler` class
- `tasks/enterprise_telemetry_task.py` — Celery worker for metric/log queue
- Modified `enterprise/telemetry/event_handlers.py` — enqueue-only producers
- Removed `core/telemetry/facade.py` — replaced by gateway; all 10+ call sites migrated to `TelemetryGateway.emit()`
- `core/telemetry/__init__.py` updated to export gateway instead of facade
- Unit tests for all new components

### Definition of Done
- [x] All telemetry events route through gateway
- [x] Metric/log events processed asynchronously (not in request path)
- [x] CE trace pipeline behavior unchanged (verified by existing tests)
- [x] Enterprise trace span behavior unchanged
- [x] Idempotency prevents duplicate counter increments on retry
- [x] Feature flag enables/disables gateway routing at runtime

### Must Have
- Single entrance for all enterprise telemetry
- Two routing decisions: data type + CE eligibility
- Async metric/log processing via dedicated queue
- Payload ref + fallback contract for large data
- Idempotency via Redis TTL
- Feature flag for rollout

### Must NOT Have (Guardrails)
- DO NOT modify `TraceQueueManager` internals (keep as dumb transport)
- DO NOT touch CE trace dispatch logic in `process_trace_tasks`
- DO NOT change `EnterpriseOtelTrace` method signatures
- DO NOT modify blinker signal contracts or registration patterns
- DO NOT add new event types (only route existing ones)
- DO NOT change `ops_trace_manager.py` beyond minimal import updates
- DO NOT unify CE and enterprise processing into a shared handler
- DO NOT refactor `EnterpriseOtelTrace` methods (only add wrapper calls)
- DO NOT add complex retry/DLQ logic in v1
- DO NOT optimize `TraceQueueManager` batching

---

## Verification Strategy

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.

### Test Decision
- **Infrastructure exists**: YES (pytest + bun test infrastructure present)
- **Automated tests**: YES (TDD — red/green/refactor)
- **Framework**: pytest

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

Verification is done via:
- `make lint` — Ruff linting
- `make type-check` — BasedPyright type checking
- `uv run --project api --dev dev/pytest/pytest_unit_tests.sh` — full unit test suite
- Targeted pytest for new/modified test files

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: Gateway contracts + routing table
└── Task 2: EnterpriseMetricHandler skeleton + Celery worker

Wave 2 (After Wave 1):
├── Task 3: Gateway implementation (wire routing + enqueue)
└── Task 4: Migrate event_handlers.py to gateway

Wave 3 (After Wave 2):
├── Task 5: Replace TelemetryFacade with TelemetryGateway at all call sites
└── Task 6: Feature flag + integration verification

Critical Path: Task 1 → Task 3 → Task 5 → Task 6
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 3, 4 | 2 |
| 2 | None | 3, 4 | 1 |
| 3 | 1, 2 | 5 | 4 |
| 4 | 1, 2 | 6 | 3 |
| 5 | 3 | 6 | None |
| 6 | 4, 5 | None | None (final) |

---

## TODOs

- [x] 1. Gateway Contracts + Routing Table

  **What to do**:
  - Create `enterprise/telemetry/contracts.py` with Pydantic models:
    - `TelemetryEnvelope`: `event_id` (UUID), `schema_version` (int), `event_name` (str), `signal_type` (Literal["trace", "metric_log"]), `case` (str enum), `context` (TelemetryContext with tenant_id/app_id/user_id), `correlation` (trace_id_source, span_id_source), `core_fields` (dict), `payload_ref` (optional str), `payload_fallback` (optional bytes, max 64KB), `created_at` (datetime)
    - `TelemetryCase` enum: all known cases (WORKFLOW_RUN, NODE_EXECUTION, DRAFT_NODE_EXECUTION, MESSAGE_RUN, TOOL_EXECUTION, MODERATION_CHECK, SUGGESTED_QUESTION, DATASET_RETRIEVAL, GENERATE_NAME, PROMPT_GENERATION, APP_CREATED, APP_UPDATED, APP_DELETED, FEEDBACK_CREATED)
  - Create routing table in `enterprise/telemetry/gateway.py` (data structure only, no logic yet):
    - `CASE_ROUTING: dict[TelemetryCase, CaseRoute]` where `CaseRoute` has `signal_type` and `ce_eligible` fields
    - Trace-shaped + CE-eligible: WORKFLOW_RUN, MESSAGE_RUN (through TraceQueueManager, reaches both EE + CE)
    - Trace-shaped + enterprise-only: NODE_EXECUTION, DRAFT_NODE_EXECUTION, PROMPT_GENERATION (through TraceQueueManager, dropped if EE disabled)
    - Metric/log-only: APP_CREATED, APP_UPDATED, APP_DELETED, FEEDBACK_CREATED, TOOL_EXECUTION, MODERATION_CHECK, SUGGESTED_QUESTION, DATASET_RETRIEVAL, GENERATE_NAME (through enterprise metric queue)
  - Add validation: envelope size checks, required fields by signal_type
  - Write comprehensive unit tests for models and routing table

  **Must NOT do**:
  - Do not implement gateway emit logic yet
  - Do not create Celery tasks yet
  - Do not modify any existing files

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]
    - `git-master`: atomic commit after contracts are defined

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 3, 4
  - **Blocked By**: None

  **References**:
  - `core/telemetry/events.py:10-22` — existing `TelemetryContext` and `TelemetryEvent` dataclass patterns (follow frozen dataclass style)
  - `core/telemetry/facade.py:11-17` — `_ENTERPRISE_ONLY_TRACES` frozenset (source of truth for enterprise-only trace cases)
  - `core/ops/entities/trace_entity.py:214-227` — `TraceTaskName` enum (existing case taxonomy to align with)
  - `enterprise/telemetry/entities.py` — `EnterpriseTelemetryCounter`, `EnterpriseTelemetrySpan` enums (enterprise signal naming patterns)
  - `enterprise/telemetry/enterprise_trace.py:42-80` — `EnterpriseOtelTrace.trace()` dispatcher (case routing reference — maps trace_info types to handler methods)

  **Acceptance Criteria**:
  - [ ] `TelemetryEnvelope` validates correct payloads, rejects missing required fields
  - [ ] `TelemetryCase` enum covers all 14 known cases
  - [ ] Routing table maps each case to correct `signal_type` + `ce_eligible`
  - [ ] Envelope with `payload_fallback` > 64KB is rejected by validator
  - [ ] `pytest tests/unit_tests/enterprise/telemetry/test_contracts.py` → PASS

  **Agent-Executed QA Scenarios**:

  ```
  Scenario: Envelope validation accepts valid trace envelope
    Tool: Bash (pytest)
    Preconditions: contracts.py created with models
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_contracts.py -k "test_valid_trace_envelope" -v
      2. Assert: PASSED
    Expected Result: Valid envelope passes validation
    Evidence: pytest output captured

  Scenario: Envelope rejects oversized payload_fallback
    Tool: Bash (pytest)
    Preconditions: contracts.py with size validation
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_contracts.py -k "test_oversized_fallback_rejected" -v
      2. Assert: PASSED (ValidationError raised)
    Expected Result: Payloads > 64KB rejected
    Evidence: pytest output captured

  Scenario: Routing table correctness
    Tool: Bash (pytest)
    Preconditions: routing table defined
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_contracts.py -k "test_routing_table" -v
      2. Assert: Each case maps to expected signal_type and ce_eligible
    Expected Result: All 14 cases correctly classified
    Evidence: pytest output captured
  ```

  **Commit**: YES
  - Message: `feat(telemetry): add gateway envelope contracts and routing table`
  - Files: `enterprise/telemetry/contracts.py`, `enterprise/telemetry/gateway.py`, `tests/unit_tests/enterprise/telemetry/test_contracts.py`
  - Pre-commit: `make lint && make type-check`

---

- [x] 2. EnterpriseMetricHandler Skeleton + Celery Worker

  **What to do**:
  - Create `enterprise/telemetry/metric_handler.py`:
    - `EnterpriseMetricHandler` class with `handle(envelope: TelemetryEnvelope) -> None`
    - Case dispatch method (isinstance/match on `envelope.case`)
    - Stub methods for each metric/log case: `_on_app_created`, `_on_feedback_created`, `_on_message_run`, `_on_tool_execution`, `_on_moderation_check`, `_on_suggested_question`, `_on_dataset_retrieval`, `_on_generate_name`, `_on_prompt_generation`
    - Rehydration helper: `_rehydrate(envelope) -> dict` — resolve `payload_ref` → data, fallback to `payload_fallback`, emit degraded event if both fail
    - Idempotency check: `_is_duplicate(envelope) -> bool` — Redis GET on `telemetry:dedup:{tenant_id}:{event_id}`, SET with 1h TTL on first seen
  - Create `tasks/enterprise_telemetry_task.py`:
    - `@shared_task(queue="enterprise_telemetry")` decorator
    - Deserialize envelope → call `EnterpriseMetricHandler().handle(envelope)`
    - Error handling: log + drop (best-effort, never fail user request)
  - Register new queue in Celery configuration (check existing queue registration pattern)
  - Write unit tests for handler dispatch, idempotency, rehydration fallback

  **Must NOT do**:
  - Do not implement actual metric emission logic in handlers yet (stubs only)
  - Do not wire any producers to this worker yet
  - Do not modify existing files beyond queue registration

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: [`git-master`]
    - `git-master`: atomic commit for worker skeleton

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Tasks 3, 4
  - **Blocked By**: None

  **References**:
  - `tasks/ops_trace_task.py:18-77` — existing Celery task pattern for telemetry (`@shared_task(queue="ops_trace")`, error handling, storage cleanup)
  - `enterprise/telemetry/enterprise_trace.py:42-80` — `EnterpriseOtelTrace.trace()` case dispatch pattern (isinstance-based routing to follow)
  - `enterprise/telemetry/enterprise_trace.py:407-488` — `_message_trace()` as example of metric-only handler (emit_metric_only_event + counters + histograms)
  - `enterprise/telemetry/telemetry_log.py:102` — `emit_metric_only_event()` function signature (what handlers will eventually call)
  - `extensions/ext_redis.py` — Redis client access pattern (`redis_client`)
  - Celery queue registration: search for `queue=` in `tasks/` directory and Celery config files to find where queues are declared

  **Acceptance Criteria**:
  - [ ] `EnterpriseMetricHandler.handle()` routes to correct stub method per case
  - [ ] Unknown case logs warning, does not raise
  - [ ] Idempotency check returns `True` on second call with same `event_id`
  - [ ] Rehydration falls back to `payload_fallback` when `payload_ref` fails
  - [ ] Rehydration emits degraded event when both ref and fallback are missing
  - [ ] Celery task registered on `enterprise_telemetry` queue
  - [ ] `pytest tests/unit_tests/enterprise/telemetry/test_metric_handler.py` → PASS
  - [ ] `pytest tests/unit_tests/tasks/test_enterprise_telemetry_task.py` → PASS

  **Agent-Executed QA Scenarios**:

  ```
  Scenario: Handler routes APP_CREATED to correct stub
    Tool: Bash (pytest)
    Preconditions: metric_handler.py with stubs
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_metric_handler.py -k "test_dispatch_app_created" -v
      2. Assert: PASSED, _on_app_created called
    Expected Result: Correct case routing
    Evidence: pytest output

  Scenario: Idempotency rejects duplicate event_id
    Tool: Bash (pytest)
    Preconditions: Redis mock available
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_metric_handler.py -k "test_idempotency_duplicate" -v
      2. Assert: PASSED, second call returns True (duplicate)
    Expected Result: Duplicate detection works
    Evidence: pytest output

  Scenario: Rehydration fallback chain
    Tool: Bash (pytest)
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_metric_handler.py -k "test_rehydration_fallback" -v
      2. Assert: PASSED, uses payload_fallback when ref fails
    Expected Result: Graceful degradation
    Evidence: pytest output
  ```

  **Commit**: YES
  - Message: `feat(telemetry): add enterprise metric handler skeleton and Celery worker`
  - Files: `enterprise/telemetry/metric_handler.py`, `tasks/enterprise_telemetry_task.py`, `tests/unit_tests/enterprise/telemetry/test_metric_handler.py`, `tests/unit_tests/tasks/test_enterprise_telemetry_task.py`
  - Pre-commit: `make lint && make type-check`

---

- [x] 3. Gateway Implementation (Routing + Enqueue Logic)

  **What to do**:
  - Implement `TelemetryGateway` in `enterprise/telemetry/gateway.py`:
    - `emit(case: TelemetryCase, context: dict, payload: dict, trace_manager: TraceQueueManager | None = None) -> None`
    - Decision 1 — data type: look up `CASE_ROUTING[case].signal_type`
      - `trace` → build `TraceTask`, pass to `TraceQueueManager.add_trace_task()` (reuse existing path)
      - `metric_log` → build `TelemetryEnvelope`, call `process_enterprise_telemetry.delay(envelope.model_dump_json())`
    - Decision 2 — CE eligibility (trace path only):
      - If `CASE_ROUTING[case].ce_eligible == False` and `not is_enterprise_telemetry_enabled()` → return (drop)
      - Otherwise → enqueue to TraceQueueManager
    - Payload sizing: if payload > threshold, store to shared storage → set `payload_ref`; otherwise inline in `core_fields`
    - Generate `event_id` (UUID4) for each envelope
  - Add feature flag check: `ENTERPRISE_TELEMETRY_GATEWAY_ENABLED` (env var, default False)
  - Write unit tests for routing logic, CE eligibility gating, payload sizing

  **Must NOT do**:
  - Do not modify `TraceQueueManager` internals
  - Do not change `process_trace_tasks`
  - Do not implement metric handler case logic (Task 2 stubs are sufficient)
  - Do not wire any existing producers to gateway yet (Task 4/5)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`git-master`]
    - `git-master`: atomic commit for gateway logic

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 5
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `core/telemetry/facade.py:20-37` — current `TelemetryFacade.emit()` (gateway replaces/wraps this routing logic)
  - `core/telemetry/facade.py:11-17` — `_ENTERPRISE_ONLY_TRACES` (CE eligibility source of truth; gateway absorbs this check)
  - `core/telemetry/facade.py:40-46` — `is_enterprise_telemetry_enabled()` (reuse this function for enterprise gating)
  - `core/ops/ops_trace_manager.py:1264-1288` — `TraceQueueManager.__init__` and `add_trace_task` (gateway calls this for trace-shaped events)
  - `core/ops/ops_trace_manager.py:515-634` — `TraceTask` class and `preprocess()` (gateway creates TraceTask instances for trace path)
  - `enterprise/telemetry/contracts.py` — envelope models from Task 1 (gateway creates these for metric/log path)
  - `tasks/enterprise_telemetry_task.py` — Celery task from Task 2 (gateway calls `.delay()` for metric/log events)

  **Acceptance Criteria**:
  - [ ] Gateway routes trace-shaped cases to `TraceQueueManager.add_trace_task()`
  - [ ] Gateway routes metric/log cases to enterprise telemetry Celery task
  - [ ] Enterprise-only trace case dropped when enterprise disabled
  - [ ] CE-eligible trace case enqueued regardless of enterprise state
  - [ ] Large payload stored to shared storage, `payload_ref` set in envelope
  - [ ] Small payload inlined in `core_fields`
  - [ ] Feature flag OFF → gateway bypassed (old path used)
  - [ ] `pytest tests/unit_tests/enterprise/telemetry/test_gateway.py` → PASS

  **Agent-Executed QA Scenarios**:

  ```
  Scenario: Trace-shaped case routes to TraceQueueManager
    Tool: Bash (pytest)
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_gateway.py -k "test_trace_case_routes_to_trace_queue" -v
      2. Assert: PASSED, TraceQueueManager.add_trace_task called
    Expected Result: Trace events use existing pipeline
    Evidence: pytest output

  Scenario: Metric case routes to enterprise Celery task
    Tool: Bash (pytest)
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_gateway.py -k "test_metric_case_routes_to_celery" -v
      2. Assert: PASSED, process_enterprise_telemetry.delay called with envelope
    Expected Result: Metric events use new pipeline
    Evidence: pytest output

  Scenario: Enterprise-only case dropped when EE disabled
    Tool: Bash (pytest)
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_gateway.py -k "test_enterprise_only_dropped_on_ce" -v
      2. Assert: PASSED, no enqueue call made
    Expected Result: CE deployments don't process enterprise-only traces
    Evidence: pytest output
  ```

  **Commit**: YES
  - Message: `feat(telemetry): implement gateway routing and enqueue logic`
  - Files: `enterprise/telemetry/gateway.py`, `tests/unit_tests/enterprise/telemetry/test_gateway.py`
  - Pre-commit: `make lint && make type-check`

---

- [x] 4. Migrate Event Handlers to Gateway-Only Producers

  **What to do**:
  - **Pre-validation**: Use `lsp_find_references` on all 4 blinker handler functions to confirm no caller depends on synchronous completion or return values
  - Refactor `enterprise/telemetry/event_handlers.py`:
    - `_handle_app_created`: replace direct `emit_metric_only_event()` + `exporter.increment_counter()` with `TelemetryGateway.emit(TelemetryCase.APP_CREATED, context, payload)`
    - `_handle_app_updated`: same pattern → `TelemetryCase.APP_UPDATED`
    - `_handle_app_deleted`: same pattern → `TelemetryCase.APP_DELETED`
    - `_handle_feedback_created`: same pattern → `TelemetryCase.FEEDBACK_CREATED`
  - Implement corresponding case methods in `EnterpriseMetricHandler`:
    - `_on_app_created(envelope)`: call `emit_metric_only_event()` + `exporter.increment_counter()` (move existing logic from handler)
    - `_on_app_updated(envelope)`: same
    - `_on_app_deleted(envelope)`: same
    - `_on_feedback_created(envelope)`: same
  - Handlers should build minimal context dict from sender/kwargs, nothing more
  - Write unit tests verifying handlers call gateway only, and metric handler emits correct signals

  **Must NOT do**:
  - Do not change blinker signal contracts or registration
  - Do not change what signals are emitted (same event names, same counter labels)
  - Do not add new event types

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: [`git-master`]
    - `git-master`: atomic commit for handler migration

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Task 6
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `enterprise/telemetry/event_handlers.py:26-146` — current 4 handlers with direct emit/counter calls (source of migration)
  - `enterprise/telemetry/telemetry_log.py:102` — `emit_metric_only_event()` signature (handler logic moves to metric_handler, calling this)
  - `enterprise/telemetry/exporter.py:236` — `increment_counter()` signature (same — logic moves to metric_handler)
  - `enterprise/telemetry/entities.py` — `EnterpriseTelemetryCounter` enum values used in handlers (REQUESTS, FEEDBACK)
  - `events/app_event.py` — blinker signals (`app_was_created`, `app_was_deleted`, `app_was_updated`)
  - `events/feedback_event.py` — blinker signal (`feedback_was_created`)

  **Acceptance Criteria**:
  - [ ] `event_handlers.py` has zero direct `emit_metric_only_event` calls
  - [ ] `event_handlers.py` has zero direct `exporter.increment_counter` calls
  - [ ] `event_handlers.py` has zero direct `get_enterprise_exporter` calls
  - [ ] Each handler calls `TelemetryGateway.emit()` with correct case + context
  - [ ] `EnterpriseMetricHandler._on_app_created` emits same event_name and counter labels as old handler
  - [ ] `EnterpriseMetricHandler._on_feedback_created` emits same event_name and counter labels as old handler
  - [ ] `pytest tests/unit_tests/enterprise/telemetry/test_event_handlers.py` → PASS
  - [ ] `pytest tests/unit_tests/enterprise/telemetry/test_metric_handler.py` → PASS

  **Agent-Executed QA Scenarios**:

  ```
  Scenario: App created handler calls gateway only
    Tool: Bash (pytest)
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_event_handlers.py -k "test_app_created_calls_gateway" -v
      2. Assert: PASSED, gateway.emit called with APP_CREATED case
      3. Assert: emit_metric_only_event NOT called directly
    Expected Result: Handler is enqueue-only
    Evidence: pytest output

  Scenario: Metric handler emits same signals as old handler
    Tool: Bash (pytest)
    Steps:
      1. Run: pytest tests/unit_tests/enterprise/telemetry/test_metric_handler.py -k "test_on_app_created_emits_correct_signals" -v
      2. Assert: PASSED, emit_metric_only_event called with event_name="dify.app.created"
      3. Assert: increment_counter called with type="app.created"
    Expected Result: Identical telemetry output
    Evidence: pytest output
  ```

  **Commit**: YES
  - Message: `refactor(telemetry): migrate event handlers to gateway-only producers`
  - Files: `enterprise/telemetry/event_handlers.py`, `enterprise/telemetry/metric_handler.py`, `tests/unit_tests/enterprise/telemetry/test_event_handlers.py`
  - Pre-commit: `make lint && make type-check`

---

- [x] 5. Replace TelemetryFacade with TelemetryGateway at All Call Sites

  **What to do**:
  - Delete `core/telemetry/facade.py` (gateway fully replaces it)
  - Delete `core/telemetry/events.py` (TelemetryEvent/TelemetryContext replaced by gateway's contracts)
  - Update `core/telemetry/__init__.py`:
    - Export `TelemetryGateway` (from `enterprise/telemetry/gateway.py`) and `is_enterprise_telemetry_enabled`
    - Remove all facade exports
  - Migrate all 10+ business call sites from `TelemetryFacade.emit(TelemetryEvent(...))` to `TelemetryGateway.emit(case, context, payload)`:
    - `services/message_service.py:301` — MESSAGE_TRACE → `TelemetryGateway.emit(TelemetryCase.MESSAGE_RUN, ...)`
    - `enterprise/telemetry/draft_trace.py:23` — DRAFT_NODE_EXECUTION_TRACE → `TelemetryGateway.emit(TelemetryCase.DRAFT_NODE_EXECUTION, ...)`
    - `core/moderation/input_moderation.py:52` — MODERATION_TRACE → `TelemetryGateway.emit(TelemetryCase.MODERATION_CHECK, ...)`
    - `core/callback_handler/agent_tool_callback_handler.py:76` — TOOL_TRACE → `TelemetryGateway.emit(TelemetryCase.TOOL_EXECUTION, ...)`
    - `core/app/apps/advanced_chat/generate_task_pipeline.py:835` — `TelemetryGateway.emit(...)`
    - `core/workflow/graph_engine/layers/persistence.py:398,502` — NODE_EXECUTION_TRACE → `TelemetryGateway.emit(TelemetryCase.NODE_EXECUTION, ...)`
    - `core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py:406` — `TelemetryGateway.emit(...)`
    - `core/llm_generator/llm_generator.py:96,791` — PROMPT_GENERATION / SUGGESTED_QUESTION → `TelemetryGateway.emit(...)`
    - `core/rag/retrieval/dataset_retrieval.py:725` — DATASET_RETRIEVAL → `TelemetryGateway.emit(TelemetryCase.DATASET_RETRIEVAL, ...)`
  - Rewrite `tests/unit_tests/core/telemetry/test_facade.py` → `tests/unit_tests/core/telemetry/test_gateway_integration.py` (test gateway routing at call site level)
  - Keep `is_enterprise_telemetry_enabled()` helper function (move to `core/telemetry/__init__.py` or gateway module)

  **Must NOT do**:
  - Do not change `TraceQueueManager`
  - Do not change `process_trace_tasks`
  - Do not change business logic at call sites (only change the telemetry emit call)
  - Do not change what data is sent (same payload fields, just different API shape)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`git-master`]
    - `git-master`: atomic commit for call site migration

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential)
  - **Blocks**: Task 6
  - **Blocked By**: Task 3

  **References**:
  - `core/telemetry/facade.py` — file to DELETE (gateway replaces all its logic)
  - `core/telemetry/events.py` — file to DELETE (contracts.py replaces TelemetryEvent/TelemetryContext)
  - `core/telemetry/__init__.py:3` — current exports to update (`TelemetryFacade, emit, is_enterprise_telemetry_enabled`)
  - `enterprise/telemetry/gateway.py` — gateway from Task 3 (new import target for all call sites)
  - `enterprise/telemetry/contracts.py` — `TelemetryCase` enum (replaces `TraceTaskName` at call sites)
  - All 10+ call sites listed above (grep for `TelemetryFacade.emit` to find complete list)
  - `tests/unit_tests/core/telemetry/test_facade.py:1-243` — existing tests to rewrite for gateway

  **Acceptance Criteria**:
  - [ ] `core/telemetry/facade.py` deleted
  - [ ] `core/telemetry/events.py` deleted
  - [ ] Zero imports of `TelemetryFacade` anywhere in codebase
  - [ ] Zero imports of `TelemetryEvent` anywhere in codebase (except test helpers if needed)
  - [ ] All business call sites use `TelemetryGateway.emit()`
  - [ ] `core/telemetry/__init__.py` exports `TelemetryGateway` and `is_enterprise_telemetry_enabled`
  - [ ] New gateway integration tests cover trace routing, metric routing, and CE eligibility
  - [ ] `pytest tests/unit_tests/core/telemetry/ -v` → PASS
  - [ ] `pytest tests/unit_tests/enterprise/telemetry/test_gateway.py` → PASS
  - [ ] `make lint` → clean
  - [ ] `make type-check` → clean

  **Agent-Executed QA Scenarios**:

  ```
  Scenario: No TelemetryFacade imports remain
    Tool: Bash (grep)
    Steps:
      1. Run: grep -r "TelemetryFacade" --include="*.py" . | grep -v __pycache__ | grep -v .pyc
      2. Assert: zero results
    Expected Result: Complete removal
    Evidence: grep output

  Scenario: Gateway integration tests pass
    Tool: Bash (pytest)
    Steps:
      1. Run: pytest tests/unit_tests/core/telemetry/test_gateway_integration.py -v
      2. Assert: ALL PASSED
    Expected Result: Gateway correctly replaces facade at all call sites
    Evidence: pytest output

  Scenario: Trace-shaped call site routes correctly
    Tool: Bash (pytest)
    Steps:
      1. Run: pytest tests/unit_tests/core/telemetry/test_gateway_integration.py -k "test_workflow_trace_routes_to_queue" -v
      2. Assert: PASSED, TraceQueueManager.add_trace_task called
    Expected Result: Trace events still reach existing pipeline
    Evidence: pytest output
  ```

  **Commit**: YES
  - Message: `refactor(telemetry): replace TelemetryFacade with TelemetryGateway at all call sites`
  - Files: `core/telemetry/facade.py` (deleted), `core/telemetry/events.py` (deleted), `core/telemetry/__init__.py`, all 10+ call site files, `tests/unit_tests/core/telemetry/test_gateway_integration.py`
  - Pre-commit: `make lint && make type-check`

---

- [x] 6. Integration Verification + Cleanup

  **What to do**:
  - Run full unit test suite: `uv run --project api --dev dev/pytest/pytest_unit_tests.sh`
  - Run `make lint` and `make type-check`
  - Verify no regressions across all telemetry-related tests
  - Verify feature flag toggle:
    - OFF: all existing behavior preserved
    - ON: gateway routes correctly, metric handler processes envelopes
  - Add operational diagnostics to `EnterpriseMetricHandler`:
    - Log: gateway routing decisions (DEBUG level)
    - Counter: `enterprise_telemetry.gateway.routed_total` (by signal_type)
    - Counter: `enterprise_telemetry.handler.processed_total` (by case)
    - Counter: `enterprise_telemetry.handler.deduped_total`
    - Counter: `enterprise_telemetry.handler.rehydration_failed_total`
  - Document feature flag in relevant config/env docs if they exist

  **Must NOT do**:
  - Do not remove the old direct path yet (keep behind feature flag for rollback)
  - Do not force-enable the feature flag in production config
  - Do not add complex DLQ/retry logic

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: [`git-master`]
    - `git-master`: final atomic commit

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (final, sequential)
  - **Blocks**: None (final task)
  - **Blocked By**: Tasks 4, 5

  **References**:
  - `tests/unit_tests/core/telemetry/test_gateway_integration.py` — gateway integration tests (must pass)
  - `tests/unit_tests/core/ops/test_trace_queue_manager.py` — TraceQueueManager tests (must pass unchanged)
  - `enterprise/telemetry/metric_handler.py` — add diagnostics counters here
  - `enterprise/telemetry/gateway.py` — add DEBUG logging here
  - `enterprise/telemetry/exporter.py` — `EnterpriseExporter.increment_counter()` pattern for adding diagnostic counters

  **Acceptance Criteria**:
  - [ ] `uv run --project api --dev dev/pytest/pytest_unit_tests.sh` → ALL PASS
  - [ ] `make lint` → clean
  - [ ] `make type-check` → clean
  - [ ] Feature flag OFF: all existing tests pass, no behavioral change
  - [ ] Feature flag ON: gateway routing + metric handler processing verified
  - [ ] Diagnostic counters present in metric handler
  - [ ] No direct `emit_metric_only_event` calls remain in `event_handlers.py`

  **Agent-Executed QA Scenarios**:

  ```
  Scenario: Full test suite passes
    Tool: Bash
    Steps:
      1. Run: uv run --project api --dev dev/pytest/pytest_unit_tests.sh
      2. Assert: exit code 0, all tests pass
    Expected Result: Zero regressions
    Evidence: pytest output captured

  Scenario: Lint and type-check clean
    Tool: Bash
    Steps:
      1. Run: make lint
      2. Assert: exit code 0
      3. Run: make type-check
      4. Assert: exit code 0
    Expected Result: No lint or type errors
    Evidence: command output captured
  ```

  **Commit**: YES
  - Message: `feat(telemetry): add gateway diagnostics and verify integration`
  - Files: `enterprise/telemetry/metric_handler.py`, `enterprise/telemetry/gateway.py`
  - Pre-commit: `make lint && make type-check && uv run --project api --dev dev/pytest/pytest_unit_tests.sh`

---

## Commit Strategy

| After Task | Message | Key Files | Verification |
|------------|---------|-----------|--------------|
| 1 | `feat(telemetry): add gateway envelope contracts and routing table` | contracts.py, gateway.py (data only) | pytest + lint + type-check |
| 2 | `feat(telemetry): add enterprise metric handler skeleton and Celery worker` | metric_handler.py, enterprise_telemetry_task.py | pytest + lint + type-check |
| 3 | `feat(telemetry): implement gateway routing and enqueue logic` | gateway.py (full impl) | pytest + lint + type-check |
| 4 | `refactor(telemetry): migrate event handlers to gateway-only producers` | event_handlers.py, metric_handler.py | pytest + lint + type-check |
| 5 | `refactor(telemetry): replace TelemetryFacade with TelemetryGateway at all call sites` | facade.py (deleted), events.py (deleted), __init__.py, 10+ call sites | pytest + lint + type-check |
| 6 | `feat(telemetry): add gateway diagnostics and verify integration` | metric_handler.py, gateway.py | full test suite + lint + type-check |

---

## Failure Handling Decisions

| Scenario | Decision |
|----------|----------|
| Redis unavailable during idempotency check | Fail open: skip dedup, process event (prefer occasional duplicate over lost data) |
| Payload rehydration fails (ref expired) | Use `payload_fallback` if present; otherwise emit degraded event with `rehydration_failed=true` flag |
| Queue worker crashes mid-processing | At-least-once with idempotency: Celery retries, dedup prevents double-count |
| Queue backpressure / full | Celery handles backpressure natively; add monitoring counter for queue depth |
| Feature flag flips while events in-flight | Events already enqueued process with handler logic; new events route per new flag state |
| Unknown event type reaches handler | Log warning, do not raise, skip processing |

---

## Success Criteria

### Verification Commands
```bash
make lint                                                    # Expected: clean
make type-check                                             # Expected: clean
uv run --project api --dev dev/pytest/pytest_unit_tests.sh  # Expected: all pass
pytest tests/unit_tests/core/telemetry/ -v                  # Expected: all pass
pytest tests/unit_tests/enterprise/telemetry/ -v            # Expected: all pass
pytest tests/unit_tests/tasks/ -v                           # Expected: all pass
```

### Final Checklist
- [x] Single gateway entrance for all enterprise telemetry
- [x] Two routing decisions consolidated in one place
- [x] Metric/log events processed async (not in request path)
- [x] CE trace pipeline completely unchanged
- [x] Enterprise trace span pipeline unchanged
- [x] Idempotency prevents duplicate counters
- [x] Feature flag enables safe rollout/rollback
- [x] All existing tests pass
- [x] No direct emit/counter calls in event_handlers.py
