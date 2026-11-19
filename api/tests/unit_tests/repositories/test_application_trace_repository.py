import json
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal, override
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pytest
from aliyun.log.logclient import LogClient
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceSpan
from dify_trace_sdk.events import TraceEvent, WorkflowRunCompleted
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.testing import RecordingEgress
from sqlalchemy import Connection, Engine, delete, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from domain.tracing.errors import TraceRunConflictError
from domain.tracing.trace_run_agg import TraceBatch, TraceInvocation, TraceRunAgg, TraceRunState
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    _dict_to_workflow_node_execution_model,
)
from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.enums import ConversationFromSource
from models.model import App, AppMode, Message, TraceAppConfig
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from repositories.application_trace_repository import ApplicationTraceRepository
from repositories.factory import DifyAPIRepositoryFactory
from repositories.trace_record_repository import TraceRecordRepository
from services.tracing import service as service_module
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.collection import AppTracingSnapshot, TraceRun, TraceRunStatus
from services.tracing.collection_ports import LockedTraceRun
from services.tracing.delivery import TraceRecordSource
from services.tracing.errors import (
    TraceCollectionConflictError,
    TraceCollectionError,
    TraceCollectionNotFoundError,
    TracingStoreUnavailableError,
)
from services.tracing.providers import ProviderConfigCodec
from services.tracing.records import (
    BaseTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    TraceMessage,
    WorkflowTraceInfo,
)
from services.tracing.recovery import recover_terminal
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_app, make_conversation, make_message, make_workflow
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
LANGFUSE_POLICY = {"enabled": True, "tracing_provider": "langfuse", "capture_content": False, "capture_agent": True}
"""The tracing policy every seeded app stores."""


def identifier(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def trace_records(sessions: sessionmaker[Session]) -> TraceRecordRepository:
    return TraceRecordRepository(
        sessions,
        workflow_runs=DifyAPIRepositoryFactory.create_api_workflow_run_repository(sessions),
        node_executions=DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(sessions),
        files_url="https://files.test",
        enterprise_details=False,
    )


def collector(
    repository: ApplicationTraceRepository, records: TraceRecordSource, scheduled: list[str]
) -> ApplicationTracingService:
    """Agent trace collection over ``repository`` that schedules exports into ``scheduled``.

    No provider is installed, so a delivery stops before it reaches any destination.
    """
    return ApplicationTracingService(
        runs=repository,
        run_query=repository,
        sources=repository,
        records=records,
        builder=CanonicalTraceBuilder(),
        providers=InstalledTraceProviders(),
        codec=ProviderConfigCodec(WorkspaceBoundCipher()),
        egress=RecordingEgress([], grpc_target=None),
        schedule_export=scheduled.append,
        settings=AGENT_TRACE_SETTINGS,
    )


@dataclass
class Collection:
    repository: ApplicationTraceRepository
    sessions: sessionmaker[Session]
    run: TraceRun
    scheduled: list[str]
    """The runs this collection's service scheduled for export."""

    def service(self) -> ApplicationTracingService:
        return collector(self.repository, trace_records(self.sessions), self.scheduled)

    def invocation(self) -> TraceInvocation:
        return open_invocation(self, node_execution_id=None, call_key="first")


def seed(sessions: sessionmaker[Session], name: str) -> Collection:
    """Start collecting an Agent app message whose run freezes a Langfuse destination.

    The frozen secrets decrypt with ``WorkspaceBoundCipher`` in the seeded workspace.
    """
    app_id, tenant_id, message_id = identifier(f"app-{name}"), identifier("tenant"), identifier(f"message-{name}")
    cipher = WorkspaceBoundCipher()
    with sessions.begin() as session:
        session.add(
            make_app(app_id=app_id, tenant_id=tenant_id, mode=AppMode.AGENT, tracing=json.dumps(LANGFUSE_POLICY))
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
    scheduled: list[str] = []
    run = collector(repository, trace_records(sessions), scheduled).start(
        tenant_id=tenant_id,
        app_id=app_id,
        source_kind="message",
        source_id=message_id,
        session_id="session-original",
        workflow_id=None,
    )
    assert run is not None
    return Collection(repository, sessions, run, scheduled)


def open_invocation(collection: Collection, *, node_execution_id: str | None, call_key: str) -> TraceInvocation:
    with collection.repository.change(collection.run.id, tenant_id=collection.run.tenant_id) as locked:
        assert locked is not None
        return locked.run.open_invocation(
            agent_id=identifier("agent"), node_execution_id=node_execution_id, attempt=0, call_key=call_key
        )


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


def ingest(collection: Collection, batch: AgentTraceBatch) -> int:
    return collection.service().ingest(batch)


def store_batch(collection: Collection, batch: AgentTraceBatch) -> None:
    """Ingest ``batch`` into the collection's run inside one change of the run."""
    with collection.repository.change(collection.run.id, tenant_id=collection.run.tenant_id) as locked:
        assert locked is not None
        locked.run.ingest(batch, max_spans=100, max_bytes=1_000_000, now=naive_utc_now())


def agent_turn(run: TraceRun, *, root_span_id: str) -> Trace:
    """A business terminal of one Agent turn under ``root_span_id``."""
    root = Span(
        span_id=root_span_id,
        parent_span_id=None,
        name="Agent turn",
        kind=SpanKind.CHAIN,
        start_time=datetime.fromtimestamp(0, UTC),
        end_time=datetime.fromtimestamp(3, UTC),
        status=SpanStatus.OK,
    )
    return Trace(
        trace_id=run.trace_id,
        external_trace_id=None,
        session_id=run.session_id,
        user_id=None,
        parent=None,
        spans=(root,),
    )


def capture_terminal(collection: Collection, trace: Trace) -> None:
    with collection.repository.change(collection.run.id, tenant_id=collection.run.tenant_id) as locked:
        assert locked is not None
        locked.run.capture_terminal(trace, now=naive_utc_now())


def terminal(collection: Collection) -> None:
    capture_terminal(collection, agent_turn(collection.run, root_span_id=collection.run.root_span_id))


def claim(collection: Collection) -> str | None:
    """Lease the collection's run for one export attempt; the token fencing it, ``None`` when it cannot export."""
    token = str(uuid4())
    with collection.repository.change(collection.run.id, tenant_id=collection.run.tenant_id) as locked:
        assert locked is not None
        claimed = locked.run.claim_export(
            token=token, owner_exists=locked.owner_exists, collection_timeout=60, lease_seconds=30, now=naive_utc_now()
        )
    return token if claimed else None


def recover(collection: Collection, service: ApplicationTracingService, records: TraceRecordSource) -> bool:
    """One reconciler recovery attempt of the collection's run, collected by ``service``."""
    run = collection.repository.load(collection.run.id)
    assert run is not None
    return recover_terminal(
        run,
        runs=collection.repository,
        sources=collection.repository,
        records=records,
        collector=service,
        collection_timeout=AGENT_TRACE_SETTINGS.collection_timeout_seconds,
        now=naive_utc_now(),
    )


def message_info(collection: Collection) -> MessageTraceInfo:
    """The completed message record of the collection's message."""
    with collection.sessions() as session:
        message = session.get(Message, collection.run.source_id)
        assert message is not None
        data = TraceMessage(
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
        )
    return MessageTraceInfo(
        message_id=data.id,
        message_data=data,
        inputs={"query": data.query},
        outputs=data.answer,
        start_time=data.created_at,
        end_time=data.created_at,
        metadata={"app_id": data.app_id},
        conversation_model="chat",
        message_tokens=0,
        answer_tokens=0,
        total_tokens=0,
        error=None,
        file_list=[],
        conversation_mode=AppMode.AGENT,
        gen_ai_server_time_to_first_token=None,
        llm_streaming_time_to_generate=None,
        is_streaming_request=False,
    )


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

    def start(self) -> TraceRun:
        run = self.service().start(
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
        return self.case.service()

    def status(self, *, node_execution_id: str | None) -> TraceRunStatus:
        return self.service().status(
            tenant_id=self.case.run.tenant_id,
            app_id=self.case.run.app_id,
            source_kind=self.kind,
            source_id=str(self.row["id"]),
            node_execution_id=node_execution_id,
        )


class AssembledEvents(TraceRecordSource):
    """Real trace records that remember every event they were asked to assemble."""

    def __init__(self, records: TraceRecordSource) -> None:
        self._records = records
        self.events: list[TraceEvent] = []

    @override
    def assemble(self, event: TraceEvent) -> BaseTraceInfo:
        self.events.append(event)
        return self._records.assemble(event)


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
            if kind == "workflow":
                assert not transactions, "LogStore I/O must not hold a SQL transaction"
                assert logstore == AliyunLogStore.workflow_node_execution_logstore
                assert f"tenant_id = '{case.run.tenant_id}'" in sql
                assert f"app_id = '{case.run.app_id}'" in sql
                assert f"workflow_run_id = '{row['id']}'" in sql
                requests.append(query)
                return []
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
            yield StoredSource(case, kind, row, requests)
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
        assert stored.case.scheduled == [run.id]
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
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    def test_initialization_failure_uses_configured_source_reader(stored: StoredSource) -> None:
        info = workflow_info(_dict_to_workflow_run(stored.row), None)
        assert stored.service().capture_terminal(tenant_id=stored.case.run.tenant_id, info=info) is True
        run = stored.case.repository.source_run(
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
        current = stored.service().start(
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
        case = replace(stored.case, run=run)
        node_id = identifier("logstore-agent-node")
        invocation = open_invocation(case, node_execution_id=node_id, call_key="node")
        ingest(case, batch_for(run, invocation))
        terminal(case)
        token = claim(case)
        assert token is not None
        with case.repository.change(run.id, tenant_id=run.tenant_id) as locked:
            assert locked is not None
            locked.run.export_accepted(
                token,
                provider_trace_id="provider-id",
                trace_url=None,
                span_urls={invocation.span_id: "https://trace.test/span"},
                now=naive_utc_now(),
            )
        assert stored.status(node_execution_id=node_id).span_url == "https://trace.test/span"
        with pytest.raises(TraceCollectionNotFoundError, match="tracing_node_not_found"):
            stored.status(node_execution_id=identifier("another-run-node"))

    @staticmethod
    def test_preview_settlement_and_workflow_recovery_use_configured_source(stored: StoredSource) -> None:
        run = stored.start()
        if stored.kind == "workflow":
            records = AssembledEvents(trace_records(stored.case.sessions))
            service = collector(stored.case.repository, records, stored.case.scheduled)
            stored.row["status"] = "running"
            assert recover(replace(stored.case, run=run), service, records) is False
            assert records.events == []
            stored.row["status"] = "succeeded"
            assert recover(replace(stored.case, run=run), service, records) is True
            (recovered,) = records.events
            assert recovered.payload == WorkflowRunCompleted(
                workflow_run_id=run.source_id, conversation_id=None, total_tokens=None
            )
            assert (recovered.tenant_id, recovered.app_id) == (run.tenant_id, run.app_id)
            assert recovered.user_id == stored.row["created_by"]
            assert recovered.correlation.session_id == run.session_id
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
    """Run ``competitor`` after the caller's existence checks, when it allocates its new run's identifiers."""
    raced: list[bool] = []

    def allocate() -> UUID:
        if not raced:
            raced.append(True)
            competitor()
        return uuidv7()

    monkeypatch.setattr(service_module, "uuidv7", allocate)


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
    return case.service().start(
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        source_kind="message",
        source_id=case.run.source_id,
        session_id=session_id,
        workflow_id=None,
    )


class PurgedBeforeLock(ApplicationTraceRepository):
    """Retention that keeps runs for zero days purges each run after a use case read it and before it locks it."""

    @override
    @contextmanager
    def change(self, run_id: str, *, tenant_id: str) -> Generator[LockedTraceRun | None]:
        self.purge(retention_days=0, limit=100)
        with super().change(run_id, tenant_id=tenant_id) as locked:
            yield locked


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
        info = message_info(case)
        winners: list[TraceRun | None] = []
        race_before_insert(monkeypatch, lambda: winners.append(start_message(case, "started-session")))
        # The Agent app's terminal finds no start snapshot, so it records an initialization failure.
        assert case.service().capture_terminal(tenant_id=case.run.tenant_id, info=info) is True
        current = case.repository.source_run(
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
        monkeypatch.setattr(service_module, "uuidv7", lambda: UUID(other.run.id))
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
        started = case.service().start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="message",
            source_id=case.run.source_id,
            session_id="",
            workflow_id=None,
        )
        assert started is None
        run = case.repository.source_run(
            tenant_id=case.run.tenant_id, app_id=case.run.app_id, source_kind="message", source_id=case.run.source_id
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
        preview = identifier("preview")
        assert (
            case.service().start(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                source_kind="node",
                source_id=preview,
                session_id="preview",
                workflow_id=identifier("missing-workflow"),
            )
            is None
        )
        assert (
            case.repository.source_run(
                tenant_id=case.run.tenant_id, app_id=case.run.app_id, source_kind="node", source_id=preview
            )
            is None
        )

    @staticmethod
    def test_initialization_failure_cannot_replace_snapshot_or_create_foreign_row(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "failure-snapshot")
        info = message_info(case)
        assert case.service().capture_terminal(tenant_id=case.run.tenant_id, info=info) is True
        same = case.repository.source_run(
            tenant_id=case.run.tenant_id, app_id=case.run.app_id, source_kind="message", source_id=case.run.source_id
        )
        assert same is not None
        assert same.id == case.run.id
        assert same.state is TraceRunState.COLLECTING
        assert same.provider_config == case.run.provider_config
        foreign = identifier("foreign-tenant")
        assert case.service().capture_terminal(tenant_id=foreign, info=info) is False
        assert (
            case.repository.source_run(
                tenant_id=foreign, app_id=case.run.app_id, source_kind="message", source_id=case.run.source_id
            )
            is None
        )
        assert run_count(case) == 1

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
        replacement = agent_turn(case.run, root_span_id="f" * 16)
        capture_terminal(case, replacement)
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
        capture_terminal(case, replacement)
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
            case.service().retry(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                source_kind="message",
                source_id=case.run.source_id,
                acknowledge_possible_duplicates=True,
                node_execution_id=None,
            )
        current = case.repository.get(case.run.id)
        assert current is not None
        assert current.state is state

    @staticmethod
    def test_retry_unknown_run_and_invocation_reject_before_creation(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "retry-unknown")
        purged = replace(case, repository=PurgedBeforeLock(case.sessions)).service()
        with pytest.raises(TraceCollectionNotFoundError, match="tracing_run_not_found"):
            purged.retry(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                source_kind="message",
                source_id=case.run.source_id,
                acknowledge_possible_duplicates=True,
                node_execution_id=None,
            )
        with pytest.raises(TraceCollectionConflictError, match="tracing_run_not_collecting"):
            purged.prepare_invocation(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                agent_id=identifier("agent"),
                source_kind="message",
                source_id=case.run.source_id,
                session_id="unknown-session",
                node_execution_id=None,
                attempt=0,
                call_key="x",
                workflow_id=None,
            )
        purged.deliver(case.run.id)
        assert run_count(case) == 0
        with case.sessions() as session:
            assert session.scalar(select(func.count()).select_from(ApplicationTraceInvocation)) == 0
        assert case.scheduled == []

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
        assert expired.repository.invocations(expired.run.id) == []
        assert expired.repository.batches(expired.run.id) == []
        assert fresh.repository.get(fresh.run.id) is not None
        assert len(fresh.repository.invocations(fresh.run.id)) == len(fresh.repository.batches(fresh.run.id)) == 1
        assert expired.repository.purge(retention_days=7, limit=100) == 0


"""Whole runs load and save under their row lock; every read is scoped by the run's owner."""


def stored_fields(run: TraceRunAgg) -> dict[str, object]:
    """Every field of a run that its repository saves and loads again."""
    return {name: value for name, value in asdict(run).items() if name != "new_batches"}


def reloaded(collection: Collection) -> dict[str, object]:
    with collection.repository.change(collection.run.id, tenant_id=collection.run.tenant_id) as locked:
        assert locked is not None
        return stored_fields(locked.run)


def record_of(run: TraceRunAgg) -> TraceRun:
    """The record the repository reads back for a stored run."""
    return TraceRun(
        id=run.id,
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        source_kind=run.source_kind,
        source_id=run.source_id,
        provider=run.provider,
        config_revision=run.config_revision,
        provider_config=run.provider_config,
        trace_id=run.trace_id,
        root_span_id=run.root_span_id,
        session_id=run.session_id,
        capture_content=run.capture_content,
        capture_agent=run.capture_agent,
        state=run.state,
        outer_trace=run.outer_trace,
        span_count=run.span_count,
        attempts=run.attempts,
        error_code=run.error_code,
        trace_url=run.trace_url,
        provider_trace_id=run.provider_trace_id,
        span_urls=run.span_urls,
        accepted_at=run.accepted_at,
    )


def frozen_run(case: Collection) -> TraceRunAgg:
    """A new run of the collection's message, frozen for its Langfuse destination."""
    return TraceRunAgg.freeze(
        run_id=str(uuidv7()),
        trace_id=uuidv7().hex,
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        source_kind="message",
        source_id=case.run.source_id,
        session_id="frozen-session",
        policy=LANGFUSE_POLICY,
        stored_config=case.run.provider_config,
        now=naive_utc_now(),
    )


def failed_run(case: Collection) -> TraceRunAgg:
    """A new run of the collection's message, closed because its start snapshot is missing."""
    return TraceRunAgg.initialization_failed(
        run_id=str(uuidv7()),
        trace_id=uuidv7().hex,
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        source_kind="message",
        source_id=case.run.source_id,
        now=naive_utc_now(),
    )


def store_policy(case: Collection, policy: str | None) -> None:
    with case.sessions.begin() as session:
        app = session.get(App, case.run.app_id)
        assert app is not None
        app.tracing = policy


@dataclass
class OwnedSources:
    """An Agent app's message in its conversation, a workflow definition, and a run of it with a node execution."""

    case: Collection
    workflow_id: str
    workflow_run_id: str
    node_execution_id: str

    def read(self, name: str, *, tenant_id: str, app_id: str) -> object:
        repository = self.case.repository
        message_id = self.case.run.source_id
        match name:
            case "source_run":
                return repository.source_run(
                    tenant_id=tenant_id, app_id=app_id, source_kind="message", source_id=message_id
                )
            case "workflow_run_trace":
                return repository.workflow_run_trace(tenant_id=tenant_id, workflow_run_id=self.workflow_run_id)
            case "app":
                return repository.app(tenant_id=tenant_id, app_id=app_id)
            case "app_tracing":
                return repository.app_tracing(tenant_id=tenant_id, app_id=app_id)
            case "app_workflow_graph":
                return repository.app_workflow_graph(tenant_id=tenant_id, app_id=app_id, workflow_id=self.workflow_id)
            case "message":
                return repository.message(tenant_id=tenant_id, app_id=app_id, message_id=message_id)
            case "workflow_run":
                return repository.workflow_run(tenant_id=tenant_id, app_id=app_id, workflow_run_id=self.workflow_run_id)
            case "node_execution":
                return repository.node_execution(
                    tenant_id=tenant_id, app_id=app_id, node_execution_id=self.node_execution_id
                )
            case "workflow_run_conversation_id":
                return repository.workflow_run_conversation_id(
                    tenant_id=tenant_id, app_id=app_id, workflow_run_id=self.workflow_run_id
                )
            case "message_progress":
                return repository.message_progress(tenant_id=tenant_id, app_id=app_id, message_id=message_id)
            case _:
                raise AssertionError(f"unknown read: {name}")


WORKSPACE_READS = (
    "source_run",
    "workflow_run_trace",
    "app",
    "app_tracing",
    "app_workflow_graph",
    "message",
    "workflow_run",
    "node_execution",
    "workflow_run_conversation_id",
    "message_progress",
)
"""Every read of runs and of the records they are collected for that names a workspace."""
APP_READS = tuple(name for name in WORKSPACE_READS if name not in {"workflow_run_trace", "app", "app_tracing"})
"""The reads that also name the app owning the record."""


class TestApplicationTraceRepositoryPersistenceCases:
    @staticmethod
    @pytest.fixture
    def owned(sqlite_session_factory: sessionmaker[Session]) -> OwnedSources:
        case = seed(sqlite_session_factory, "owned")
        workflow_id, workflow_run_id = identifier("owned-definition"), identifier("owned-run")
        node_execution_id, owner = identifier("owned-node"), identifier("owner")
        with case.sessions.begin() as session:
            message = session.get(Message, case.run.source_id)
            assert message is not None
            message.workflow_run_id = workflow_run_id
            session.add(
                make_conversation(
                    conversation_id=message.conversation_id,
                    app_id=case.run.app_id,
                    mode=AppMode.AGENT,
                    inputs={},
                    from_source=ConversationFromSource.CONSOLE,
                )
            )
            session.add(
                make_workflow(
                    workflow_id=workflow_id, tenant_id=case.run.tenant_id, app_id=case.run.app_id, graph=AGENT_GRAPH
                )
            )
            session.add(
                _dict_to_workflow_run(
                    {
                        "id": workflow_run_id,
                        "tenant_id": case.run.tenant_id,
                        "app_id": case.run.app_id,
                        "workflow_id": workflow_id,
                        "created_by": owner,
                    }
                )
            )
            session.add(
                _dict_to_workflow_node_execution_model(
                    {
                        "id": node_execution_id,
                        "tenant_id": case.run.tenant_id,
                        "app_id": case.run.app_id,
                        "workflow_id": workflow_id,
                        "workflow_run_id": workflow_run_id,
                        "node_id": "agent",
                        "node_type": "agent",
                        "title": "Agent",
                        "status": "succeeded",
                        "created_by": owner,
                    }
                )
            )
        workflow_trace = case.service().start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="workflow",
            source_id=workflow_run_id,
            session_id="owned-session",
            workflow_id=None,
        )
        assert workflow_trace is not None
        return OwnedSources(case, workflow_id, workflow_run_id, node_execution_id)

    @staticmethod
    @pytest.mark.parametrize("new_run", [frozen_run, failed_run], ids=["frozen", "initialization_failed"])
    def test_add_stores_every_field_of_a_new_run(
        sqlite_session_factory: sessionmaker[Session], new_run: Callable[[Collection], TraceRunAgg]
    ) -> None:
        case = seed(sqlite_session_factory, "added")
        drop_run(case)
        run = new_run(case)
        assert case.repository.add(run) is True
        assert case.repository.get(run.id) == record_of(run)
        assert reloaded(replace(case, run=record_of(run))) == stored_fields(run)

    @staticmethod
    def test_add_leaves_a_source_to_the_run_that_first_froze_it(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = seed(sqlite_session_factory, "first-frozen")
        later, failed = frozen_run(case), failed_run(case)
        assert case.repository.add(later) is False
        assert case.repository.add(failed) is False
        assert case.repository.get(later.id) is None
        assert case.repository.get(failed.id) is None
        assert (
            case.repository.source_run(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                source_kind="message",
                source_id=case.run.source_id,
            )
            == case.run
        )
        assert run_count(case) == 1

    @staticmethod
    def test_change_saves_root_fields_invocations_and_new_batches(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "saved")
        now = naive_utc_now()
        batches: list[TraceBatch] = []
        with case.repository.change(case.run.id, tenant_id=case.run.tenant_id) as locked:
            assert locked is not None
            invocation = locked.run.open_invocation(
                agent_id=identifier("agent"), node_execution_id=None, attempt=0, call_key="first"
            )
            partial = batch_for(case.run, invocation).model_copy(update={"final": False})
            locked.run.ingest(partial, max_spans=100, max_bytes=1_000_000, now=now)
            locked.run.capture_terminal(agent_turn(case.run, root_span_id="b" * 16), now=now)
            batches.extend(locked.run.new_batches)
            saved = stored_fields(locked.run)
        assert reloaded(case) == saved

        with case.repository.change(case.run.id, tenant_id=case.run.tenant_id) as locked:
            assert locked is not None
            # The final batch finalizes the invocation the previous change stored.
            final = batch_for(case.run, invocation)
            locked.run.ingest(final, max_spans=100, max_bytes=1_000_000, now=now)
            token = str(uuid4())
            assert locked.run.claim_export(
                token=token, owner_exists=locked.owner_exists, collection_timeout=60, lease_seconds=30, now=now
            )
            batches.extend(locked.run.new_batches)
            saved = stored_fields(locked.run)
        assert reloaded(case) == saved

        with case.repository.change(case.run.id, tenant_id=case.run.tenant_id) as locked:
            assert locked is not None
            locked.run.export_deferred(token, max_attempts=8, now=now)
            saved = stored_fields(locked.run)
        assert reloaded(case) == saved

        later = now + timedelta(minutes=1)
        with case.repository.change(case.run.id, tenant_id=case.run.tenant_id) as locked:
            assert locked is not None
            token = str(uuid4())
            assert locked.run.claim_export(
                token=token, owner_exists=locked.owner_exists, collection_timeout=60, lease_seconds=30, now=later
            )
            locked.run.export_accepted(
                token,
                provider_trace_id="provider-trace",
                trace_url="https://trace.test",
                span_urls={invocation.span_id: "https://trace.test/agent"},
                now=later,
            )
            saved, record = stored_fields(locked.run), record_of(locked.run)
        assert reloaded(case) == saved
        assert case.repository.get(case.run.id) == record
        assert case.repository.invocations(case.run.id) == [replace(invocation, finalized=True, finalized_at=now)]
        assert case.repository.batches(case.run.id) == batches

    @staticmethod
    def test_change_rolls_back_the_whole_block_when_it_raises(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = seed(sqlite_session_factory, "rolled-back")
        before = reloaded(case)

        def change_then_break_a_rule() -> None:
            with case.repository.change(case.run.id, tenant_id=case.run.tenant_id) as locked:
                assert locked is not None
                invocation = locked.run.open_invocation(
                    agent_id=identifier("agent"), node_execution_id=None, attempt=0, call_key="first"
                )
                batch = batch_for(case.run, invocation)
                locked.run.ingest(batch, max_spans=100, max_bytes=1_000_000, now=naive_utc_now())
                locked.run.capture_terminal(
                    agent_turn(case.run, root_span_id=case.run.root_span_id), now=naive_utc_now()
                )
                locked.run.open_invocation(
                    agent_id=identifier("another-agent"), node_execution_id=None, attempt=0, call_key="first"
                )

        with pytest.raises(TraceRunConflictError, match="tracing_invocation_conflict"):
            change_then_break_a_rule()
        assert reloaded(case) == before
        assert case.repository.invocations(case.run.id) == []
        assert case.repository.batches(case.run.id) == []

    @staticmethod
    def test_change_rejects_a_new_batch_whose_id_another_run_stores(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "batch-owner")
        other = seed(sqlite_session_factory, "batch-reuse")
        batch = batch_for(case.run, case.invocation())
        ingest(case, batch)
        reused = batch_for(other.run, other.invocation()).model_copy(update={"batch_id": batch.batch_id})
        before = reloaded(other)
        with pytest.raises(TraceCollectionConflictError, match="tracing_batch_conflict"):
            store_batch(other, reused)
        assert reloaded(other) == before
        assert other.repository.batches(other.run.id) == []
        (kept,) = case.repository.batches(case.run.id)
        assert (kept.id, kept.invocation_id) == (str(batch.batch_id), str(batch.invocation_id))

    @staticmethod
    @pytest.mark.parametrize("revocation", ["moved", "deleted"])
    def test_change_tells_whether_the_owning_app_still_exists(
        sqlite_session_factory: sessionmaker[Session], revocation: str
    ) -> None:
        case = seed(sqlite_session_factory, "owner")

        def owner_exists() -> bool:
            with case.repository.change(case.run.id, tenant_id=case.run.tenant_id) as locked:
                assert locked is not None
                return locked.owner_exists

        assert owner_exists() is True
        with case.sessions.begin() as session:
            app = session.get(App, case.run.app_id)
            assert app is not None
            if revocation == "moved":
                app.tenant_id = identifier("another-tenant")
            else:
                session.delete(app)
        assert owner_exists() is False

    @staticmethod
    def test_change_yields_nothing_for_another_tenant(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = seed(sqlite_session_factory, "scoped-change")
        before = reloaded(case)

        with case.repository.change(case.run.id, tenant_id=identifier("other-tenant")) as locked:
            assert locked is None

        assert reloaded(case) == before

    @staticmethod
    def test_change_yields_nothing_for_a_missing_run(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = seed(sqlite_session_factory, "missing")
        with case.repository.change(identifier("missing-run"), tenant_id=case.run.tenant_id) as locked:
            assert locked is None

    @staticmethod
    @pytest.mark.parametrize("read", WORKSPACE_READS)
    def test_reads_are_scoped_to_the_owning_workspace(owned: OwnedSources, read: str) -> None:
        owner = owned.case.run
        assert owned.read(read, tenant_id=owner.tenant_id, app_id=owner.app_id) is not None
        assert owned.read(read, tenant_id=identifier("foreign-tenant"), app_id=owner.app_id) is None

    @staticmethod
    @pytest.mark.parametrize("read", APP_READS)
    def test_reads_are_scoped_to_the_owning_app(owned: OwnedSources, read: str) -> None:
        # Every seeded app belongs to the same workspace.
        sibling = seed(owned.case.sessions, "sibling")
        assert owned.read(read, tenant_id=sibling.run.tenant_id, app_id=sibling.run.app_id) is None

    @staticmethod
    def test_workflow_run_trace_requires_its_app(owned: OwnedSources) -> None:
        owner = owned.case.run
        with owned.case.sessions.begin() as session:
            session.execute(delete(App).where(App.id == owner.app_id))
        assert owned.read("workflow_run_trace", tenant_id=owner.tenant_id, app_id=owner.app_id) is None

    @staticmethod
    @pytest.mark.parametrize("policy", [None, "", "invalid-json", "null", "[]", '"langfuse"'])
    def test_app_tracing_reads_a_missing_or_malformed_policy_as_empty(
        sqlite_session_factory: sessionmaker[Session], policy: str | None
    ) -> None:
        case = seed(sqlite_session_factory, "unreadable-policy")
        store_policy(case, policy)
        tracing = case.repository.app_tracing(tenant_id=case.run.tenant_id, app_id=case.run.app_id)
        assert tracing == AppTracingSnapshot(policy={}, config=None)

    @staticmethod
    @pytest.mark.parametrize(
        ("policy", "named"),
        [
            ({"enabled": True, "tracing_provider": "langfuse"}, "langfuse"),
            ({"enabled": False, "tracing_provider": "phoenix"}, "phoenix"),
            ({"enabled": True, "tracing_provider": "opik"}, None),
            ({"enabled": True}, None),
        ],
        ids=["enabled", "disabled", "unconfigured", "unnamed"],
    )
    def test_app_tracing_reads_the_stored_configuration_of_the_named_provider(
        sqlite_session_factory: sessionmaker[Session], policy: dict[str, object], named: str | None
    ) -> None:
        case = seed(sqlite_session_factory, "named-provider")
        configs = {"langfuse": dict(case.run.provider_config), "phoenix": {"endpoint": "https://phoenix.test"}}
        with case.sessions.begin() as session:
            session.add(
                TraceAppConfig(app_id=case.run.app_id, tracing_provider="phoenix", tracing_config=configs["phoenix"])
            )
        store_policy(case, json.dumps(policy))
        tracing = case.repository.app_tracing(tenant_id=case.run.tenant_id, app_id=case.run.app_id)
        assert tracing == AppTracingSnapshot(policy=policy, config=configs[named] if named else None)

    @staticmethod
    def test_runs_read_invocations_by_attempt_then_creation_and_batches_by_arrival(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "collected")
        now = naive_utc_now()
        agent_id = identifier("agent")
        with case.repository.change(case.run.id, tenant_id=case.run.tenant_id) as locked:
            assert locked is not None
            retried = locked.run.open_invocation(agent_id=agent_id, node_execution_id=None, attempt=1, call_key="r")
            first = locked.run.open_invocation(agent_id=agent_id, node_execution_id=None, attempt=0, call_key="a")
            second = locked.run.open_invocation(agent_id=agent_id, node_execution_id=None, attempt=0, call_key="b")
            for invocation in (first, second, retried):
                batch = batch_for(case.run, invocation)
                locked.run.ingest(batch, max_spans=100, max_bytes=1_000_000, now=now)
            invocations, batches = dict(locked.run.invocations), list(locked.run.new_batches)
        # Creation and arrival times that contradict attempt, identifier and storage order.
        earlier, later = sorted([first, second], key=lambda invocation: invocation.id, reverse=True)
        arrival = [batches[2], batches[0], batches[1]]
        with case.sessions.begin() as session:
            for offset, invocation in enumerate([retried, earlier, later]):
                stored_invocation = session.get(ApplicationTraceInvocation, invocation.id)
                assert stored_invocation is not None
                stored_invocation.created_at = now + timedelta(seconds=offset)
            for offset, batch in enumerate(arrival):
                stored_batch = session.get(ApplicationTraceBatch, batch.id)
                assert stored_batch is not None
                stored_batch.created_at = now + timedelta(seconds=offset)
        ordered = [invocations[earlier.id], invocations[later.id], invocations[retried.id]]
        assert case.repository.invocations(case.run.id) == ordered
        assert case.repository.batches(case.run.id) == arrival
        loaded = case.repository.load(case.run.id)
        assert loaded is not None
        assert list(loaded.invocations.values()) == ordered

    @staticmethod
    def test_pending_ids_lists_due_runs_that_may_export_with_terminals_first(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "pending")
        drop_run(case)
        now, hour = naive_utc_now(), timedelta(hours=1)
        # name: (state, terminal_at, next_attempt_at, updated_at), stored in another order than the expected one
        rows: dict[str, tuple[TraceRunState, datetime | None, datetime | None, datetime]] = {
            "newer-ready": (TraceRunState.READY, None, None, now - hour),
            "older-collecting": (TraceRunState.COLLECTING, None, None, now - 6 * hour),
            "terminal-collecting": (TraceRunState.COLLECTING, now - 5 * hour, None, now - 2 * hour),
            "due-retry": (TraceRunState.RETRYING, now - 5 * hour, now - timedelta(minutes=1), now - 3 * hour),
            "exporting": (TraceRunState.EXPORTING, now - 5 * hour, None, now - 4 * hour),
            "backing-off": (TraceRunState.RETRYING, now - 5 * hour, now + hour, now - 7 * hour),
            "accepted": (TraceRunState.ACCEPTED, now - 5 * hour, None, now - 7 * hour),
            "failed": (TraceRunState.FAILED, now - 5 * hour, None, now - 7 * hour),
            "uncertain": (TraceRunState.UNCERTAIN, now - 5 * hour, None, now - 7 * hour),
            "not-collected": (TraceRunState.NOT_COLLECTED, None, None, now - 7 * hour),
        }
        run_ids: dict[str, str] = {}
        for name in rows:
            run = TraceRunAgg.freeze(
                run_id=str(uuidv7()),
                trace_id=uuidv7().hex,
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                source_kind="message",
                source_id=identifier(f"pending-{name}"),
                session_id=name,
                policy=LANGFUSE_POLICY,
                stored_config=case.run.provider_config,
                now=now,
            )
            assert case.repository.add(run) is True
            run_ids[name] = run.id
        with case.sessions.begin() as session:
            for name, (state, terminal_at, next_attempt_at, updated_at) in rows.items():
                row = session.get(ApplicationTraceRun, run_ids[name])
                assert row is not None
                row.state, row.terminal_at = state, terminal_at
                row.next_attempt_at, row.updated_at = next_attempt_at, updated_at
        pending = [
            run_ids[name]
            for name in ("exporting", "due-retry", "terminal-collecting", "older-collecting", "newer-ready")
        ]
        assert case.repository.pending_ids(100) == pending
        assert case.repository.pending_ids(2) == pending[:2]
