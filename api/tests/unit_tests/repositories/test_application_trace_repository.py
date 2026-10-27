import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pytest
from aliyun.log.logclient import LogClient
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceSpan
from dify_trace_sdk.events import WorkflowRunCompleted
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.provider import SendResult
from dify_trace_sdk.testing import RecordingEgress
from sqlalchemy import Connection, Engine, delete, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.enums import ConversationFromSource
from models.model import App, AppMode, Message, TraceAppConfig
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from repositories import application_trace_repository as repository_module
from repositories.application_trace_repository import ApplicationTraceRepository
from repositories.trace_record_repository import TraceRecordRepository
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.collection import TraceInvocation, TraceRun, TraceRunState, TraceRunStatus
from services.tracing.errors import (
    TraceCollectionConflictError,
    TraceCollectionError,
    TraceCollectionNotFoundError,
    TracingStoreUnavailableError,
)
from services.tracing.providers import ProviderConfigCodec
from services.tracing.records import ModerationTraceInfo, TraceMessage, WorkflowTraceInfo
from services.tracing.recovery import _workflow_event
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_app, make_message, make_workflow
from tests.helpers.unit.services.tracing_ports import (
    AGENT_TRACE_SETTINGS,
    InstalledTraceProviders,
    WorkspaceBoundCipher,
)

"""Seeded Agent trace collections, shared with the ingestion handler and worker task tests."""

AGENT_GRAPH = {
    "nodes": [{"id": "agent", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}],
    "edges": list[object](),
}


def identifier(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


@dataclass
class Collection:
    repository: ApplicationTraceRepository
    sessions: sessionmaker[Session]
    run: TraceRun

    def invocation(self) -> TraceInvocation:
        return self.repository.invocation(
            run_id=self.run.id, agent_id=identifier("agent"), node_execution_id=None, attempt=0, call_key="first"
        )


def seed(sessions: sessionmaker[Session], name: str) -> Collection:
    """Start collecting an Agent app message whose run freezes a Langfuse destination.

    The frozen secrets decrypt with ``WorkspaceBoundCipher`` in the seeded workspace.
    """
    app_id, tenant_id, message_id = identifier(f"app-{name}"), identifier("tenant"), identifier(f"message-{name}")
    cipher = WorkspaceBoundCipher()
    with sessions.begin() as session:
        session.add(
            make_app(
                app_id=app_id,
                tenant_id=tenant_id,
                mode=AppMode.AGENT,
                tracing=json.dumps(
                    {"enabled": True, "tracing_provider": "langfuse", "capture_content": False, "capture_agent": True}
                ),
            )
        )
        session.add(
            make_message(
                message_id=message_id,
                app_id=app_id,
                conversation_id=identifier(f"conversation-{name}"),
                inputs={},
                query="hello",
                message={},
                answer="done",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
            )
        )
        session.add(
            TraceAppConfig(
                app_id=app_id,
                tracing_provider="langfuse",
                tracing_config={
                    "public_key": cipher.encrypt(tenant_id, "public"),
                    "secret_key": cipher.encrypt(tenant_id, "original"),
                    "host": "https://langfuse.test",
                    "project_key": "original",
                },
            )
        )
    repository = ApplicationTraceRepository(sessions)
    run = repository.start(
        tenant_id=tenant_id,
        app_id=app_id,
        source_kind="message",
        source_id=message_id,
        session_id="session-original",
        workflow_id=None,
    )
    assert run is not None
    return Collection(repository, sessions, run)


def batch_for(run: TraceRun, invocation: TraceInvocation) -> AgentTraceBatch:
    return AgentTraceBatch(
        run_id=UUID(run.id),
        invocation_id=UUID(invocation.id),
        batch_id=uuid4(),
        final=True,
        spans=[
            AgentTraceSpan(
                trace_id=run.trace_id,
                span_id="a" * 16,
                parent_span_id=invocation.span_id,
                name="Agent execution",
                start_time_ns=1_000_000_000,
                end_time_ns=2_000_000_000,
                status="ok",
                attributes={"gen_ai.operation.name": "invoke_agent"},
            )
        ],
    )


def ingest(collection: Collection, batch: AgentTraceBatch) -> tuple[int, str]:
    return collection.repository.ingest(batch, max_spans=100, max_bytes=1_000_000)


def terminal(collection: Collection) -> None:
    run = collection.run
    root = Span(
        span_id=run.root_span_id,
        parent_span_id=None,
        name="Agent turn",
        kind=SpanKind.CHAIN,
        start_time=datetime.fromtimestamp(0, UTC),
        end_time=datetime.fromtimestamp(3, UTC),
        status=SpanStatus.OK,
    )
    trace = Trace(
        trace_id=run.trace_id,
        external_trace_id=None,
        session_id=run.session_id,
        user_id=None,
        parent=None,
        spans=(root,),
    )
    collection.repository.terminal(run.id, trace.model_dump(mode="json"), root.span_id)


def claim(collection: Collection) -> tuple[TraceRun, str] | None:
    return collection.repository.claim(collection.run.id, collection_timeout=60, lease_seconds=30)


def workflow_info(row: WorkflowRun, parent: WorkflowRun | None) -> WorkflowTraceInfo:
    assert row.finished_at is not None
    metadata: dict[str, object] = {"app_id": row.app_id}
    if parent is not None:
        metadata["parent_trace_context"] = {
            "parent_workflow_run_id": parent.id,
            "parent_node_execution_id": identifier("parent-tool-node"),
        }
    return WorkflowTraceInfo(
        node_executions=[],
        conversation_id=None,
        message_started_at=None,
        workflow_app_log_id=None,
        workflow_id=row.workflow_id,
        tenant_id=row.tenant_id,
        workflow_run_id=row.id,
        workflow_run_elapsed_time=2,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1",
        error=None,
        total_tokens=0,
        prompt_tokens=None,
        completion_tokens=None,
        file_list=[],
        invoked_by=None,
        query="",
        metadata=metadata,
        start_time=row.created_at,
        end_time=row.finished_at,
    )


"""Configured LogStore readers work without SQL mirrors and retain source ownership."""


@dataclass
class StoredSource:
    case: Collection
    kind: Literal["workflow", "node"]
    row: dict[str, object]
    requests: list[str]
    scheduled: list[str]

    def start(self) -> TraceRun:
        run = self.case.repository.start(
            tenant_id=self.case.run.tenant_id,
            app_id=self.case.run.app_id,
            source_kind=self.kind,
            source_id=str(self.row["id"]),
            session_id="logstore-session",
            workflow_id=None,
        )
        assert run is not None
        return run

    def service(self) -> ApplicationTracingService:
        return ApplicationTracingService(
            traces=self.case.repository,
            records=TraceRecordRepository(self.case.sessions, files_url="https://files.test", enterprise_details=False),
            builder=CanonicalTraceBuilder(),
            # No provider is installed, so a delivery stops before it reaches any destination.
            providers=InstalledTraceProviders(),
            codec=ProviderConfigCodec(WorkspaceBoundCipher()),
            egress=RecordingEgress([], grpc_target=None),
            schedule_export=self.scheduled.append,
            settings=AGENT_TRACE_SETTINGS,
        )

    def status(self, *, node_execution_id: str | None) -> TraceRunStatus:
        return self.service().status(
            tenant_id=self.case.run.tenant_id,
            app_id=self.case.run.app_id,
            source_kind=self.kind,
            source_id=str(self.row["id"]),
            node_execution_id=node_execution_id,
        )


class TestApplicationTraceLogstoreCases:
    @staticmethod
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
        monkeypatch.setattr(
            AliyunLogStore, "_check_endpoint_connectivity", staticmethod(lambda _endpoint, _timeout: None)
        )

        def reject_http_transport(*_args: object, **_kwargs: object) -> None:
            pytest.fail("Configured LogStore test escaped its isolated transport boundary")

        monkeypatch.setattr(LogClient, "_getHttpResponse", reject_http_transport)
        transactions: set[Connection] = set()

        def begun(connection: Connection) -> None:
            transactions.add(connection)

        def ended(connection: Connection) -> None:
            transactions.discard(connection)

        requests: list[str] = []

        def get_logs(
            _client: AliyunLogStore, *, query: str, logstore: str, **_kwargs: object
        ) -> list[dict[str, object]]:
            # Exercise real configured repository construction, scoped query generation,
            # and model decoding; replace only the remote transport boundary.
            assert not transactions, "LogStore I/O must not hold a SQL transaction"
            assert f'tenant_id:"{case.run.tenant_id}"' in query.replace(": ", ":")
            assert logstore == (
                AliyunLogStore.workflow_execution_logstore
                if kind == "workflow"
                else AliyunLogStore.workflow_node_execution_logstore
            )
            if kind == "workflow":
                assert f'app_id:"{case.run.app_id}"' in query
            requests.append(query)
            return [dict(row)] if row else []

        monkeypatch.setattr(AliyunLogStore, "get_logs", get_logs)

        def execute_sql(
            client: AliyunLogStore, *, sql: str, query: str, logstore: str, **_kwargs: object
        ) -> list[dict[str, object]]:
            # The node reader now uses SQL in both SDK and PG modes. Preserve the
            # real repository's query/decoding path while isolating this transport.
            assert kind == "node"
            assert f'id:"{identifier("logstore-source")}"' in query.replace(": ", ":")
            assert f"tenant_id = '{case.run.tenant_id}'" in sql
            assert f"id = '{identifier('logstore-source')}'" in sql
            assert f'FROM "{logstore}"' in sql
            assert "ORDER BY log_version DESC LIMIT 1" in sql
            return get_logs(client, query=query, logstore=logstore)

        monkeypatch.setattr(AliyunLogStore, "execute_sql", execute_sql)
        event.listen(sqlite_engine, "begin", begun)
        event.listen(sqlite_engine, "commit", ended)
        event.listen(sqlite_engine, "rollback", ended)
        try:
            yield StoredSource(case, kind, row, requests, scheduled=[])
        finally:
            event.remove(sqlite_engine, "begin", begun)
            event.remove(sqlite_engine, "commit", ended)
            event.remove(sqlite_engine, "rollback", ended)

    @staticmethod
    def test_status_and_retry_use_logstore_without_sql_source_rows(stored: StoredSource) -> None:
        run = stored.start()
        with stored.case.sessions() as session:
            assert session.scalar(select(WorkflowRun)) is None
            assert session.scalar(select(WorkflowNodeExecutionModel)) is None
        with stored.case.sessions.begin() as session:
            current = session.get(ApplicationTraceRun, run.id)
            assert current is not None
            current.state = TraceRunState.FAILED
            current.error_code = "provider_export_rejected"
            current.outer_trace = {"persisted": True}
        assert stored.status(node_execution_id=None).status is TraceRunState.FAILED
        stored.requests.clear()
        result = stored.service().retry(
            tenant_id=run.tenant_id,
            app_id=run.app_id,
            source_kind=stored.kind,
            source_id=run.source_id,
            acknowledge_possible_duplicates=False,
            node_execution_id=None,
        )
        assert result.status is TraceRunState.READY
        assert stored.scheduled == [run.id]
        assert len(stored.requests) == 1

    @staticmethod
    @pytest.mark.parametrize("field", ["id", "tenant_id", "app_id"])
    def test_backend_result_must_match_complete_source_owner(stored: StoredSource, field: str) -> None:
        run = stored.start()
        stored.row[field] = identifier("foreign")
        with pytest.raises(TraceCollectionNotFoundError, match="tracing_source_not_found"):
            stored.service().status(
                tenant_id=run.tenant_id,
                app_id=run.app_id,
                source_kind=stored.kind,
                source_id=run.source_id,
                node_execution_id=None,
            )
        assert stored.case.repository.get(run.id) is not None

    @staticmethod
    def test_foreign_app_owner_is_rejected_before_logstore_request(stored: StoredSource) -> None:
        stored.start()
        stored.requests.clear()
        with stored.case.sessions.begin() as session:
            app = session.get(App, stored.case.run.app_id)
            assert app is not None
            app.tenant_id = identifier("other-tenant")
        with pytest.raises(TraceCollectionNotFoundError, match="tracing_source_not_found"):
            stored.status(node_execution_id=None)
        assert stored.requests == []

    @staticmethod
    def test_initialization_failure_uses_configured_source_reader(stored: StoredSource) -> None:
        run = stored.case.repository.record_initialization_failure(
            tenant_id=stored.case.run.tenant_id,
            app_id=stored.case.run.app_id,
            source_kind=stored.kind,
            source_id=str(stored.row["id"]),
        )
        assert run is not None
        assert run.state is TraceRunState.FAILED
        assert run.error_code == "tracing_initialization_failed"

    @staticmethod
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
            workflow_id=None,
        )
        assert current is not None
        assert current.id == original.id
        assert current.session_id == original.session_id
        assert stored.requests == []

    @staticmethod
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
            state=TraceRunState.ACCEPTED,
            error_code=None,
            result=SendResult(
                trace_id="provider-id", trace_url=None, span_urls={invocation.span_id: "https://trace.test/span"}
            ),
            retry_delay=None,
        )
        assert stored.status(node_execution_id=node_id).span_url == "https://trace.test/span"
        with pytest.raises(TraceCollectionNotFoundError, match="tracing_node_not_found"):
            stored.status(node_execution_id=identifier("another-run-node"))

    @staticmethod
    def test_preview_settlement_and_workflow_recovery_use_configured_source(stored: StoredSource) -> None:
        run = stored.start()
        if stored.kind == "workflow":
            event = _workflow_event(stored.case.repository, run, naive_utc_now())
            assert event is not None
            assert event.payload == WorkflowRunCompleted(
                workflow_run_id=run.source_id, conversation_id=None, total_tokens=None
            )
            assert (event.tenant_id, event.app_id) == (run.tenant_id, run.app_id)
            assert event.user_id == stored.row["created_by"]
            assert event.correlation.session_id == run.session_id
            stored.row["status"] = "running"
            assert _workflow_event(stored.case.repository, run, naive_utc_now()) is None
        else:
            # Delivery settles a finished preview from its node execution before claiming the export.
            stored.service().deliver(run.id)
            current = stored.case.repository.get(run.id)
            assert current is not None
            assert current.outer_trace is not None
            root = current.outer_trace["spans"][0]
            assert root["status"] == "ok"
            assert root["inputs"] is None
            assert root["outputs"] is None
            assert root["attributes"]["node_execution_id"] == run.source_id

    @staticmethod
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    def test_missing_snapshot_classifies_logstore_agent_workflow_and_persists_failure(stored: StoredSource) -> None:
        info = workflow_info(_dict_to_workflow_run(stored.row), None)
        assert stored.service().capture_terminal(tenant_id=stored.case.run.tenant_id, info=info) is True
        result = stored.status(node_execution_id=None)
        assert result.status is TraceRunState.FAILED
        assert result.error_code == "tracing_initialization_failed"

    @staticmethod
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    @pytest.mark.parametrize("has_agent", [True, False])
    def test_unindexed_workflow_uses_owned_definition_for_safe_legacy_decision(
        stored: StoredSource, has_agent: bool
    ) -> None:
        info = workflow_info(_dict_to_workflow_run(stored.row), None)
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
        assert stored.service().capture_terminal(tenant_id=stored.case.run.tenant_id, info=info) is has_agent

    @staticmethod
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    @pytest.mark.parametrize("snapshot", [True, False])
    def test_auxiliary_content_is_suppressed_for_logstore_chatflow(stored: StoredSource, snapshot: bool) -> None:
        with stored.case.sessions.begin() as session:
            app = session.get(App, stored.case.run.app_id)
            message = session.get(Message, stored.case.run.source_id)
            assert app is not None
            assert message is not None
            app.mode = AppMode.ADVANCED_CHAT
            message.workflow_run_id = str(stored.row["id"])
            session.execute(delete(ApplicationTraceRun).where(ApplicationTraceRun.id == stored.case.run.id))
        if snapshot:
            stored.start()
        info = ModerationTraceInfo(
            message_id=identifier("workflow-log"),
            message_data=TraceMessage(
                id=message.id,
                app_id=message.app_id,
                conversation_id=message.conversation_id,
                workflow_run_id=message.workflow_run_id,
                query=message.query,
                answer=message.answer,
                error=message.error,
                created_at=message.created_at,
                model_provider=message.model_provider,
                model_id=message.model_id,
                total_price=message.total_price,
                currency=message.currency,
            ),
            metadata={"message_id": message.id},
            flagged=False,
            action="direct_output",
            preset_response="",
            query="private query",
            inputs="private input",
            outputs="private output",
        )
        tenant_id = stored.case.run.tenant_id
        assert stored.service().capture_terminal(tenant_id=tenant_id, info=info) is True
        if snapshot:
            # Durable ownership is sufficient to suppress auxiliary payload even when
            # the remote run has not been indexed yet.
            stored.row.clear()
            assert stored.service().capture_terminal(tenant_id=tenant_id, info=info) is True
        else:
            stored.row["graph"] = json.dumps({"nodes": [{"data": {"type": "llm"}}]})
            assert stored.service().capture_terminal(tenant_id=tenant_id, info=info) is False

    @staticmethod
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    @pytest.mark.parametrize("mismatch", [None, "tenant_id", "app_id"])
    def test_linked_parent_requires_logstore_run_and_durable_owner_to_agree(
        stored: StoredSource, mismatch: str | None
    ) -> None:
        parent = stored.start()
        info = workflow_info(_dict_to_workflow_run(stored.row), _dict_to_workflow_run(stored.row))
        if mismatch:
            stored.row[mismatch] = identifier("foreign")
        linked = stored.service().link_managed_parent(tenant_id=stored.case.run.tenant_id, info=info)
        if mismatch:
            assert linked is info
        else:
            assert linked.resolved_parent_context == (None, None)
            assert linked.metadata["linked_parent_trace_id"] == parent.trace_id
            assert linked.metadata["linked_parent_workflow_run_id"] == parent.source_id

    @staticmethod
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
        source = case.repository.workflow_run(
            tenant_id=case.run.tenant_id, app_id=case.run.app_id, workflow_run_id=row.id
        )
        assert source is not None
        assert (source.id, source.workflow_id, source.created_by) == (row.id, row.workflow_id, row.created_by)
        assert (
            case.repository.workflow_run(
                tenant_id=identifier("wrong-tenant"), app_id=case.run.app_id, workflow_run_id=row.id
            )
            is None
        )


"""Persistence boundaries that must fail closed or remain immutable across retries."""


def race_before_insert(monkeypatch: pytest.MonkeyPatch, competitor: Callable[[], None]) -> None:
    """Run ``competitor`` after the caller's existence check, when it allocates its new run's identifiers."""
    raced: list[bool] = []

    def allocate() -> UUID:
        if not raced:
            raced.append(True)
            competitor()
        return uuidv7()

    monkeypatch.setattr(repository_module, "uuidv7", allocate)


def drop_run(case: Collection) -> None:
    with case.sessions.begin() as session:
        session.execute(delete(ApplicationTraceRun).where(ApplicationTraceRun.id == case.run.id))


def run_count(case: Collection) -> int | None:
    with case.sessions() as session:
        return session.scalar(
            select(func.count())
            .select_from(ApplicationTraceRun)
            .where(ApplicationTraceRun.source_id == case.run.source_id)
        )


def start_message(case: Collection, session_id: str) -> TraceRun | None:
    return case.repository.start(
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        source_kind="message",
        source_id=case.run.source_id,
        session_id=session_id,
        workflow_id=None,
    )


class TestApplicationTraceRepositoryBoundariesCases:
    @staticmethod
    def test_concurrent_start_returns_the_first_frozen_snapshot(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        case = seed(sqlite_session_factory, "concurrent-start")
        drop_run(case)
        winners: list[TraceRun | None] = []
        race_before_insert(monkeypatch, lambda: winners.append(start_message(case, "first-session")))
        current = start_message(case, "second-session")
        assert current is not None
        assert winners[0] is not None
        assert current.id == winners[0].id
        assert current.session_id == "first-session"
        assert current.state is TraceRunState.COLLECTING
        assert run_count(case) == 1

    @staticmethod
    def test_initialization_failure_yields_to_a_concurrently_frozen_start(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        case = seed(sqlite_session_factory, "concurrent-failure")
        drop_run(case)
        winners: list[TraceRun | None] = []
        race_before_insert(monkeypatch, lambda: winners.append(start_message(case, "started-session")))
        current = case.repository.record_initialization_failure(
            tenant_id=case.run.tenant_id, app_id=case.run.app_id, source_kind="message", source_id=case.run.source_id
        )
        assert current is not None
        assert winners[0] is not None
        assert current.id == winners[0].id
        assert current.state is TraceRunState.COLLECTING
        assert current.error_code is None
        assert current.provider_config == case.run.provider_config
        assert run_count(case) == 1

    @staticmethod
    def test_identifier_collision_is_not_mistaken_for_a_concurrent_start(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        case = seed(sqlite_session_factory, "colliding-start")
        other = seed(sqlite_session_factory, "colliding-owner")
        drop_run(case)
        monkeypatch.setattr(repository_module, "uuidv7", lambda: UUID(other.run.id))
        with pytest.raises(TracingStoreUnavailableError) as caught:
            start_message(case, "colliding-session")
        assert isinstance(caught.value.__cause__, IntegrityError)
        assert run_count(case) == 0
        assert case.repository.get(other.run.id) is not None

    @staticmethod
    @pytest.mark.parametrize("policy", ["invalid-json", "null", "[]"])
    def test_malformed_policy_freezes_disabled_decision(
        sqlite_session_factory: sessionmaker[Session], policy: str
    ) -> None:
        case = seed(sqlite_session_factory, "malformed")
        with case.sessions.begin() as session:
            session.execute(delete(ApplicationTraceRun).where(ApplicationTraceRun.id == case.run.id))
            app = session.get(App, case.run.app_id)
            assert app is not None
            app.tracing = policy
        run = case.repository.start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="message",
            source_id=case.run.source_id,
            session_id="",
            workflow_id=None,
        )
        assert run is not None
        assert run.state is TraceRunState.NOT_COLLECTED
        assert run.provider_config == {}
        assert run.session_id == case.run.source_id
        assert not run.capture_content
        assert not run.capture_agent

    @staticmethod
    def test_reserved_preview_requires_persisted_owner_workflow(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = seed(sqlite_session_factory, "missing-preview-owner")
        assert (
            case.repository.start(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                source_kind="node",
                source_id=identifier("preview"),
                session_id="preview",
                workflow_id=identifier("missing-workflow"),
            )
            is None
        )

    @staticmethod
    def test_initialization_failure_cannot_replace_snapshot_or_create_foreign_row(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "failure-snapshot")
        same = case.repository.record_initialization_failure(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="message",
            source_id=case.run.source_id,
        )
        assert same is not None
        assert same.id == case.run.id
        assert same.state is TraceRunState.COLLECTING
        assert same.provider_config == case.run.provider_config
        assert (
            case.repository.record_initialization_failure(
                tenant_id=identifier("foreign-tenant"),
                app_id=case.run.app_id,
                source_kind="message",
                source_id=case.run.source_id,
            )
            is None
        )

    @staticmethod
    @pytest.mark.parametrize("target", ["missing_run", "revoked_owner", "closed_invocation"])
    def test_ingestion_rejects_missing_or_closed_owner_without_writing(
        sqlite_session_factory: sessionmaker[Session], target: str
    ) -> None:
        case = seed(sqlite_session_factory, "ingestion-owner")
        invocation = case.invocation()
        batch = batch_for(case.run, invocation)
        error: type[TraceCollectionError]
        if target == "missing_run":
            batch = batch.model_copy(update={"run_id": UUID(identifier("missing-run"))})
            error, code = TraceCollectionNotFoundError, "tracing_run_not_found"
        elif target == "revoked_owner":
            with case.sessions.begin() as session:
                app = session.get(App, case.run.app_id)
                assert app is not None
                app.tenant_id = identifier("another-tenant")
            error, code = TraceCollectionNotFoundError, "tracing_owner_not_found"
        else:
            with case.sessions.begin() as session:
                stored = session.get(ApplicationTraceInvocation, invocation.id)
                assert stored is not None
                stored.finalized = True
            error, code = TraceCollectionConflictError, "tracing_collection_closed"
        with pytest.raises(error, match=code):
            ingest(case, batch)
        with case.sessions() as session:
            assert session.scalar(select(func.count()).select_from(ApplicationTraceBatch)) == 0
        stored_run = case.repository.get(case.run.id)
        assert stored_run is not None
        assert stored_run.span_count == 0

    @staticmethod
    def test_first_terminal_is_immutable_and_revoked_owner_is_never_exported(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "terminal-owner")
        terminal(case)
        before = case.repository.get(case.run.id)
        assert before is not None
        case.repository.terminal(case.run.id, {"replacement": True}, "f" * 16)
        after = case.repository.get(case.run.id)
        assert after is not None
        assert after.outer_trace == before.outer_trace
        assert after.root_span_id == before.root_span_id
        with case.sessions.begin() as session:
            app = session.get(App, case.run.app_id)
            assert app is not None
            app.tenant_id = identifier("moved-owner")
        assert claim(case) is None
        failed = case.repository.get(case.run.id)
        assert failed is not None
        assert failed.error_code == "tracing_owner_not_found"
        assert failed.state is TraceRunState.FAILED
        case.repository.terminal(case.run.id, {"replacement": True}, "f" * 16)
        frozen = case.repository.get(case.run.id)
        assert frozen is not None
        assert frozen.outer_trace == before.outer_trace

    @staticmethod
    @pytest.mark.parametrize(
        ("state", "error", "code"),
        [
            (TraceRunState.NOT_COLLECTED, TraceCollectionNotFoundError, "tracing_run_not_found"),
            (TraceRunState.ACCEPTED, TraceCollectionConflictError, "tracing_already_accepted"),
            (TraceRunState.COLLECTING, TraceCollectionConflictError, "tracing_retry_not_allowed"),
        ],
    )
    def test_retry_rejects_ineligible_states(
        sqlite_session_factory: sessionmaker[Session],
        state: TraceRunState,
        error: type[TraceCollectionError],
        code: str,
    ) -> None:
        case = seed(sqlite_session_factory, "retry-state")
        terminal(case)
        with case.sessions.begin() as session:
            row = session.get(ApplicationTraceRun, case.run.id)
            assert row is not None
            row.state = state
        with pytest.raises(error, match=code):
            case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)
        current = case.repository.get(case.run.id)
        assert current is not None
        assert current.state is state

    @staticmethod
    def test_retry_unknown_run_and_invocation_reject_before_creation(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "retry-unknown")
        with pytest.raises(TraceCollectionNotFoundError, match="tracing_run_not_found"):
            case.repository.retry(run_id=identifier("missing"), acknowledge_possible_duplicates=True)
        with pytest.raises(TraceCollectionConflictError, match="tracing_run_not_collecting"):
            case.repository.invocation(
                run_id=identifier("missing"),
                agent_id=identifier("agent"),
                node_execution_id=None,
                attempt=0,
                call_key="x",
            )
        assert case.repository.claim(identifier("missing"), collection_timeout=1, lease_seconds=1) is None

    @staticmethod
    def test_collection_without_terminal_is_not_exportable(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = seed(sqlite_session_factory, "no-terminal")
        ingest(case, batch_for(case.run, case.invocation()))
        assert claim(case) is None
        row = case.repository.get(case.run.id)
        assert row is not None
        assert row.attempts == 0
        assert row.state is TraceRunState.COLLECTING

    @staticmethod
    def test_retention_removes_all_payload_rows_and_preserves_newer_runs(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        expired = seed(sqlite_session_factory, "expired")
        fresh = seed(sqlite_session_factory, "fresh")
        for case in (expired, fresh):
            ingest(case, batch_for(case.run, case.invocation()))
        with expired.sessions.begin() as session:
            row = session.get(ApplicationTraceRun, expired.run.id)
            assert row is not None
            row.created_at = naive_utc_now() - timedelta(days=8)
        assert expired.repository.purge(retention_days=7, limit=100) == 1
        assert expired.repository.get(expired.run.id) is None
        assert expired.repository.collected(expired.run.id) == ([], [])
        assert fresh.repository.get(fresh.run.id) is not None
        invocations, batches = fresh.repository.collected(fresh.run.id)
        assert len(invocations) == len(batches) == 1
        assert expired.repository.purge(retention_days=7, limit=100) == 0
