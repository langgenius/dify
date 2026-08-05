# Reliable Final Trace Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide bounded at-least-once delivery for global-timeout final workflow traces and retry recoverable unified-provider transport failures without deleting their recovery payloads early.

**Architecture:** Persist an explicit pending/failed handoff state on `WorkflowPause`, synchronously write the final `TaskData` to a deterministic `ops_trace` object before Celery handoff, and let the existing Human Input timeout beat task recover pending handoffs. Keep provider delivery separate: adapters classify recoverable transport failures as `RetryableTraceDispatchError`, while the existing trace task owns bounded whole-fragment replay and payload cleanup.

**Tech Stack:** Python 3.12, SQLAlchemy 2, Alembic, Pydantic settings, Celery, Dify storage abstraction, pytest.

---

### Task 1: Persist final-trace handoff state and configuration

**Files:**
- Modify: `api/models/workflow.py`
- Modify: `api/configs/feature/__init__.py`
- Modify: `docker/envs/core-services/shared.env.example`
- Create: `api/migrations/versions/2026_08_05_1200-4b7c2f19a6d8_add_final_trace_handoff_state.py`
- Modify: `api/tests/unit_tests/configs/test_dify_config.py`

- [ ] **Step 1: Write the failing configuration and model tests**

Add assertions that the independent budget defaults to 60 and that a new `WorkflowPause` defaults to no outstanding handoff:

```python
def test_ops_trace_final_handoff_retry_default() -> None:
    config = OpsTraceConfig()
    assert config.OPS_TRACE_FINAL_TRACE_HANDOFF_MAX_RETRIES == 60


def test_workflow_pause_final_trace_defaults() -> None:
    pause = WorkflowPause(
        workflow_id=str(uuid4()),
        workflow_run_id=str(uuid4()),
        state_object_key="workflow-state.json",
    )
    assert pause.final_trace_status is None
    assert pause.final_trace_attempts == 0
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/configs/test_dify_config.py api/tests/unit_tests/models/test_workflow.py -q
```

Expected: failures for the missing config and model fields. If the model test file does not yet exist, create `api/tests/unit_tests/models/test_workflow.py` with the test above.

- [ ] **Step 3: Add the model state and retry configuration**

Define the model-local enum and columns:

```python
class FinalTraceHandoffStatus(StrEnum):
    PENDING = "pending"
    FAILED = "failed"


class WorkflowPause(DefaultFieldsDCMixin, TypeBase):
    # existing fields...
    final_trace_status: Mapped[FinalTraceHandoffStatus | None] = mapped_column(
        EnumText(FinalTraceHandoffStatus, length=16),
        nullable=True,
        default=None,
    )
    final_trace_attempts: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )
```

Add to `OpsTraceConfig`:

```python
OPS_TRACE_FINAL_TRACE_HANDOFF_MAX_RETRIES: PositiveInt = Field(
    description="Maximum recovery attempts before a final workflow trace handoff is marked failed.",
    default=60,
)
```

Add to the shared Docker environment example:

```dotenv
OPS_TRACE_FINAL_TRACE_HANDOFF_MAX_RETRIES=60
```

- [ ] **Step 4: Add the backward-compatible migration**

Use revision `4b7c2f19a6d8` with `down_revision = "e4708db55c1d"`:

```python
def upgrade() -> None:
    with op.batch_alter_table("workflow_pauses") as batch_op:
        batch_op.add_column(sa.Column("final_trace_status", sa.String(length=16), nullable=True))
        batch_op.add_column(
            sa.Column("final_trace_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("workflow_pauses") as batch_op:
        batch_op.drop_column("final_trace_attempts")
        batch_op.drop_column("final_trace_status")
```

- [ ] **Step 5: Run tests and migration graph validation**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/configs/test_dify_config.py api/tests/unit_tests/models/test_workflow.py -q
```

Run from `api/`:

```bash
uv run python -c 'from alembic.config import Config; from alembic.script import ScriptDirectory; c=Config("migrations/alembic.ini"); c.set_main_option("script_location", "migrations"); print(ScriptDirectory.from_config(c).get_heads())'
```

Expected head: `4b7c2f19a6d8`.

- [ ] **Step 6: Commit the state/configuration change**

```bash
git add api/models/workflow.py api/configs/feature/__init__.py docker/envs/core-services/shared.env.example api/migrations/versions/2026_08_05_1200-4b7c2f19a6d8_add_final_trace_handoff_state.py api/tests/unit_tests/configs/test_dify_config.py api/tests/unit_tests/models/test_workflow.py
git commit -m "feat(trace): persist final handoff state"
```

### Task 2: Make trace payload persistence an acknowledged operation

**Files:**
- Modify: `api/core/ops/entities/config_entity.py`
- Modify: `api/core/ops/ops_trace_manager.py`
- Modify: `api/tests/unit_tests/core/ops/test_trace_queue_manager.py`

- [ ] **Step 1: Write failing tests for deterministic persistence and broker acknowledgement**

Add tests that call the new reliable methods directly:

```python
def test_persist_trace_task_uses_requested_file_id(manager, trace_task):
    with patch("core.ops.ops_trace_manager.storage.save") as save:
        file_info = manager.persist_trace_task(trace_task, file_id="workflow-final-run-1")
    assert file_info == {"app_id": "app-1", "file_id": "workflow-final-run-1"}
    assert save.call_args.args[0] == "ops_trace/app-1/workflow-final-run-1.json"


def test_persist_trace_task_propagates_storage_failure(manager, trace_task):
    with (
        patch("core.ops.ops_trace_manager.storage.save", side_effect=RuntimeError("storage down")),
        pytest.raises(RuntimeError, match="storage down"),
    ):
        manager.persist_trace_task(trace_task, file_id="workflow-final-run-1")


def test_enqueue_persisted_trace_propagates_broker_failure(manager):
    file_info = {"app_id": "app-1", "file_id": "workflow-final-run-1"}
    with (
        patch("core.ops.ops_trace_manager.process_trace_tasks.apply_async", side_effect=RuntimeError("broker down")),
        pytest.raises(RuntimeError, match="broker down"),
    ):
        manager.enqueue_persisted_trace(file_info)
```

- [ ] **Step 2: Run the queue-manager tests and verify they fail**

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/test_trace_queue_manager.py -q
```

Expected: the reliable persistence and enqueue methods do not exist.

- [ ] **Step 3: Centralize deterministic paths and synchronous persistence**

Add helpers beside `OPS_FILE_PATH`:

```python
def ops_trace_payload_path(app_id: str, file_id: str) -> str:
    return f"{OPS_FILE_PATH}{app_id}/{file_id}.json"


def workflow_final_trace_file_id(workflow_run_id: str) -> str:
    return f"workflow-final-{workflow_run_id}"
```

Extract the current `send_to_celery` body into explicit operations:

```python
def persist_trace_task(self, task: TraceTask, *, file_id: str | None = None) -> dict[str, str] | None:
    if not (self._enterprise_telemetry_enabled or self.trace_instance):
        return None
    task.app_id = self.app_id
    storage_id = self._resolve_storage_id(task)
    resolved_file_id = file_id or uuid4().hex
    trace_info = task.execute()
    task_data = TaskData(
        app_id=storage_id,
        trace_info_type=type(trace_info).__name__,
        trace_info=trace_info.model_dump() if trace_info else None,
    )
    storage.save(ops_trace_payload_path(storage_id, resolved_file_id), task_data.model_dump_json().encode())
    return {"app_id": storage_id, "file_id": resolved_file_id}


def enqueue_persisted_trace(self, file_info: dict[str, str]) -> None:
    process_trace_tasks.apply_async(
        args=[file_info],
        retry=True,
        retry_policy={"max_retries": 3, "interval_start": 0, "interval_step": 1, "interval_max": 2},
    )
```

Make `send_to_celery` reuse these methods. Keep ordinary `add_trace_task` fire-and-forget behavior backward-compatible; reliable callers use the acknowledged methods explicitly.

- [ ] **Step 4: Run the queue-manager tests**

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/test_trace_queue_manager.py api/tests/unit_tests/core/ops/test_ops_trace_manager.py -q
```

Expected: all tests pass, including existing telemetry guard behavior.

- [ ] **Step 5: Commit the persistence boundary**

```bash
git add api/core/ops/entities/config_entity.py api/core/ops/ops_trace_manager.py api/tests/unit_tests/core/ops/test_trace_queue_manager.py
git commit -m "refactor(trace): expose durable task handoff"
```

### Task 3: Recover global-timeout final trace handoff

**Files:**
- Modify: `api/tasks/human_input_timeout_tasks.py`
- Modify: `api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py`

- [ ] **Step 1: Replace the existing cleanup test with failing state-machine tests**

Cover the terminal transition, retry, success, exhaustion, and reconstruction of the expired wait from pause reasons:

```python
def test_global_timeout_marks_final_trace_pending_without_deleting_snapshot(...):
    _handle_global_timeout(...)
    assert workflow_run.status == WorkflowExecutionStatus.STOPPED
    assert pause.final_trace_status is FinalTraceHandoffStatus.PENDING
    assert pause.final_trace_attempts == 0
    storage.delete.assert_not_called()


def test_pending_handoff_storage_failure_retains_snapshot(...):
    manager.persist_trace_task.side_effect = RuntimeError("storage down")
    _attempt_pending_final_trace_handoff(pause.id, session_factory)
    assert refreshed_pause.final_trace_status is FinalTraceHandoffStatus.PENDING
    storage.delete.assert_not_called()


def test_pending_handoff_success_clears_state_and_deletes_snapshot(...):
    _attempt_pending_final_trace_handoff(pause.id, session_factory)
    manager.persist_trace_task.assert_called_once()
    manager.enqueue_persisted_trace.assert_called_once()
    assert refreshed_pause.final_trace_status is None
    storage.delete.assert_called_once_with(pause.state_object_key)


def test_pending_handoff_exhaustion_marks_failed_and_logs(...):
    pause.final_trace_attempts = 59
    manager.persist_trace_task.side_effect = RuntimeError("storage down")
    _attempt_pending_final_trace_handoff(pause.id, session_factory)
    assert refreshed_pause.final_trace_status is FinalTraceHandoffStatus.FAILED
    logger.error.assert_called_once()
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py -q
```

Expected: current code deletes the snapshot immediately and has no pending recovery state.

- [ ] **Step 3: Make global timeout create pending state only**

Inside the existing database transaction:

```python
workflow_run.status = WorkflowExecutionStatus.STOPPED
workflow_run.error = f"Human input global timeout at node {node_id}"
workflow_run.finished_at = now
pause_model.resumed_at = now
pause_model.final_trace_status = FinalTraceHandoffStatus.PENDING
pause_model.final_trace_attempts = 0
```

Do not load/delete storage or enqueue a trace inside that transaction. After commit, call the same attempt helper used by periodic recovery so the first handoff does not wait one minute.

- [ ] **Step 4: Implement one idempotent handoff attempt**

The helper must:

```python
def _attempt_pending_final_trace_handoff(pause_id: str, session_factory: sessionmaker) -> None:
    # Atomically increment attempts only while status is pending.
    # Load the pause snapshot and committed workflow run outside a write transaction.
    # Rebuild terminal HumanWaitRecord values from EXPIRED forms referenced by WorkflowPauseReason.
    # Append them by stable wait_id to the restored WorkflowTraceState.
    # Persist to workflow_final_trace_file_id(workflow_run.id).
    # Enqueue the persisted file_info.
    # On acknowledgement, conditionally clear pending before best-effort snapshot deletion.
    # On failure, leave pending or conditionally mark failed at the configured limit.
```

Use conditional updates so a late failed attempt cannot change a row whose successful concurrent attempt already cleared the status. Log only identifiers, attempt, stage, and exception type.

If no enterprise or configured trace consumer exists, treat the handoff as a successful no-op and clean the obsolete snapshot; there is no trace payload to retain.

- [ ] **Step 5: Add periodic recovery to the existing timeout task**

Add a bounded query for pending pauses and call the same attempt helper:

```python
pending_pause_ids = session.scalars(
    select(WorkflowPause.id)
    .where(WorkflowPause.final_trace_status == FinalTraceHandoffStatus.PENDING)
    .order_by(WorkflowPause.updated_at.asc(), WorkflowPause.id.asc())
    .limit(limit)
).all()
for pause_id in pending_pause_ids:
    _attempt_pending_final_trace_handoff(pause_id, session_factory)
```

Run this recovery pass even when no new `WAITING` forms expire.

- [ ] **Step 6: Run timeout and workflow-resume tests**

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py api/tests/unit_tests/tasks/test_workflow_execute_task.py api/tests/unit_tests/services/test_human_input_service.py -q
```

Expected: all tests pass; ordinary node timeout and Agent App resume behavior remain unchanged.

- [ ] **Step 7: Commit global-timeout recovery**

```bash
git add api/tasks/human_input_timeout_tasks.py api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py
git commit -m "fix(trace): recover final timeout handoff"
```

### Task 4: Protect pending snapshots during pause pruning

**Files:**
- Modify: `api/repositories/sqlalchemy_api_workflow_run_repository.py`
- Modify: `api/tests/test_containers_integration_tests/test_workflow_pause_integration.py`

- [ ] **Step 1: Add failing prune cases**

Extend the existing parameterized pause-pruning coverage:

```python
def test_prune_pauses_keeps_pending_final_trace(self):
    pause = create_old_resumed_pause()
    pause.final_trace_status = FinalTraceHandoffStatus.PENDING
    assert repository.prune_pauses(expiration, resumption_expiration) == []


def test_prune_pauses_cleans_failed_final_trace_payload(self, monkeypatch):
    pause, workflow_run = create_old_resumed_pause_with_run()
    pause.final_trace_status = FinalTraceHandoffStatus.FAILED
    repository.prune_pauses(expiration, resumption_expiration)
    storage.delete.assert_any_call(
        ops_trace_payload_path(workflow_run.app_id, workflow_final_trace_file_id(workflow_run.id))
    )
```

- [ ] **Step 2: Implement the pruning rules**

Exclude pending rows from both expiration branches:

```python
cond = and_(
    WorkflowPause.final_trace_status.is_distinct_from(FinalTraceHandoffStatus.PENDING),
    or_(existing_expired_condition, existing_resumed_condition),
)
```

When pruning `FAILED`, load the run's `app_id` and best-effort delete the deterministic final-trace payload in addition to the pause snapshot. A missing payload is harmless; a storage deletion error follows the existing behavior and leaves the database row for a later prune attempt.

- [ ] **Step 3: Run locally supported checks**

Backend integration tests are CI-owned, so run import and unit checks locally:

```bash
uv run --project api python -m compileall -q api/repositories/sqlalchemy_api_workflow_run_repository.py
uv run --project api pytest api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py -q
```

Document the container-backed prune scenarios as CI verification.

- [ ] **Step 4: Commit pruning protection**

```bash
git add api/repositories/sqlalchemy_api_workflow_run_repository.py api/tests/test_containers_integration_tests/test_workflow_pause_integration.py
git commit -m "fix(trace): retain pending timeout snapshots"
```

### Task 5: Classify recoverable unified-provider failures

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py`
- Modify: `api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py`
- Modify: `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py`
- Modify: `api/tests/unit_tests/tasks/test_ops_trace_task.py`

- [ ] **Step 1: Change provider tests to demand retryable transport failures**

Phoenix:

```python
subject._exporter.export.return_value = SpanExportResult.FAILURE
with pytest.raises(RetryableTraceDispatchError, match="Phoenix span export failed"):
    subject.emit(trace(tool), None, publish)
publish.assert_not_called()
```

Also cover an exporter connection exception.

LangSmith:

```python
@pytest.mark.parametrize(
    "error",
    [LangSmithConnectionError("down"), LangSmithRequestTimeout("slow"),
     LangSmithRateLimitError("limited"), LangSmithAPIError("server")],
)
def test_emit_maps_recoverable_sdk_errors(error, adapter):
    subject, client = adapter
    client.create_run.side_effect = error
    with pytest.raises(RetryableTraceDispatchError):
        subject.emit(trace(), None, MagicMock())
```

Keep `LangSmithAuthError`, `LangSmithUserError`, invalid context, and validation failures terminal.

- [ ] **Step 2: Run provider tests and verify failure**

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py -q
```

- [ ] **Step 3: Map only recoverable failures**

Phoenix wraps only exporter invocation/failure:

```python
try:
    export_result = self._exporter.export((cast(trace_sdk.ReadableSpan, span),))
except Exception as error:
    raise RetryableTraceDispatchError("Phoenix span export failed") from error
if export_result is not SpanExportResult.SUCCESS:
    raise RetryableTraceDispatchError(f"Phoenix span export failed: canonical_span_id={canonical_span.id}")
```

LangSmith wraps the documented recoverable SDK exception types around `create_run`; terminal SDK and local validation errors pass through unchanged.

- [ ] **Step 4: Confirm task-level bounded replay remains intact**

Extend `test_ops_trace_task.py` to assert that retryable provider errors preserve the payload only when `self.retry` is accepted, and that retry exhaustion deletes it and increments the existing failure counter. Do not add a new metric or alert path.

- [ ] **Step 5: Run provider and dispatch tests**

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

- [ ] **Step 6: Commit provider error classification**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py api/tests/unit_tests/tasks/test_ops_trace_task.py
git commit -m "fix(trace): retry recoverable provider exports"
```

### Task 6: Update the runtime contract and verify the complete change

**Files:**
- Modify: `docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime.md`

- [ ] **Step 1: Update the ADR**

Record these invariants without fixing replaceable implementation details:

```text
- a global-timeout pause snapshot remains authoritative until a durable final trace payload is accepted by the async dispatcher;
- handoff recovery and provider export use separate bounded retry budgets;
- a retry replays the whole canonical fragment and may duplicate provider effects;
- recoverable transport failures retain the payload, while terminal failures and retry exhaustion clean it up;
- tracing failure never changes the workflow's terminal business outcome.
```

Clarify that temporary Agent-fragment cache TTL is not lifecycle authority, without weakening the separate parent-context retention requirement.

- [ ] **Step 2: Run formatting and targeted tests**

```bash
uv run --project api ruff check api/models/workflow.py api/configs/feature/__init__.py api/core/ops/entities/config_entity.py api/core/ops/ops_trace_manager.py api/tasks/human_input_timeout_tasks.py api/tasks/ops_trace_task.py api/repositories/sqlalchemy_api_workflow_run_repository.py api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py
```

```bash
uv run --project api pytest api/tests/unit_tests/configs/test_dify_config.py api/tests/unit_tests/models/test_workflow.py api/tests/unit_tests/core/ops/test_trace_queue_manager.py api/tests/unit_tests/core/ops/test_ops_trace_manager.py api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py api/tests/unit_tests/tasks/test_workflow_execute_task.py api/tests/unit_tests/tasks/test_ops_trace_task.py api/tests/unit_tests/services/test_human_input_service.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py -q
```

Expected: all targeted tests pass. The workflow-pause container integration tests remain CI-owned.

- [ ] **Step 3: Verify migration and worktree hygiene**

Run from `api/`:

```bash
uv run python -c 'from alembic.config import Config; from alembic.script import ScriptDirectory; c=Config("migrations/alembic.ini"); c.set_main_option("script_location", "migrations"); print(ScriptDirectory.from_config(c).get_heads())'
```

Expected: exactly one head, `4b7c2f19a6d8`.

Run:

```bash
git diff --check
git status --short
```

Expected: only intended files plus the user's pre-existing `docker/ssrf_proxy/squid.conf.template` modification.

- [ ] **Step 4: Commit the ADR update**

```bash
git add docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime.md
git commit -m "docs(trace): define bounded final delivery"
```
