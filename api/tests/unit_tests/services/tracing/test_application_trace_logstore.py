"""Configured LogStore readers work without SQL mirrors and retain source ownership."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

import pytest
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.ops.entities.trace_entity import ModerationTraceInfo
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceRun
from models.model import App, AppMode
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from repositories.application_trace_repository import TraceCollectionError
from services.tracing.provider_dispatch import TraceExportResult
from services.tracing.recovery import _workflow_task
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_workflow
from tests.unit_tests.services.tracing.test_application_trace_collection import (
    Collection,
    batch_for,
    claim,
    identifier,
    ingest,
    seed,
    terminal,
)
from tests.unit_tests.services.tracing.test_application_trace_handoff import AGENT_GRAPH, workflow_info


@dataclass
class StoredSource:
    case: Collection
    kind: Literal["workflow", "node"]
    row: dict[str, object]
    requests: list[str]

    def start(self) -> ApplicationTraceRun:
        run = self.case.repository.start(
            tenant_id=self.case.run.tenant_id,
            app_id=self.case.run.app_id,
            source_kind=self.kind,
            source_id=str(self.row["id"]),
            session_id="logstore-session",
        )
        assert run is not None
        return run

    def service(self) -> ApplicationTracingService:
        return ApplicationTracingService(self.case.repository)

    def status(self, node_execution_id: str | None = None) -> dict[str, object]:
        return self.service().status(
            tenant_id=self.case.run.tenant_id,
            app_id=self.case.run.app_id,
            source_kind=self.kind,
            source_id=str(self.row["id"]),
            node_execution_id=node_execution_id,
        )


@pytest.fixture(params=["workflow", "node"])
def stored(
    request: pytest.FixtureRequest,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[StoredSource]:
    kind = request.param
    assert kind in {"workflow", "node"}
    case = seed(sqlite_session_factory, "logstore")
    with case.sessions.begin() as session:
        app = session.get(App, case.run.app_id)
        assert app is not None
        app.mode = AppMode.WORKFLOW
    now = naive_utc_now()
    row: dict[str, object] = {
        "id": identifier("logstore-source"),
        "tenant_id": case.run.tenant_id,
        "app_id": case.run.app_id,
        "workflow_id": identifier("definition"),
        "created_by": identifier("owner"),
        "created_at": (now - timedelta(seconds=30)).isoformat(),
        "finished_at": (now - timedelta(seconds=10)).isoformat(),
        "status": "succeeded",
        "elapsed_time": 20,
        "inputs": json.dumps({"query": "private input"}),
        "outputs": json.dumps({"result": "private output"}),
        "node_id": "agent-node",
        "node_type": "agent",
        "title": "Agent preview",
        "graph": json.dumps(AGENT_GRAPH),
    }
    apply_config_overrides(
        monkeypatch,
        LOGSTORE_DUAL_WRITE_ENABLED=False,
        API_WORKFLOW_RUN_REPOSITORY=(
            "extensions.logstore.repositories.logstore_api_workflow_run_repository.LogstoreAPIWorkflowRunRepository"
        ),
        API_WORKFLOW_NODE_EXECUTION_REPOSITORY=(
            "extensions.logstore.repositories.logstore_api_workflow_node_execution_repository."
            "LogstoreAPIWorkflowNodeExecutionRepository"
        ),
    )
    monkeypatch.setenv("LOGSTORE_DUAL_READ_ENABLED", "false")
    monkeypatch.setenv("LOGSTORE_PG_MODE_ENABLED", "false")
    monkeypatch.setenv("ALIYUN_SLS_ACCESS_KEY_ID", "test-access-key")
    monkeypatch.setenv("ALIYUN_SLS_ACCESS_KEY_SECRET", "test-secret")
    monkeypatch.setenv("ALIYUN_SLS_ENDPOINT", "https://sls.example.test")
    monkeypatch.setenv("ALIYUN_SLS_REGION", "test-region")
    monkeypatch.setattr(AliyunLogStore, "_instance", None)
    monkeypatch.setattr(AliyunLogStore, "_initialized", False)
    monkeypatch.setattr(AliyunLogStore, "_check_endpoint_connectivity", staticmethod(lambda _endpoint, _timeout: None))
    transactions: set[Connection] = set()

    def begun(connection: Connection) -> None:
        transactions.add(connection)

    def ended(connection: Connection) -> None:
        transactions.discard(connection)

    requests: list[str] = []

    def get_logs(_client: AliyunLogStore, *, query: str, **_kwargs: object) -> list[dict[str, object]]:
        # Exercise real configured repository construction, scoped query generation,
        # and model decoding; replace only the remote transport boundary.
        assert not transactions, "LogStore I/O must not hold a SQL transaction"
        assert f'tenant_id:"{case.run.tenant_id}"' in query
        if kind == "workflow":
            assert f'app_id:"{case.run.app_id}"' in query
        requests.append(query)
        return [dict(row)] if row else []

    monkeypatch.setattr(AliyunLogStore, "get_logs", get_logs)
    event.listen(sqlite_engine, "begin", begun)
    event.listen(sqlite_engine, "commit", ended)
    event.listen(sqlite_engine, "rollback", ended)
    try:
        yield StoredSource(case, kind, row, requests)
    finally:
        event.remove(sqlite_engine, "begin", begun)
        event.remove(sqlite_engine, "commit", ended)
        event.remove(sqlite_engine, "rollback", ended)


def test_status_and_retry_use_logstore_without_sql_source_rows(
    stored: StoredSource, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = stored.start()
    with stored.case.sessions() as session:
        assert session.scalar(select(WorkflowRun)) is None
        assert session.scalar(select(WorkflowNodeExecutionModel)) is None
    with stored.case.sessions.begin() as session:
        current = session.get(ApplicationTraceRun, run.id)
        assert current is not None
        current.state = "failed"
        current.error_code = "provider_export_rejected"
        current.outer_trace = {"persisted": True}
    assert stored.status()["status"] == "failed"
    scheduled: list[str] = []
    service = stored.service()
    monkeypatch.setattr(service, "schedule", scheduled.append)
    stored.requests.clear()
    result = service.retry(
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        source_kind=stored.kind,
        source_id=run.source_id,
        acknowledge_possible_duplicates=False,
    )
    assert result["status"] == "ready"
    assert scheduled == [run.id]
    assert len(stored.requests) == 1


@pytest.mark.parametrize("field", ["id", "tenant_id", "app_id"])
def test_backend_result_must_match_complete_source_owner(stored: StoredSource, field: str) -> None:
    run = stored.start()
    stored.row[field] = identifier("foreign")
    with pytest.raises(TraceCollectionError, match="tracing_source_not_found") as caught:
        stored.service().status(
            tenant_id=run.tenant_id, app_id=run.app_id, source_kind=stored.kind, source_id=run.source_id
        )
    assert caught.value.status == 404
    assert stored.case.repository.get(run.id) is not None


def test_foreign_app_owner_is_rejected_before_logstore_request(stored: StoredSource) -> None:
    stored.start()
    stored.requests.clear()
    with stored.case.sessions.begin() as session:
        app = session.get(App, stored.case.run.app_id)
        assert app is not None
        app.tenant_id = identifier("other-tenant")
    with pytest.raises(TraceCollectionError, match="tracing_source_not_found"):
        stored.status()
    assert stored.requests == []


def test_initialization_failure_uses_configured_source_reader(stored: StoredSource) -> None:
    run = stored.case.repository.record_initialization_failure(
        tenant_id=stored.case.run.tenant_id,
        app_id=stored.case.run.app_id,
        source_kind=stored.kind,
        source_id=str(stored.row["id"]),
    )
    assert run is not None
    assert run.state == "failed"
    assert run.error_code == "tracing_initialization_failed"


def test_existing_snapshot_reentry_does_not_consult_logstore(stored: StoredSource) -> None:
    original = stored.start()
    stored.requests.clear()
    stored.row.clear()
    current = stored.case.repository.start(
        tenant_id=original.tenant_id,
        app_id=original.app_id,
        source_kind=stored.kind,
        source_id=original.source_id,
        session_id="must-not-replace",
    )
    assert current is not None
    assert current.id == original.id
    assert current.session_id == original.session_id
    assert stored.requests == []


@pytest.mark.parametrize("stored", ["workflow"], indirect=True)
def test_workflow_node_deep_link_is_scoped_to_durable_invocation(stored: StoredSource) -> None:
    run = stored.start()
    case = Collection(stored.case.repository, stored.case.sessions, run)
    node_id = identifier("logstore-agent-node")
    invocation = case.repository.invocation(
        run_id=run.id, agent_id=identifier("agent"), node_execution_id=node_id, attempt=0, call_key="node"
    )
    ingest(case, batch_for(run, invocation))
    terminal(case)
    lease = claim(case)
    assert lease is not None
    case.repository.complete(
        run.id,
        lease[1],
        state="accepted",
        result=TraceExportResult("provider-id", span_urls={invocation.span_id: "https://trace.test/span"}),
    )
    assert stored.status(node_id)["span_url"] == "https://trace.test/span"
    with pytest.raises(TraceCollectionError, match="tracing_node_not_found"):
        stored.status(identifier("another-run-node"))


def test_preview_settlement_and_workflow_recovery_use_configured_source(stored: StoredSource) -> None:
    run = stored.start()
    if stored.kind == "workflow":
        task = _workflow_task(stored.case.repository, run, naive_utc_now())
        assert task is not None
        assert task.workflow_run_id == run.source_id
        assert task.kwargs["trace_session_id"] == run.session_id
        stored.row["status"] = "running"
        assert _workflow_task(stored.case.repository, run, naive_utc_now()) is None
    else:
        stored.service().settle_preview(run)
        current = stored.case.repository.get(run.id)
        assert current is not None
        assert current.outer_trace is not None
        root = current.outer_trace["spans"][0]
        assert root["status"] == "ok"
        assert root["inputs"] is None
        assert root["outputs"] is None
        assert root["metadata"]["node_execution_id"] == run.source_id


@pytest.mark.parametrize("stored", ["workflow"], indirect=True)
def test_missing_snapshot_classifies_logstore_agent_workflow_and_persists_failure(stored: StoredSource) -> None:
    info = workflow_info(_dict_to_workflow_run(stored.row))
    assert stored.service().capture_terminal(info) is True
    result = stored.status()
    assert result["status"] == "failed"
    assert result["error_code"] == "tracing_initialization_failed"


@pytest.mark.parametrize("stored", ["workflow"], indirect=True)
@pytest.mark.parametrize("has_agent", [True, False])
def test_unindexed_workflow_uses_owned_definition_for_safe_legacy_decision(
    stored: StoredSource, has_agent: bool
) -> None:
    info = workflow_info(_dict_to_workflow_run(stored.row))
    with stored.case.sessions.begin() as session:
        app = session.get(App, stored.case.run.app_id)
        assert app is not None
        definition = make_workflow(
            workflow_id=str(stored.row["workflow_id"]),
            tenant_id=app.tenant_id,
            app_id=app.id,
            graph=AGENT_GRAPH if has_agent else {"nodes": [{"data": {"type": "llm"}}]},
        )
        app.workflow_id = definition.id
        session.add(definition)
    stored.row.clear()
    assert stored.service().capture_terminal(info) is has_agent


@pytest.mark.parametrize("stored", ["workflow"], indirect=True)
@pytest.mark.parametrize("snapshot", [True, False])
def test_auxiliary_content_is_suppressed_for_logstore_workflow(stored: StoredSource, snapshot: bool) -> None:
    if snapshot:
        stored.start()
    info = ModerationTraceInfo(
        message_id=identifier("workflow-log"),
        metadata={
            "workflow_run_id": stored.row["id"],
            **({} if snapshot else {"app_id": stored.case.run.app_id}),
        },
        flagged=False,
        action="direct_output",
        preset_response="",
        query="private query",
        inputs="private input",
        outputs="private output",
    )
    assert stored.service().capture_terminal(info) is True
    if snapshot:
        # Durable ownership is sufficient to suppress auxiliary payload even when
        # the remote run has not been indexed yet.
        stored.row.clear()
        assert stored.service().capture_terminal(info) is True
    else:
        stored.row["graph"] = json.dumps({"nodes": [{"data": {"type": "llm"}}]})
        assert stored.service().capture_terminal(info) is False


@pytest.mark.parametrize("stored", ["workflow"], indirect=True)
@pytest.mark.parametrize("mismatch", [None, "tenant_id", "app_id"])
def test_linked_parent_requires_logstore_run_and_durable_owner_to_agree(
    stored: StoredSource, mismatch: str | None
) -> None:
    parent = stored.start()
    info = workflow_info(_dict_to_workflow_run(stored.row), _dict_to_workflow_run(stored.row))
    original = dict(info.metadata)
    if mismatch:
        stored.row[mismatch] = identifier("foreign")
    stored.service()._link_managed_parent(info, parent.tenant_id)
    if mismatch:
        assert info.metadata == original
    else:
        assert info.resolved_parent_context == (None, None)
        assert info.metadata["linked_parent_trace_id"] == parent.trace_id
        assert info.metadata["linked_parent_workflow_run_id"] == parent.source_id


@pytest.mark.parametrize("stored", ["workflow"], indirect=True)
def test_auxiliary_durable_owner_rejects_app_reassigned_to_other_tenant(stored: StoredSource) -> None:
    run = stored.start()
    with stored.case.sessions.begin() as session:
        app = session.get(App, run.app_id)
        assert app is not None
        app.tenant_id = identifier("foreign")
    info = ModerationTraceInfo(
        metadata={"workflow_run_id": run.source_id}, query="", flagged=False, action="direct_output", preset_response=""
    )
    assert stored.service().capture_terminal(info) is False


def test_sql_workflow_source_still_uses_scoped_configured_reader(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    case = seed(sqlite_session_factory, "sql-reader")
    row = _dict_to_workflow_run(
        {
            "id": identifier("sql-run"),
            "tenant_id": case.run.tenant_id,
            "app_id": case.run.app_id,
            "workflow_id": identifier("definition"),
            "created_by": identifier("owner"),
        }
    )
    with case.sessions.begin() as session:
        session.add(row)
    source = case.repository._source(
        tenant_id=case.run.tenant_id, app_id=case.run.app_id, kind="workflow", source_id=row.id
    )
    assert isinstance(source, WorkflowRun)
    assert source.id == row.id
    assert (
        case.repository._source(
            tenant_id=identifier("wrong-tenant"), app_id=case.run.app_id, kind="workflow", source_id=row.id
        )
        is None
    )
