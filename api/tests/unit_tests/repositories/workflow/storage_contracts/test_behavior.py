from datetime import datetime, timedelta
from typing import get_args
from unittest.mock import MagicMock

import pytest
from sqlalchemy import event

from configs.feature import WorkflowStorageConfig
from core.app.workflow.persistence_ports import OrderConfig
from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from machinery.context import RequestContext
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionModel
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.repositories.workflow.storage_contracts.entities import START, node, run
from tests.unit_tests.repositories.workflow.storage_contracts.harness import BACKENDS, StorageContract


def test_every_configured_backend_has_a_contract_driver() -> None:
    for field in ("WORKFLOW_RUN_STORAGE_BACKEND", "WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND"):
        assert set(get_args(WorkflowStorageConfig.model_fields[field].annotation)) == set(BACKENDS)


def test_independent_configuration_round_trips_run_and_nodes(mixed_storage: StorageContract) -> None:
    mixed_storage.run_writer().save(run())
    mixed_storage.node_writer().save(node())
    mixed_storage.settle()
    stored_run = mixed_storage.runs().get_workflow_run_by_id("tenant-1", "app-1", "run-1")
    stored_node = mixed_storage.nodes().get_execution_by_id("execution-1", "tenant-1")
    assert stored_run is not None
    assert stored_run.outputs_dict == {"answer": [1, 2]}
    assert stored_node is not None
    assert stored_node.outputs_dict == {"answer": [1, 2]}
    # Controllers use this registered query service; it must select the same
    # backend as the writer, including when run and node storage differ.
    queries = build_application_services(
        database_client=mixed_storage.sessions,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=MagicMock(spec=RedisClientWrapper),
    ).workflow_runs
    context = RequestContext("request-1", None, "actor-1", "tenant-1")
    result = queries.get_workflow_run(context, app_id="app-1", run_id="run-1")
    assert result is not None
    assert result.outputs_dict == {"answer": [1, 2]}
    assert (
        queries.get_workflow_run(context._replace(active_workspace_id="other-tenant"), app_id="app-1", run_id="run-1")
        is None
    )
    assert queries.get_workflow_run(context, app_id="other-app", run_id="run-1") is None


def test_run_round_trip_preserves_business_fields(storage: StorageContract) -> None:
    expected = run()
    storage.run_writer().save(expected)
    storage.settle()
    actual = storage.runs().get_workflow_run_by_id("tenant-1", "app-1", expected.id_)
    assert actual is not None
    assert actual.inputs_dict == expected.inputs
    assert actual.outputs_dict == expected.outputs
    assert actual.graph_dict == expected.graph
    assert actual.status == expected.status
    assert actual.exceptions_count == expected.exceptions_count
    assert actual.total_tokens == expected.total_tokens
    assert actual.total_steps == expected.total_steps
    assert actual.elapsed_time == 5
    assert actual.created_at == expected.started_at
    assert actual.finished_at == expected.finished_at
    assert (actual.tenant_id, actual.app_id, actual.created_by) == ("tenant-1", "app-1", "actor-1")


def test_updates_and_redelivery_return_one_latest_run(storage: StorageContract) -> None:
    writer = storage.run_writer()
    initial = run().model_copy(update={"status": WorkflowExecutionStatus.RUNNING, "finished_at": None, "outputs": {}})
    writer.save(initial)
    writer.save(run())
    writer.save(run())
    storage.settle()
    actual = storage.runs().get_workflow_run_by_id("tenant-1", "app-1", "run-1")
    assert actual is not None
    assert actual.status == WorkflowExecutionStatus.SUCCEEDED
    page = storage.runs().get_paginated_workflow_runs("tenant-1", "app-1", WorkflowRunTriggeredFrom.APP_RUN)
    assert [item.id for item in page.data] == ["run-1"]
    counts = storage.runs().get_workflow_runs_count("tenant-1", "app-1", "app-run")
    assert counts == {"total": 1, "running": 0, "succeeded": 1, "failed": 0, "stopped": 0, "partial-succeeded": 0}
    assert storage.runs().get_workflow_runs_count("tenant-1", "app-1", "app-run", status="running")["total"] == 0
    assert (
        storage.runs()
        .get_paginated_workflow_runs("tenant-1", "app-1", WorkflowRunTriggeredFrom.APP_RUN, status="running")
        .data
        == []
    )


def test_run_lookups_and_lists_are_scoped(storage: StorageContract) -> None:
    storage.run_writer().save(run())
    storage.run_writer(tenant="tenant-2").save(run("foreign-tenant"))
    storage.run_writer(app="app-2").save(run("foreign-app"))
    storage.run_writer(trigger=WorkflowRunTriggeredFrom.DEBUGGING).save(run("debug"))
    storage.settle()
    assert storage.runs().get_workflow_run_by_id("tenant-2", "app-1", "run-1") is None
    assert storage.runs().get_workflow_run_by_id("tenant-1", "app-2", "run-1") is None
    assert storage.runs().get_workflow_run_by_id_and_tenant_id("tenant-2", "run-1") is None
    assert storage.runs().get_workflow_run_by_id_without_tenant("missing") is None
    page = storage.runs().get_paginated_workflow_runs("tenant-1", "app-1", WorkflowRunTriggeredFrom.APP_RUN)
    assert [item.id for item in page.data] == ["run-1"]


@pytest.mark.parametrize(("foreign_tenant", "foreign_app"), [("tenant-2", "app-1"), ("tenant-1", "app-2")])
def test_writes_cannot_replace_another_owners_records(
    storage: StorageContract, foreign_tenant: str, foreign_app: str
) -> None:
    storage.run_writer().save(run())
    storage.node_writer().save(node())
    storage.settle()
    # IDs are globally unique in SQL and scoped in the log queries. A backend may
    # reject an ID collision or keep it in a separate namespace; neither may alter
    # the first owner's data, including when the write crosses a task boundary.
    for write in (
        lambda: storage.run_writer(tenant=foreign_tenant, app=foreign_app).save(
            run().model_copy(update={"outputs": {"foreign": True}})
        ),
        lambda: storage.node_writer(tenant=foreign_tenant, app=foreign_app).save(
            node().model_copy(update={"outputs": {"foreign": True}})
        ),
        lambda: storage.node_writer(tenant=foreign_tenant, app=foreign_app).save_execution_data(
            node().model_copy(update={"outputs": {"foreign": True}})
        ),
    ):
        try:
            write()
            storage.settle()
        except ValueError:
            pass
    actual_run = storage.runs().get_workflow_run_by_id("tenant-1", "app-1", "run-1")
    actual_nodes = storage.nodes().get_executions_by_workflow_run("tenant-1", "app-1", "run-1")
    assert actual_run is not None
    assert actual_run.outputs_dict == run().outputs
    assert len(actual_nodes) == 1
    assert actual_nodes[0].outputs_dict == node().outputs


def test_pagination_has_stable_tie_breaking_and_validates_cursor(storage: StorageContract) -> None:
    for id in ("run-1", "run-2", "run-3"):
        storage.run_writer().save(run(id))
    storage.settle()
    first = storage.runs().get_paginated_workflow_runs("tenant-1", "app-1", WorkflowRunTriggeredFrom.APP_RUN, limit=2)
    assert first.has_more is True
    assert [item.id for item in first.data] == ["run-3", "run-2"]
    second = storage.runs().get_paginated_workflow_runs(
        "tenant-1", "app-1", WorkflowRunTriggeredFrom.APP_RUN, limit=2, last_id=first.data[-1].id
    )
    assert [item.id for item in second.data] == ["run-1"]
    assert second.has_more is False
    with pytest.raises(ValueError):
        storage.runs().get_paginated_workflow_runs(
            "tenant-2", "app-1", WorkflowRunTriggeredFrom.APP_RUN, last_id="run-1"
        )


def test_run_counts_honor_time_range(storage: StorageContract) -> None:
    storage.run_writer().save(run("old", start=START - timedelta(days=10)))
    storage.run_writer().save(run("recent"))
    storage.settle()
    assert storage.runs().get_workflow_runs_count("tenant-1", "app-1", "app-run", time_range="7d")["total"] == 1


def test_node_details_and_history_preserve_payload_and_owner(storage: StorageContract) -> None:
    expected = node()
    storage.node_writer().save(expected)
    storage.settle()
    actual = storage.nodes().get_execution_by_id(expected.id, "tenant-1")
    assert actual is not None
    assert actual.inputs_dict == expected.inputs
    assert actual.outputs_dict == expected.outputs
    assert storage.nodes().load_full_process_data(actual) == expected.process_data
    assert actual.created_at == expected.created_at
    assert actual.finished_at == expected.finished_at
    assert actual.node_execution_id == expected.node_execution_id
    assert storage.nodes().get_execution_by_id(expected.id, "tenant-2") is None
    assert storage.nodes().get_executions_by_workflow_run("tenant-2", "app-1", "run-1") == []
    assert storage.nodes().get_executions_by_workflow_run("tenant-1", "app-2", "run-1") == []


def test_node_updates_and_order_are_shared_by_fresh_readers(storage: StorageContract) -> None:
    writer = storage.node_writer()
    writer.save(node().model_copy(update={"status": WorkflowNodeExecutionStatus.RUNNING, "outputs": {}}))
    writer.save(node("execution-2", index=2))
    writer.save(node())
    writer.save(node())
    storage.settle()
    actual = storage.nodes().get_executions_by_workflow_run("tenant-1", "app-1", "run-1")
    assert [item.id for item in actual] == ["execution-1", "execution-2"]
    assert all(item.status == WorkflowNodeExecutionStatus.SUCCEEDED for item in actual)
    domain = storage.node_writer().get_by_workflow_execution("run-1", OrderConfig(["index"], "asc"))
    assert [item.id for item in domain] == ["execution-1", "execution-2"]
    latest = storage.nodes().get_node_last_execution("tenant-1", "app-1", "workflow-1", "node-1")
    assert latest is not None
    assert latest.id == "execution-2"


def test_paused_nodes_remain_in_snapshots_but_not_completed_history(storage: StorageContract) -> None:
    writer = storage.node_writer()
    writer.save(node().model_copy(update={"status": WorkflowNodeExecutionStatus.PAUSED}))
    storage.settle()
    detail = storage.nodes().get_executions_by_workflow_run("tenant-1", "app-1", "run-1")
    assert len(detail) == 1
    assert detail[0].status == WorkflowNodeExecutionStatus.PAUSED
    assert storage.node_writer().get_by_workflow_execution("run-1") == []
    assert writer.get_by_workflow_execution("run-1") == []
    snapshots = storage.nodes().get_execution_snapshots_by_workflow_run(
        "tenant-1", "app-1", "workflow-1", "workflow-run", "run-1"
    )
    assert len(snapshots) == 1
    assert snapshots[0].status == "paused"


def test_caller_row_is_durable_before_async_delivery(storage: StorageContract) -> None:
    expected = node().model_copy(update={"status": WorkflowNodeExecutionStatus.RUNNING})
    storage.node_writer().save_synchronously(expected)
    # This is a separate SQL control-state contract required by Agent participant
    # allocation, even when the execution-log backend is remote or asynchronous.
    with storage.sessions() as session:
        actual = session.get(WorkflowNodeExecutionModel, expected.id)
        assert actual is not None
        assert (actual.tenant_id, actual.app_id, actual.workflow_id) == ("tenant-1", "app-1", "workflow-1")
        assert actual.status == WorkflowNodeExecutionStatus.RUNNING


def test_latest_version_is_not_limited_to_first_hundred_logs(storage: StorageContract) -> None:
    writer = storage.run_writer()
    for tokens in range(105):
        writer.save(run().model_copy(update={"total_tokens": tokens}))
    storage.settle()
    actual = storage.runs().get_workflow_run_by_id("tenant-1", "app-1", "run-1")
    assert actual is not None
    assert actual.total_tokens == 104


@pytest.mark.parametrize("deliver_before_update", [False, True])
@pytest.mark.parametrize(
    "status",
    [WorkflowNodeExecutionStatus.RUNNING, WorkflowNodeExecutionStatus.RETRY, WorkflowNodeExecutionStatus.SUCCEEDED],
)
def test_data_updates_are_visible_without_resaving_execution(
    storage: StorageContract, deliver_before_update: bool, status: WorkflowNodeExecutionStatus
) -> None:
    expected = node().model_copy(update={"status": status})
    writer = storage.node_writer()
    writer.save(expected)
    if deliver_before_update:
        storage.settle()
    changed = expected.model_copy(update={"outputs": {"changed": True}, "process_data": {"extra": "value"}})
    writer.save_execution_data(changed)
    storage.settle()
    actual = storage.nodes().get_execution_by_id(expected.id, "tenant-1")
    assert actual is not None
    assert actual.outputs_dict == changed.outputs
    assert storage.nodes().load_full_process_data(actual) == changed.process_data


@pytest.mark.parametrize("field", ["inputs", "process_data", "outputs"])
@pytest.mark.parametrize("status", [WorkflowNodeExecutionStatus.RETRY, WorkflowNodeExecutionStatus.SUCCEEDED])
def test_queued_save_cannot_restore_offloaded_payload(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch, field: str, status: WorkflowNodeExecutionStatus
) -> None:

    apply_config_overrides(
        monkeypatch,
        WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="celery",
        WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=128,
        WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=16,
    )
    blobs: dict[str, bytes] = {}
    monkeypatch.setattr("extensions.ext_storage.storage.save", lambda key, value: blobs.__setitem__(key, value))
    monkeypatch.setattr("extensions.ext_storage.storage.load", lambda key: blobs[key])
    execution = node().model_copy(update={"status": status, field: {"large": "x" * 1024}})
    writer = transports.node_writer()
    writer.save(execution)
    writer.save_execution_data(execution)
    transports.settle()
    actual = transports.nodes().get_execution_by_id(execution.id, "tenant-1")
    assert actual is not None
    assert getattr(actual, f"{field}_dict") != getattr(execution, field)
    restored = transports.node_writer().get_by_workflow_execution("run-1")[0]
    assert getattr(restored, field) == getattr(execution, field)


def test_unfinished_node_is_readable(storage: StorageContract) -> None:
    storage.node_writer().save(
        node().model_copy(update={"status": WorkflowNodeExecutionStatus.RUNNING, "finished_at": None})
    )
    storage.settle()
    actual = storage.nodes().get_execution_by_id("execution-1", "tenant-1")
    assert actual is not None
    assert actual.finished_at is None


@pytest.mark.parametrize(("timezone", "date"), [("UTC", "2026-04-01"), ("Asia/Shanghai", "2026-04-02")])
def test_statistics_use_run_time_timezone_and_latest_values(storage: StorageContract, timezone: str, date: str) -> None:
    start = datetime(2026, 4, 1, 20)
    # All three executions start on the same local date, but arrive at LogStore now.
    # Replayed terminal writes must not inflate token usage; active runs count too.
    writer = storage.run_writer()
    writer.save(run("a", start=start).model_copy(update={"total_tokens": 2}))
    writer.save(run("a", start=start).model_copy(update={"total_tokens": 7}))
    writer.save(run("a", start=start).model_copy(update={"total_tokens": 7}))
    writer.save(run("b", start=start).model_copy(update={"total_tokens": 3}))
    storage.run_writer(actor="actor-2").save(
        run("c", start=start).model_copy(
            update={"total_tokens": 1, "status": WorkflowExecutionStatus.RUNNING, "finished_at": None}
        )
    )
    writer.save(run("outside", start=start - timedelta(days=2)))
    storage.run_writer(tenant="tenant-2").save(run("foreign", start=start))
    storage.settle()
    args = ("tenant-1", "app-1", "app-run", start - timedelta(hours=1), start + timedelta(hours=1), timezone)
    reader = storage.runs()
    assert reader.get_daily_runs_statistics(*args) == [{"date": date, "runs": 3}]
    assert reader.get_daily_terminals_statistics(*args) == [{"date": date, "terminal_count": 2}]
    assert reader.get_daily_token_cost_statistics(*args) == [{"date": date, "token_count": 11}]
    assert reader.get_average_app_interaction_statistics(*args) == [{"date": date, "interactions": 1.5}]


def test_failed_writes_are_reported_and_do_not_poison_read_cache(storage: StorageContract) -> None:
    writer = storage.node_writer()
    # Relational writes fail inside a real transaction; remote transports fail at dispatch.

    engine = storage.sessions.kw["bind"]

    def fail_insert(
        _conn: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        if statement.lstrip().upper().startswith("INSERT"):
            raise RuntimeError("write unavailable")

    event.listen(engine, "before_cursor_execute", fail_insert)
    storage.deliveries.failure = RuntimeError("write unavailable")
    storage.logs.failure = RuntimeError("write unavailable")
    try:
        with pytest.raises(RuntimeError, match="write unavailable"):
            writer.save(node())
    finally:
        event.remove(engine, "before_cursor_execute", fail_insert)
        storage.deliveries.failure = None
        storage.logs.failure = None
    assert writer.get_by_workflow_execution("run-1") == []
    storage.settle()
    assert storage.nodes().get_execution_by_id("execution-1", "tenant-1") is None


def test_snapshots_and_details_preserve_scope_and_data(storage: StorageContract) -> None:
    expected = node()
    storage.node_writer().save(expected)
    storage.node_writer(app="app-2").save(node("foreign-app"))
    storage.node_writer(tenant="tenant-2").save(node("foreign-tenant"))
    storage.settle()
    reader = storage.nodes()
    snapshots = reader.get_execution_snapshots_by_workflow_run(
        "tenant-1", "app-1", "workflow-1", "workflow-run", "run-1"
    )
    assert [snapshot.execution_id for snapshot in snapshots] == [expected.node_execution_id]
    assert (
        reader.get_execution_snapshots_by_workflow_run("tenant-1", "app-1", "wrong-workflow", "workflow-run", "run-1")
        == []
    )
    assert (
        reader.get_execution_snapshots_by_workflow_run("tenant-1", "app-1", "workflow-1", "single-step", "run-1") == []
    )
    details = reader.get_executions_by_workflow_run(tenant_id="tenant-1", app_id="app-1", workflow_run_id="run-1")
    assert len(details) == 1
    assert details[0].id == expected.id
    assert reader.load_full_process_data(details[0]) == expected.process_data


def test_node_history_is_not_silently_truncated_at_remote_page_size(storage: StorageContract) -> None:
    writer = storage.node_writer()
    for index in range(1001):
        writer.save(node(f"execution-{index}", index=index))
    storage.settle()
    details = storage.nodes().get_executions_by_workflow_run("tenant-1", "app-1", "run-1")
    assert len(details) == 1001
    assert len({execution.id for execution in details}) == 1001
    history = storage.node_writer().get_by_workflow_execution("run-1", OrderConfig(["index"], "asc"))
    assert [execution.index for execution in history] == list(range(1001))


@pytest.mark.parametrize(
    "status",
    [
        WorkflowNodeExecutionStatus.SUCCEEDED,
        WorkflowNodeExecutionStatus.FAILED,
        WorkflowNodeExecutionStatus.EXCEPTION,
        WorkflowNodeExecutionStatus.STOPPED,
        WorkflowNodeExecutionStatus.PAUSED,
    ],
)
def test_celery_reordered_and_repeated_deliveries_preserve_latest_state(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch, status: WorkflowNodeExecutionStatus
) -> None:

    apply_config_overrides(monkeypatch, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="celery")
    writer = transports.node_writer()
    writer.save(
        node().model_copy(update={"status": WorkflowNodeExecutionStatus.RUNNING, "finished_at": None, "outputs": {}})
    )
    writer.save(node().model_copy(update={"status": status, "outputs": {"answer": "latest"}}))
    older = transports.deliveries.pending.popleft()
    newer = transports.deliveries.pending.popleft()
    transports.deliveries.pending.extend([newer, older, newer])
    transports.settle()
    actual = transports.nodes().get_execution_by_id("execution-1", "tenant-1")
    assert actual is not None
    assert actual.status == status
    assert actual.outputs_dict == {"answer": "latest"}


def test_celery_retry_snapshots_cannot_roll_back_attempt_history(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> None:

    apply_config_overrides(monkeypatch, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="celery")
    writer = transports.node_writer()
    first = node().model_copy(
        update={
            "status": WorkflowNodeExecutionStatus.RETRY,
            "finished_at": None,
            "process_data": {RETRY_HISTORY_PROCESS_DATA_KEY: [{"retry_index": 1}]},
        }
    )
    second = first.model_copy(
        update={"process_data": {RETRY_HISTORY_PROCESS_DATA_KEY: [{"retry_index": 1}, {"retry_index": 2}]}}
    )
    writer.save(first)
    writer.save(second)
    older = transports.deliveries.pending.popleft()
    newer = transports.deliveries.pending.popleft()
    transports.deliveries.pending.extend([older, newer, older, newer])
    transports.settle()
    actual = transports.nodes().get_execution_by_id(first.id, "tenant-1")
    assert actual is not None
    assert actual.status == WorkflowNodeExecutionStatus.RETRY
    assert actual.process_data_dict == second.process_data


@pytest.mark.parametrize("resume_finishes_first", [False, True])
@pytest.mark.parametrize(
    "prior_status",
    [WorkflowNodeExecutionStatus.RUNNING, WorkflowNodeExecutionStatus.RETRY, WorkflowNodeExecutionStatus.PAUSED],
)
def test_celery_resumed_node_rejects_pre_pause_deliveries(
    transports: StorageContract,
    monkeypatch: pytest.MonkeyPatch,
    resume_finishes_first: bool,
    prior_status: WorkflowNodeExecutionStatus,
) -> None:

    apply_config_overrides(monkeypatch, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="celery")
    writer = transports.node_writer()
    paused = node().model_copy(update={"status": WorkflowNodeExecutionStatus.PAUSED})
    resumed = node().model_copy(
        update={
            "status": WorkflowNodeExecutionStatus.RUNNING,
            "created_at": START + timedelta(minutes=1),
            "finished_at": None,
            "outputs": {},
        }
    )
    finished = resumed.model_copy(
        update={
            "status": WorkflowNodeExecutionStatus.SUCCEEDED,
            "finished_at": START + timedelta(minutes=2),
            "outputs": {"answer": "resumed"},
        }
    )
    writer.save(paused.model_copy(update={"status": prior_status}))
    transports.settle()
    writer.save(paused)
    old_delivery = transports.deliveries.pending.popleft()
    writer.save(resumed)
    writer.save(finished)
    resumed_delivery = transports.deliveries.pending.popleft()
    finished_delivery = transports.deliveries.pending.popleft()
    if resume_finishes_first:
        transports.deliveries.pending.extend([finished_delivery, old_delivery, resumed_delivery])
    else:
        transports.deliveries.pending.extend([resumed_delivery, old_delivery, finished_delivery])
    transports.settle()
    actual = transports.nodes().get_execution_by_id(paused.id, "tenant-1")
    assert actual is not None
    assert actual.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert actual.created_at == resumed.created_at
    assert actual.outputs_dict == finished.outputs
