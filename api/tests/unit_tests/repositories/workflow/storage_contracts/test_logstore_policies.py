"""Migration controls have observable storage effects, separate from the shared contract."""

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Mapper

from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.repositories.workflow.storage_contracts.entities import node, run
from tests.unit_tests.repositories.workflow.storage_contracts.harness import StorageContract


@pytest.fixture(params=[False, True], ids=["sdk", "pg"])
def logstore(
    request: pytest.FixtureRequest, transports: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> StorageContract:
    apply_config_overrides(
        monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND="logstore", WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="logstore"
    )
    transports.logs.client._use_pg_protocol = request.param
    return transports


@pytest.mark.parametrize("dual_write", [False, True])
@pytest.mark.parametrize("graph", [False, True])
def test_dual_write_and_graph_policy_affect_persisted_data(
    logstore: StorageContract, monkeypatch: pytest.MonkeyPatch, dual_write: bool, graph: bool
) -> None:
    apply_config_overrides(monkeypatch, LOGSTORE_DUAL_WRITE_ENABLED=dual_write, LOGSTORE_ENABLE_PUT_GRAPH_FIELD=graph)
    logstore.run_writer().save(run())
    logstore.node_writer().save(node())
    actual = logstore.runs().get_workflow_run_by_id("tenant-1", "app-1", "run-1")
    assert actual is not None
    assert actual.graph_dict == (run().graph if graph else {})
    with logstore.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        sql_node = session.get(WorkflowNodeExecutionModel, "execution-1")
        assert sql_run is not None
        assert sql_run.status == run().status
        assert (sql_node is not None) is dual_write
        if sql_run is not None:
            assert sql_run.graph_dict == (run().graph if dual_write else {})
            assert sql_run.inputs_dict == (run().inputs if dual_write else {})
            assert sql_run.outputs_dict == (run().outputs if dual_write else {})
        if sql_node is not None:
            assert sql_node.outputs_dict == node().outputs


@pytest.mark.parametrize("dual_read", [False, True])
@pytest.mark.parametrize("unavailable", [False, True], ids=["not-indexed", "unavailable"])
@pytest.mark.parametrize("lookup", ["scoped", "tenant", "internal"])
def test_migration_fallback_is_explicit_and_preserves_lookup_scope(
    logstore: StorageContract, monkeypatch: pytest.MonkeyPatch, dual_read: bool, unavailable: bool, lookup: str
) -> None:
    # A real record predating migration; nothing is inserted into LogStore.
    apply_config_overrides(monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND="rdbms")
    logstore.run_writer().save(run())
    apply_config_overrides(monkeypatch, WORKFLOW_RUN_STORAGE_BACKEND="logstore", LOGSTORE_DUAL_READ_ENABLED=dual_read)
    if unavailable:
        logstore.logs.failure = RuntimeError("LogStore unavailable")
    reader = logstore.runs()
    calls = {
        "scoped": lambda: reader.get_workflow_run_by_id("tenant-1", "app-1", "run-1"),
        "tenant": lambda: reader.get_workflow_run_by_id_and_tenant_id("tenant-1", "run-1"),
        "internal": lambda: reader.get_workflow_run_by_id_without_tenant("run-1"),
    }
    if unavailable and not dual_read:
        with pytest.raises(RuntimeError, match="LogStore unavailable"):
            calls[lookup]()
    else:
        actual = calls[lookup]()
        assert (actual is not None) is dual_read
        if actual is not None:
            assert actual.outputs_dict == run().outputs
        assert reader.get_workflow_run_by_id("tenant-2", "app-1", "run-1") is None
        assert reader.get_workflow_run_by_id("tenant-1", "app-2", "run-1") is None
        assert reader.get_workflow_run_by_id_and_tenant_id("tenant-2", "run-1") is None


def test_required_control_write_failure_is_propagated(logstore: StorageContract) -> None:
    def fail_control_write(_mapper: Mapper[WorkflowRun], _connection: Connection, _target: WorkflowRun) -> None:
        raise RuntimeError("control database unavailable")

    writer = logstore.run_writer()
    event.listen(WorkflowRun, "before_insert", fail_control_write)
    try:
        with pytest.raises(RuntimeError, match="control database unavailable"):
            writer.save(run())
    finally:
        event.remove(WorkflowRun, "before_insert", fail_control_write)
    with logstore.sessions() as session:
        assert session.get(WorkflowRun, "run-1") is None
    assert logstore.runs().get_workflow_run_by_id("tenant-1", "app-1", "run-1") is None


def test_control_only_update_preserves_an_existing_sql_log_copy(
    logstore: StorageContract, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, LOGSTORE_DUAL_WRITE_ENABLED=True)
    logstore.run_writer().save(run())
    apply_config_overrides(monkeypatch, LOGSTORE_DUAL_WRITE_ENABLED=False)
    logstore.run_writer().save(run().model_copy(update={"total_tokens": 42, "outputs": {"new": "log-only"}}))
    with logstore.sessions() as session:
        sql_run = session.get(WorkflowRun, "run-1")
        assert sql_run is not None
        assert sql_run.total_tokens == 42
        assert sql_run.outputs_dict == run().outputs
        assert sql_run.graph_dict == run().graph
