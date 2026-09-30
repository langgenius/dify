"""SQL-only archives must not publish control rows as complete workflow logs."""

import json

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from sqlalchemy import delete, null, select, update

from configs import dify_config
from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY, WorkflowNodeRetryAttempt
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun, WorkflowRunArchiveBundle
from services.retention.workflow_run.archive_paid_plan_workflow_run import WorkflowRunArchiver
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.repositories.workflow.storage_contracts.entities import node, run
from tests.unit_tests.repositories.workflow.storage_contracts.harness import StorageContract
from tests.unit_tests.services.retention.workflow_run.test_workflow_run_archiver_sqlite import FakeArchiveStorage


def _retry_attempt(index: int) -> dict[str, object]:
    return WorkflowNodeRetryAttempt(
        retry_index=index,
        inputs={"attempt": index},
        process_data={"request": "x" * 256},
        outputs={"status_code": 500},
        error="request failed",
        elapsed_time=1,
        execution_metadata={},
        created_at=1_700_000_000 + index,
        finished_at=1_700_000_001 + index,
    ).model_dump(mode="json")


@pytest.mark.parametrize("retries", [1, 2])
@pytest.mark.parametrize("offloaded", [False, True])
@pytest.mark.parametrize("dry_run", [False, True])
def test_retry_history_and_normal_run_can_be_archived_in_one_bundle(
    transports: StorageContract,
    monkeypatch: pytest.MonkeyPatch,
    retries: int,
    offloaded: bool,
    dry_run: bool,
) -> None:
    apply_config_overrides(
        monkeypatch,
        WORKFLOW_RUN_STORAGE_BACKEND="rdbms",
        WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms",
        WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=128 if offloaded else 1_000_000,
        WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH=1 if offloaded else 100,
        WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=16 if offloaded else 1_000_000,
    )
    blobs: dict[str, bytes] = {}
    monkeypatch.setattr("extensions.ext_storage.storage.save", lambda key, value: blobs.__setitem__(key, value))
    monkeypatch.setattr("extensions.ext_storage.storage.load", lambda key: blobs[key])
    transports.run_writer().save(run().model_copy(update={"total_steps": retries + 1}))
    transports.run_writer().save(run("run-2").model_copy(update={"total_steps": 1}))
    writer = transports.node_writer()
    retry_node = node().model_copy(update={"status": WorkflowNodeExecutionStatus.RUNNING})
    writer.save(retry_node)
    for index in range(1, retries + 1):
        retry_node = retry_node.model_copy(
            update={
                "status": WorkflowNodeExecutionStatus.RETRY,
                "process_data": {RETRY_HISTORY_PROCESS_DATA_KEY: [_retry_attempt(i) for i in range(1, index + 1)]},
            }
        )
        writer.save(retry_node)
    retry_node.status = WorkflowNodeExecutionStatus.SUCCEEDED
    writer.save(retry_node)
    writer.save_execution_data(retry_node)
    normal_node = node("normal-node").model_copy(update={"workflow_execution_id": "run-2"})
    writer.save(normal_node)

    persisted = transports.nodes().get_execution_by_id(retry_node.id, "tenant-1")
    assert persisted is not None
    assert persisted.process_data_truncated is offloaded
    assert transports.nodes().load_full_process_data(persisted) == retry_node.process_data
    archive_storage = FakeArchiveStorage()
    with transports.sessions() as session:
        assert len(session.scalars(select(WorkflowNodeExecutionModel)).all()) == 2
        runs = session.scalars(select(WorkflowRun).order_by(WorkflowRun.id)).all()
        result = WorkflowRunArchiver(dry_run=dry_run)._archive_bundle(session, archive_storage, runs)
        assert result.success, result.error
        assert result.run_count == 2
        counts = {table.table_name: table.row_count for table in result.tables}
        assert counts["workflow_runs"] == counts["workflow_node_executions"] == 2
        if dry_run:
            assert archive_storage.objects == {}
        else:
            payload = archive_storage.objects[f"{result.object_prefix}/workflow_node_executions.parquet"]
            archived_nodes = {item["id"]: item for item in pq.read_table(pa.BufferReader(payload)).to_pylist()}
            if not offloaded:
                assert json.loads(archived_nodes[retry_node.id]["process_data"]) == retry_node.process_data
            else:
                assert counts["workflow_node_execution_offload"] > 0
            assert len(session.scalars(select(WorkflowRunArchiveBundle)).all()) == 1


@pytest.mark.parametrize("history_kind", ["partial", "duplicate", "malformed", "not-a-list"])
def test_invalid_or_insufficient_retry_history_cannot_mask_missing_attempts(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch, history_kind: str
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND="rdbms", WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms"
    )
    histories: dict[str, object] = {
        "partial": [_retry_attempt(1)],
        "duplicate": [_retry_attempt(1), _retry_attempt(1)],
        "malformed": [_retry_attempt(1), {"retry_index": 2}],
        "not-a-list": {"retry_index": 1},
    }
    transports.run_writer().save(run().model_copy(update={"total_steps": 3}))
    transports.node_writer().save(
        node().model_copy(update={"process_data": {RETRY_HISTORY_PROCESS_DATA_KEY: histories[history_kind]}})
    )
    archive_storage = FakeArchiveStorage()
    with transports.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        assert sql_run is not None
        result = WorkflowRunArchiver()._archive_bundle(session, archive_storage, [sql_run])
        assert not result.success
        assert not result.skipped
        assert archive_storage.objects == {}
        assert session.scalars(select(WorkflowRunArchiveBundle)).all() == []
        if history_kind in ("partial", "duplicate"):
            assert result.error is not None
            assert "1 rows with 1 retries for 3 execution steps" in result.error


def test_missing_offloaded_retry_history_cannot_use_the_inline_preview(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(
        monkeypatch,
        WORKFLOW_RUN_STORAGE_BACKEND="rdbms",
        WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms",
        WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=128,
        WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=16,
    )
    blobs: dict[str, bytes] = {}
    monkeypatch.setattr("extensions.ext_storage.storage.save", lambda key, value: blobs.__setitem__(key, value))
    monkeypatch.setattr("extensions.ext_storage.storage.load", lambda key: blobs[key])
    transports.run_writer().save(run())
    execution = node().model_copy(update={"process_data": {RETRY_HISTORY_PROCESS_DATA_KEY: [_retry_attempt(1)]}})
    writer = transports.node_writer()
    writer.save(execution)
    writer.save_execution_data(execution)
    blobs.clear()
    archive_storage = FakeArchiveStorage()
    with transports.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        assert sql_run is not None
        result = WorkflowRunArchiver()._archive_bundle(session, archive_storage, [sql_run])
        assert not result.success
        assert not result.skipped
        assert archive_storage.objects == {}
        assert session.scalars(select(WorkflowRunArchiveBundle)).all() == []


@pytest.mark.parametrize("run_backend", ["rdbms", "celery"])
@pytest.mark.parametrize("sql_node_count", [0, 1, 2])
@pytest.mark.parametrize("dry_run", [False, True])
def test_historical_logstore_nodes_require_sql_records_after_backend_switch(
    transports: StorageContract,
    monkeypatch: pytest.MonkeyPatch,
    run_backend: str,
    sql_node_count: int,
    dry_run: bool,
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND=run_backend, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="logstore"
    )
    transports.run_writer().save(run())
    nodes = [node(f"execution-{index}", index=index) for index in (1, 2)]
    log_writer = transports.node_writer()
    for execution in nodes:
        log_writer.save(execution)
    transports.settle()
    for execution in nodes:
        assert transports.nodes().get_execution_by_id(execution.id, "tenant-1") is not None

    apply_config_overrides(monkeypatch, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms")
    sql_writer = transports.node_writer()
    for execution in nodes[:sql_node_count]:
        sql_writer.save(execution)

    archive_storage = FakeArchiveStorage()
    archiver = WorkflowRunArchiver(dry_run=dry_run)
    with transports.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        assert sql_run is not None
        assert sql_run.graph_dict == run().graph
        result = archiver._archive_bundle(session, archive_storage, [sql_run])
        if sql_node_count < len(nodes):
            assert not result.success
            assert not result.skipped
            assert result.error is not None
            assert "insufficient SQL node logs" in result.error
            assert archive_storage.objects == {}
            assert session.scalars(select(WorkflowRunArchiveBundle)).all() == []
        else:
            assert result.success, result.error
            assert {table.table_name: table.row_count for table in result.tables}["workflow_node_executions"] == 2
            if not dry_run:
                payload = archive_storage.objects[f"{result.object_prefix}/workflow_node_executions.parquet"]
                archived_nodes = pq.read_table(pa.BufferReader(payload)).to_pylist()
                assert {item["id"] for item in archived_nodes} == {execution.id for execution in nodes}
        assert session.get(WorkflowRun, "run-1") is not None


def test_other_runs_in_a_bundle_cannot_mask_missing_nodes(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND="rdbms", WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms"
    )
    transports.run_writer().save(run())
    transports.run_writer().save(run("run-2"))
    for index in range(1, 5):
        execution = node(f"execution-{index}", index=index).model_copy(update={"workflow_execution_id": "run-2"})
        transports.node_writer().save(execution)

    archive_storage = FakeArchiveStorage()
    with transports.sessions() as session:
        runs = session.scalars(select(WorkflowRun).order_by(WorkflowRun.id)).all()
        result = WorkflowRunArchiver()._archive_bundle(session, archive_storage, runs)
        assert not result.success
        assert result.error is not None
        assert "run-1 has insufficient SQL node logs (0 rows with 0 retries for 2 execution steps)" in result.error
        assert archive_storage.objects == {}
        assert session.scalars(select(WorkflowRunArchiveBundle)).all() == []


@pytest.mark.parametrize("different_owner", ["tenant", "app", "workflow"])
def test_node_count_requires_matching_run_ownership(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch, different_owner: str
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND="rdbms", WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms"
    )
    transports.run_writer().save(run())
    writer = transports.node_writer(
        tenant="tenant-2" if different_owner == "tenant" else "tenant-1",
        app="app-2" if different_owner == "app" else "app-1",
    )
    for index in (1, 2):
        execution = node(f"execution-{index}", index=index)
        if different_owner == "workflow":
            execution = execution.model_copy(update={"workflow_id": "workflow-2"})
        writer.save(execution)

    archive_storage = FakeArchiveStorage()
    with transports.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        assert sql_run is not None
        result = WorkflowRunArchiver()._archive_bundle(session, archive_storage, [sql_run])
        assert not result.success
        assert result.error is not None
        assert "0 rows with 0 retries for 2 execution steps" in result.error
        assert archive_storage.objects == {}


def test_run_failed_before_any_node_started_can_be_archived(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND="rdbms", WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms"
    )
    transports.run_writer().save(run().model_copy(update={"total_steps": 0, "status": WorkflowExecutionStatus.FAILED}))
    archive_storage = FakeArchiveStorage()
    with transports.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        assert sql_run is not None
        result = WorkflowRunArchiver()._archive_bundle(session, archive_storage, [sql_run])
        assert result.success, result.error
        assert {table.table_name: table.row_count for table in result.tables}["workflow_node_executions"] == 0


def test_missing_historical_step_count_is_not_treated_as_zero(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND="rdbms", WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms"
    )
    transports.run_writer().save(run())
    with transports.sessions.begin() as session:
        session.execute(update(WorkflowRun).where(WorkflowRun.id == "run-1").values({WorkflowRun.total_steps: null()}))
    archive_storage = FakeArchiveStorage()
    with transports.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        assert sql_run is not None
        result = WorkflowRunArchiver()._archive_bundle(session, archive_storage, [sql_run])
        assert not result.success
        assert result.error is not None
        assert "has no execution step count" in result.error
        assert archive_storage.objects == {}


@pytest.mark.parametrize("include_new_run", [False, True], ids=["known-manifest", "indexed-run"])
def test_already_archived_nodes_can_be_cleaned_without_blocking_archive_retries(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch, include_new_run: bool
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND="rdbms", WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms"
    )
    transports.run_writer().save(run())
    for index in (1, 2):
        transports.node_writer().save(node(f"execution-{index}", index=index))
    archive_storage = FakeArchiveStorage()
    with transports.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        assert sql_run is not None
        result = WorkflowRunArchiver()._archive_bundle(session, archive_storage, [sql_run])
        assert result.success, result.error
    with transports.sessions.begin() as session:
        session.execute(delete(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.workflow_run_id == "run-1"))

    if include_new_run:
        transports.run_writer().save(run("run-2"))
        for index in (1, 2):
            execution = node(f"other-{index}", index=index).model_copy(update={"workflow_execution_id": "run-2"})
            transports.node_writer().save(execution)
    with transports.sessions() as session:
        runs = session.scalars(select(WorkflowRun).order_by(WorkflowRun.id)).all()
        result = WorkflowRunArchiver()._archive_bundle(session, archive_storage, runs)
        assert result.success, result.error
        assert result.skipped is not include_new_run
        if include_new_run:
            assert result.skipped_run_count == 1
            assert result.run_count == 1
            assert {table.table_name: table.row_count for table in result.tables}["workflow_node_executions"] == 2


@pytest.mark.parametrize("dual_write", [False, True])
@pytest.mark.parametrize("dry_run", [False, True])
def test_archive_requires_sql_logs_for_both_configured_backends(
    mixed_storage: StorageContract, monkeypatch: pytest.MonkeyPatch, dual_write: bool, dry_run: bool
) -> None:
    apply_config_overrides(monkeypatch, LOGSTORE_DUAL_WRITE_ENABLED=dual_write, LOGSTORE_ENABLE_PUT_GRAPH_FIELD=True)
    mixed_storage.run_writer().save(run())
    mixed_storage.node_writer().save(node())
    mixed_storage.node_writer().save(node("execution-2", index=2))
    mixed_storage.settle()
    # The configured backend has complete logs, even when the SQL copy is absent.
    actual = mixed_storage.runs().get_workflow_run_by_id("tenant-1", "app-1", "run-1")
    assert actual is not None
    assert actual.graph_dict == run().graph
    assert actual.inputs_dict == run().inputs
    assert actual.outputs_dict == run().outputs
    assert mixed_storage.nodes().get_execution_by_id("execution-1", "tenant-1") is not None

    archive_storage = FakeArchiveStorage()
    archiver = WorkflowRunArchiver(dry_run=dry_run)
    with mixed_storage.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        assert sql_run is not None
        result = archiver._archive_bundle(session, archive_storage, [sql_run])
        if "logstore" in (
            dify_config.WORKFLOW_RUN_STORAGE_BACKEND,
            dify_config.WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND,
        ):
            assert not result.success
            assert not result.skipped
            assert result.error is not None
            assert "does not support LogStore run or node storage" in result.error
            assert archive_storage.objects == {}
            assert session.scalars(select(WorkflowRunArchiveBundle)).all() == []
            assert session.get(WorkflowRun, "run-1") is not None
            return

        assert result.success, result.error
        assert {table.table_name: table.row_count for table in result.tables}["workflow_node_executions"] == 2
        if dry_run:
            assert archive_storage.objects == {}
        else:
            payload = archive_storage.objects[f"{result.object_prefix}/workflow_runs.parquet"]
            archived_run = pq.read_table(pa.BufferReader(payload)).to_pylist()[0]
            assert json.loads(archived_run["graph"]) == run().graph
            assert json.loads(archived_run["inputs"]) == run().inputs
            assert json.loads(archived_run["outputs"]) == run().outputs
            assert len(session.scalars(select(WorkflowRunArchiveBundle)).all()) == 1


@pytest.mark.parametrize("backend", ["logstore", "celery"])
@pytest.mark.parametrize("dry_run", [False, True])
def test_control_record_cannot_be_archived_after_switching_back_to_sql(
    transports: StorageContract, monkeypatch: pytest.MonkeyPatch, backend: str, dry_run: bool
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND=backend, WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms"
    )
    transports.run_writer().save(run())
    transports.node_writer().save(node())
    transports.node_writer().save(node("execution-2", index=2))
    apply_config_overrides(monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND="rdbms")

    archive_storage = FakeArchiveStorage()
    archiver = WorkflowRunArchiver(dry_run=dry_run)
    with transports.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        assert sql_run is not None
        assert sql_run.graph is None
        result = archiver._archive_bundle(session, archive_storage, [sql_run])
        assert not result.success
        assert not result.skipped
        assert result.error is not None
        assert "has no SQL graph payload" in result.error
        assert archive_storage.objects == {}
        assert session.scalars(select(WorkflowRunArchiveBundle)).all() == []
        assert session.get(WorkflowRun, "run-1") is not None

    if backend == "celery":
        transports.settle()
        with transports.sessions() as session:
            sql_run = session.get(WorkflowRun, "run-1")
            assert sql_run is not None
            result = archiver._archive_bundle(session, archive_storage, [sql_run])
            assert result.success, result.error
