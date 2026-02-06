# Learnings

## [2026-02-06T02:58:22Z] Session Start: ses_3cfc17c5fffeBUMFsRxeFEXuNw

Starting execution of enterprise-telemetry-gateway-refactor plan.


## [2026-02-06] Task 2: EnterpriseMetricHandler + Celery Worker

### Implementation Decisions

**Handler Architecture:**
- Case dispatch via if/elif chain (not match/case) for Python 3.11 compatibility
- Stub methods return None, log at DEBUG level for observability
- Unknown cases log warning but don't raise (fail gracefully)

**Idempotency:**
- Redis key pattern: `telemetry:dedup:{tenant_id}:{event_id}`
- TTL: 3600 seconds (1 hour)
- Fail-open strategy: if Redis unavailable, process event (prefer duplicate over data loss)

**Rehydration:**
- Primary: `envelope.payload` (direct dict)
- Fallback: `envelope.payload_fallback` (pickled bytes)
- Degraded: emit `dify.telemetry.rehydration_failed` event if both fail
- Pickle security: noqa S301/S403 (controlled internal use only)

**Celery Task:**
- Queue: `enterprise_telemetry`
- Best-effort processing: log + drop on error, never raise
- JSON serialization for envelope transport

### Testing Patterns

**Fixtures:**
- `mock_redis`: patch `redis_client` at module level
- `sample_envelope`: reusable TelemetryEnvelope with APP_CREATED case

**Coverage:**
- All 11 case handlers verified via dispatch tests
- Idempotency: first-seen, duplicate, Redis failure scenarios
- Rehydration: direct payload, fallback, degraded event emission
- Celery task: success, invalid JSON, handler exception, validation error

**Pydantic Validation:**
- Cannot test "unknown case" with enum validation (Pydantic rejects at parse time)
- Instead: test all known cases have handlers (exhaustive enum coverage)

### Files Created

- `enterprise/telemetry/metric_handler.py` (211 lines)
- `tasks/enterprise_telemetry_task.py` (52 lines)
- `tests/unit_tests/enterprise/telemetry/test_metric_handler.py` (22 tests)
- `tests/unit_tests/tasks/test_enterprise_telemetry_task.py` (4 tests)

### Verification

```bash
pytest tests/unit_tests/enterprise/telemetry/test_metric_handler.py -v  # 22 passed
pytest tests/unit_tests/tasks/test_enterprise_telemetry_task.py -v      # 4 passed
ruff check --fix <files>                                                # clean
basedpyright <files>                                                    # 0 errors
```

### Next Steps

Task 3 will wire the gateway to call `process_enterprise_telemetry.delay()` for metric/log cases.

## [2026-02-06T03:10] Wave 1 Complete (Tasks 1 & 2)

### Orchestrator Verification

**Task 1: Gateway Contracts + Routing Table**
- ✅ 19 tests pass
- ✅ Lint clean
- ✅ Type-check clean (0 errors, 0 warnings)
- ✅ LSP diagnostics clean
- Files: contracts.py (77 lines), gateway.py (27 lines), test_contracts.py (264 lines)

**Task 2: EnterpriseMetricHandler Skeleton + Celery Worker**
- ✅ 22 tests pass (handler) + 4 tests pass (task)
- ✅ Lint clean
- ✅ Type-check clean (0 errors, 0 warnings)
- ✅ LSP diagnostics clean
- Files: metric_handler.py (211 lines), enterprise_telemetry_task.py (52 lines), tests (2 files)

**Total Wave 1 Output:**
- 4 new production files (367 lines)
- 3 new test files (26 tests, 100% pass rate)
- 0 lint/type/LSP errors

**Ready for Wave 2:** Tasks 3 & 4 can now proceed in parallel.


## [2026-02-06] Task 4: Event Handlers → Gateway-Only Producers

### Implementation Decisions

**Handler Refactoring:**
- Removed direct `emit_metric_only_event()` and `exporter.increment_counter()` calls
- Handlers now build minimal context dicts from sender/kwargs
- Each handler calls `process_enterprise_telemetry.delay()` with serialized envelope
- Event IDs generated via `uuid.uuid4()` (no custom generator needed)

**Metric Handler Case Methods:**
- `_on_app_created`: emits `dify.app.created` + `REQUESTS` counter with `type=app.created`
- `_on_app_updated`: emits `dify.app.updated` + `REQUESTS` counter with `type=app.updated`
- `_on_app_deleted`: emits `dify.app.deleted` + `REQUESTS` counter with `type=app.deleted`
- `_on_feedback_created`: emits `dify.feedback.created` + `FEEDBACK` counter, respects `include_content` flag

**Payload Structure:**
- App events: `{app_id, mode}` (created), `{app_id}` (updated/deleted)
- Feedback events: `{message_id, app_id, conversation_id, from_end_user_id, from_account_id, rating, from_source, content}`
- All fields extracted from sender/kwargs, no transformation

### Testing Patterns

**Event Handler Tests:**
- Mock `get_enterprise_exporter` at `extensions.ext_enterprise_telemetry` (not handler module)
- Mock `process_enterprise_telemetry` at `tasks.enterprise_telemetry_task` (not handler module)
- Verify task.delay() called with JSON envelope containing correct case/tenant_id/payload
- Verify no task call when exporter unavailable

**Metric Handler Tests:**
- Mock `get_enterprise_exporter` at `extensions.ext_enterprise_telemetry`
- Mock `emit_metric_only_event` at `enterprise.telemetry.telemetry_log`
- Verify correct event_name, attributes, tenant_id, user_id (for feedback)
- Verify counter increments with correct labels
- Verify `include_content` flag respected for feedback

### Files Modified

- `enterprise/telemetry/event_handlers.py` (131 lines, -16 lines)
  - Removed direct telemetry calls
  - Added envelope construction + task dispatch
- `enterprise/telemetry/metric_handler.py` (+96 lines)
  - Implemented 4 case methods with full emission logic
- `tests/unit_tests/enterprise/telemetry/test_event_handlers.py` (NEW, 131 lines, 7 tests)
- `tests/unit_tests/enterprise/telemetry/test_metric_handler.py` (+173 lines, 5 new tests)

### Verification

```bash
pytest tests/unit_tests/enterprise/telemetry/test_event_handlers.py -v  # 7 passed
pytest tests/unit_tests/enterprise/telemetry/test_metric_handler.py -v  # 30 passed (25 existing + 5 new)
ruff check --fix <files>                                                # clean
basedpyright <files>                                                    # 0 errors
```

### Key Insights

**Patch Locations Matter:**
- Must patch at import source, not usage location
- `get_enterprise_exporter` → patch at `extensions.ext_enterprise_telemetry`
- `process_enterprise_telemetry` → patch at `tasks.enterprise_telemetry_task`
- `emit_metric_only_event` → patch at `enterprise.telemetry.telemetry_log`

**Enum Serialization:**
- `TelemetryCase.APP_CREATED` serializes as `"app_created"` (lowercase with underscores)
- Tests must check for lowercase enum values in JSON

**Feedback Content Flag:**
- `exporter.include_content` controls whether `dify.feedback.content` is included
- Must check flag in metric handler, not event handler (handler doesn't have exporter context)

### Next Steps

Task 3 (gateway implementation) will wire `TelemetryGateway.emit()` to call `process_enterprise_telemetry.delay()`.
Once Task 3 completes, handlers can optionally be updated to call gateway directly instead of task.

## [2026-02-06] Task 3: TelemetryGateway Implementation

### Implementation Decisions

**Gateway Architecture:**
- `TelemetryGateway.emit(case, context, payload, trace_manager)` as main entry point
- Routes based on `CASE_ROUTING[case].signal_type`:
  - `trace` → TraceQueueManager.add_trace_task()
  - `metric_log` → process_enterprise_telemetry.delay()
- Feature flag `ENTERPRISE_TELEMETRY_GATEWAY_ENABLED` gates new vs legacy behavior

**CE Eligibility:**
- Trace cases with `ce_eligible=False` dropped when enterprise disabled
- CE-eligible traces (WORKFLOW_RUN, MESSAGE_RUN) always processed
- Enterprise-only traces (NODE_EXECUTION, DRAFT_NODE_EXECUTION, PROMPT_GENERATION) require EE

**Payload Sizing:**
- Threshold: 1MB (PAYLOAD_SIZE_THRESHOLD_BYTES)
- Large payloads stored to `telemetry/{tenant_id}/{event_id}.json`
- Storage failures fall back to inline payload (best-effort)

**Legacy Path:**
- When gateway disabled, mimics original TelemetryFacade behavior
- Only processes trace cases, metric/log cases dropped
- Imports deferred until after route check to avoid circular imports

### Testing Patterns

**Circular Import Workaround:**
- `ops_trace_manager` has deep import chain causing circular imports in tests
- Solution: `mock_ops_trace_manager` fixture patches `sys.modules` before import
- Trace routing tests require fixture; metric/log tests don't

**Mock Parameter Naming:**
- Prefixed unused mock params with `_` (e.g., `_mock_ee_enabled`)
- Ruff PT019 warnings are style hints, not errors

**Coverage:**
- 38 tests total
- Feature flag on/off paths
- Trace routing (CE-eligible and enterprise-only)
- Metric/log routing
- Large payload storage and fallback
- Legacy path behavior

### Files Modified/Created

- `enterprise/telemetry/gateway.py` (350 lines, expanded from 27)
  - Added TelemetryGateway class
  - Added CASE_TO_TRACE_TASK_NAME mapping
  - Added is_gateway_enabled() and _is_enterprise_telemetry_enabled()
  - Added module-level emit() convenience function
- `tests/unit_tests/enterprise/telemetry/test_gateway.py` (NEW, 422 lines, 38 tests)

### Verification

```bash
pytest tests/unit_tests/enterprise/telemetry/test_gateway.py -v  # 38 passed
ruff check --fix <files>                                         # 22 PT019 warnings (style)
basedpyright <files>                                             # 0 errors, 0 warnings
```

### Key Insights

**Import Deferral:**
- Legacy path must defer `ops_trace_manager` import until after route check
- Otherwise metric/log cases trigger circular import chain
- Pattern: check signal_type first, then import if needed

**TelemetryCase to TraceTaskName Mapping:**
- WORKFLOW_RUN → "workflow"
- MESSAGE_RUN → "message"
- NODE_EXECUTION → "node_execution"
- DRAFT_NODE_EXECUTION → "draft_node_execution"
- PROMPT_GENERATION → "prompt_generation"

**Feature Flag Design:**
- Default OFF for safe rollout
- Env var: ENTERPRISE_TELEMETRY_GATEWAY_ENABLED
- Truthy values: "true", "1", "yes" (case-insensitive)

