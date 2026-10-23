"""Node logs resolve the caller's trace using SQL or configured LogStore ownership."""

import json
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from aliyun.log.logclient import LogClient
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    _dict_to_workflow_node_execution_model,
)
from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceRun
from models.model import App, AppMode
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from repositories.application_trace_repository import TraceCollectionError
from services.tracing.provider_dispatch import TraceExportResult
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.services.tracing.test_application_trace_collection import (
    Collection,
    batch_for,
    claim,
    identifier,
    ingest,
    seed,
    terminal,
)


@dataclass
class NodeAlias:
    case: Collection
    node: dict[str, object]
    workflow: dict[str, object]
    requests: list[str]
    logstore: bool

    def service(self) -> ApplicationTracingService:
        return ApplicationTracingService(self.case.repository)

    def status(self, node_execution_id: str | None = None) -> dict[str, object]:
        return self.service().status(
            tenant_id=self.case.run.tenant_id,
            app_id=self.case.run.app_id,
            source_kind="node",
            source_id=str(self.node["id"]),
            node_execution_id=node_execution_id,
        )

    def accept(self, *, spans: bool = True) -> tuple[str, str]:
        span_urls: dict[str, str] = {}
        for attempt in (0, 1):
            invocation = self.case.repository.invocation(
                run_id=self.case.run.id,
                agent_id=identifier("referenced-agent"),
                node_execution_id=str(self.node["id"]),
                attempt=attempt,
                call_key=f"attempt-{attempt}",
            )
            ingest(self.case, batch_for(self.case.run, invocation, span_id=str(attempt + 1) * 16))
            span_urls[invocation.span_id] = f"https://provider.test/span/{attempt}"
        terminal(self.case)
        lease = claim(self.case)
        assert lease is not None
        self.case.repository.complete(
            self.case.run.id,
            lease[1],
            state="accepted",
            result=TraceExportResult(
                "provider-trace", "https://provider.test/trace", span_urls=span_urls if spans else {}
            ),
        )
        return "https://provider.test/trace", "https://provider.test/span/1"


@pytest.fixture(params=["sql", "logstore"])
def alias(
    request: pytest.FixtureRequest,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[NodeAlias]:
    case = seed(sqlite_session_factory, "node-alias")
    with case.sessions.begin() as session:
        app = session.get(App, case.run.app_id)
        assert app is not None
        app.mode = AppMode.WORKFLOW
    common: dict[str, object] = {
        "tenant_id": case.run.tenant_id,
        "app_id": case.run.app_id,
        "workflow_id": identifier("definition"),
        "created_by": identifier("actor"),
        "created_at": naive_utc_now().isoformat(),
        "status": "succeeded",
    }
    workflow = {**common, "id": identifier("workflow-source"), "graph": json.dumps({"nodes": []})}
    node = {
        **common,
        "id": identifier("node-source"),
        "workflow_run_id": workflow["id"],
        "node_id": "reference-agent",
        "node_type": "agent",
        "title": "Reference Agent",
    }
    requests: list[str] = []
    transactions: set[Connection] = set()

    def begun(connection: Connection) -> None:
        transactions.add(connection)

    def ended(connection: Connection) -> None:
        transactions.discard(connection)

    if request.param == "sql":
        with case.sessions.begin() as session:
            session.add(_dict_to_workflow_run(workflow))
            session.add(_dict_to_workflow_node_execution_model(node))
    else:
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
        for key, value in {
            "LOGSTORE_DUAL_READ_ENABLED": "false",
            "LOGSTORE_PG_MODE_ENABLED": "false",
            "ALIYUN_SLS_ACCESS_KEY_ID": "test-access-key",
            "ALIYUN_SLS_ACCESS_KEY_SECRET": "test-secret",
            "ALIYUN_SLS_ENDPOINT": "https://sls.example.test",
            "ALIYUN_SLS_REGION": "test-region",
        }.items():
            monkeypatch.setenv(key, value)
        monkeypatch.setattr(AliyunLogStore, "_instance", None)
        monkeypatch.setattr(AliyunLogStore, "_initialized", False)
        monkeypatch.setattr(
            AliyunLogStore, "_check_endpoint_connectivity", staticmethod(lambda _endpoint, _timeout: None)
        )

        def reject_http_transport(*_args: object, **_kwargs: object) -> None:
            pytest.fail("Configured LogStore test escaped its isolated transport boundary")

        monkeypatch.setattr(LogClient, "_getHttpResponse", reject_http_transport)

        def get_logs(
            _client: AliyunLogStore, *, query: str, logstore: str, **_kwargs: object
        ) -> list[dict[str, object]]:
            assert not transactions, "Configured source reads must not hold a SQL transaction"
            assert f'tenant_id:"{case.run.tenant_id}"' in query.replace(": ", ":")
            assert logstore in {
                AliyunLogStore.workflow_execution_logstore,
                AliyunLogStore.workflow_node_execution_logstore,
            }
            is_workflow = logstore == AliyunLogStore.workflow_execution_logstore
            if is_workflow:
                assert f'app_id:"{case.run.app_id}"' in query
            requests.append("workflow" if is_workflow else "node")
            row = workflow if is_workflow else node
            return [dict(row)] if row else []

        monkeypatch.setattr(AliyunLogStore, "get_logs", get_logs)

        def execute_sql(
            client: AliyunLogStore, *, sql: str, query: str, logstore: str, **_kwargs: object
        ) -> list[dict[str, object]]:
            # Node lookups use the SQL transport in SDK mode too; the real
            # service still validates the returned node-to-workflow owner chain.
            assert logstore == AliyunLogStore.workflow_node_execution_logstore
            assert f'id:"{identifier("node-source")}"' in query.replace(": ", ":")
            assert f"tenant_id = '{case.run.tenant_id}'" in sql
            assert f"id = '{identifier('node-source')}'" in sql
            assert f'FROM "{logstore}"' in sql
            assert "ORDER BY log_version DESC LIMIT 1" in sql
            return get_logs(client, query=query, logstore=logstore)

        monkeypatch.setattr(AliyunLogStore, "execute_sql", execute_sql)
        with case.sessions() as session:
            assert session.scalar(select(WorkflowRun)) is None
            assert session.scalar(select(WorkflowNodeExecutionModel)) is None
    event.listen(sqlite_engine, "begin", begun)
    event.listen(sqlite_engine, "commit", ended)
    event.listen(sqlite_engine, "rollback", ended)
    try:
        run = case.repository.start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="workflow",
            source_id=str(workflow["id"]),
            session_id="caller-session",
        )
        assert run is not None
        requests.clear()
        yield NodeAlias(
            Collection(case.repository, case.sessions, run), node, workflow, requests, request.param == "logstore"
        )
    finally:
        event.remove(sqlite_engine, "begin", begun)
        event.remove(sqlite_engine, "commit", ended)
        event.remove(sqlite_engine, "rollback", ended)


@pytest.mark.parametrize("spans", [True, False])
def test_alias_returns_parent_trace_and_latest_owned_invocation(alias: NodeAlias, spans: bool) -> None:
    trace_url, span_url = alias.accept(spans=spans)
    status = alias.status()
    assert status["status"] == "accepted"
    assert status["source_kind"] == "node"
    assert status["source_id"] == alias.node["id"]
    assert status["trace_id"] == "provider-trace"
    assert status["trace_url"] == trace_url
    assert status["span_url"] == (span_url if spans else None)
    assert status["config_revision"] == alias.case.run.config_revision
    if alias.logstore:
        assert alias.requests == ["node", "workflow"]


@pytest.mark.parametrize("capture_agent", [True, False])
@pytest.mark.parametrize("accepted", [True, False])
def test_alias_without_internal_invocation_returns_parent_status(
    alias: NodeAlias, capture_agent: bool, accepted: bool
) -> None:
    with alias.case.sessions.begin() as session:
        run = session.get(ApplicationTraceRun, alias.case.run.id)
        assert run is not None
        run.capture_agent = capture_agent
    if accepted:
        terminal(alias.case)
        lease = claim(alias.case)
        assert lease is not None
        alias.case.repository.complete(
            alias.case.run.id,
            lease[1],
            state="accepted",
            result=TraceExportResult("outer-only", "https://provider.test/outer"),
        )
    status = alias.status()
    assert status["status"] == ("accepted" if accepted else "collecting")
    assert status["span_url"] is None
    assert status["capture_agent"] is capture_agent
    assert status["trace_url"] == ("https://provider.test/outer" if accepted else None)


@pytest.mark.parametrize("state", ["collecting", "not_collected"])
def test_standalone_node_snapshot_wins_over_parent(alias: NodeAlias, state: str) -> None:
    alias.accept()
    node_run = alias.case.repository.start(
        tenant_id=alias.case.run.tenant_id,
        app_id=alias.case.run.app_id,
        source_kind="node",
        source_id=str(alias.node["id"]),
        session_id="preview-session",
    )
    assert node_run is not None
    with alias.case.sessions.begin() as session:
        run = session.get(ApplicationTraceRun, node_run.id)
        assert run is not None
        run.state = state
    alias.requests.clear()
    status = alias.status()
    assert status["status"] == state
    assert status.get("trace_url") is None
    if alias.logstore:
        assert alias.requests == ["node"]


def test_explicit_other_node_filter_cannot_select_sibling_span(
    alias: NodeAlias, monkeypatch: pytest.MonkeyPatch
) -> None:
    sibling = alias.case.repository.invocation(
        run_id=alias.case.run.id,
        agent_id=identifier("referenced-agent"),
        node_execution_id=identifier("sibling-node"),
        attempt=0,
        call_key="sibling",
    )
    ingest(alias.case, batch_for(alias.case.run, sibling, span_id="f" * 16))
    alias.accept()
    with pytest.raises(TraceCollectionError, match="tracing_node_not_found") as error:
        alias.status(identifier("sibling-node"))
    assert error.value.status == 404
    service = alias.service()
    scheduled: list[str] = []
    monkeypatch.setattr(service, "schedule", scheduled.append)
    with pytest.raises(TraceCollectionError, match="tracing_node_not_found"):
        service.retry(
            tenant_id=alias.case.run.tenant_id,
            app_id=alias.case.run.app_id,
            source_kind="node",
            source_id=str(alias.node["id"]),
            node_execution_id=identifier("sibling-node"),
            acknowledge_possible_duplicates=True,
        )
    assert not scheduled


@pytest.mark.parametrize("state", ["failed", "uncertain", "accepted"])
def test_alias_retry_uses_parent_guards_and_resolves_sources_once(
    alias: NodeAlias, state: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    alias.accept()
    with alias.case.sessions.begin() as session:
        run = session.get(ApplicationTraceRun, alias.case.run.id)
        assert run is not None
        run.state = state
    service = alias.service()
    scheduled: list[str] = []
    monkeypatch.setattr(service, "schedule", scheduled.append)

    def retry(acknowledge: bool) -> dict[str, object]:
        alias.requests.clear()
        return service.retry(
            tenant_id=alias.case.run.tenant_id,
            app_id=alias.case.run.app_id,
            source_kind="node",
            source_id=str(alias.node["id"]),
            acknowledge_possible_duplicates=acknowledge,
        )

    if state == "accepted":
        with pytest.raises(TraceCollectionError, match="tracing_already_accepted") as error:
            retry(True)
        assert error.value.status == 409
        assert not scheduled
    else:
        if state == "uncertain":
            with pytest.raises(TraceCollectionError, match="tracing_duplicate_acknowledgement_required"):
                retry(False)
            assert not scheduled
        assert retry(state == "uncertain")["status"] == "ready"
        assert scheduled == [alias.case.run.id]
    if alias.logstore:
        assert alias.requests == ["node", "workflow"]


@pytest.mark.parametrize("source", ["node", "workflow"])
@pytest.mark.parametrize("field", ["tenant_id", "app_id", "workflow_id"])
def test_alias_rejects_broken_owner_chain(alias: NodeAlias, source: str, field: str) -> None:
    alias.accept()
    row = alias.node if source == "node" else alias.workflow
    if alias.logstore:
        row[field] = identifier("foreign")
    else:
        with alias.case.sessions.begin() as session:
            model = session.get(WorkflowNodeExecutionModel if source == "node" else WorkflowRun, str(row["id"]))
            assert model is not None
            # Keep field assignments explicit so ownership failures are visible.
            if field == "tenant_id":
                model.tenant_id = identifier("foreign")
            elif field == "app_id":
                model.app_id = identifier("foreign")
            else:
                model.workflow_id = identifier("foreign")
    with pytest.raises(TraceCollectionError, match="tracing_source_not_found") as error:
        alias.status()
    assert error.value.status == 404


def test_alias_missing_parent_business_source_is_not_a_durable_owner_bypass(alias: NodeAlias) -> None:
    if alias.logstore:
        alias.workflow.clear()
    else:
        with alias.case.sessions.begin() as session:
            parent = session.get(WorkflowRun, str(alias.workflow["id"]))
            assert parent is not None
            session.delete(parent)
    with pytest.raises(TraceCollectionError, match="tracing_source_not_found"):
        alias.status()


def test_owned_alias_without_parent_trace_is_not_collected(alias: NodeAlias) -> None:
    with alias.case.sessions.begin() as session:
        run = session.get(ApplicationTraceRun, alias.case.run.id)
        assert run is not None
        session.delete(run)
    assert alias.status() == {"status": "not_collected", "source_kind": "node", "source_id": alias.node["id"]}
