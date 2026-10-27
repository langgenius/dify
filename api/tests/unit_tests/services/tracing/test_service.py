import json
import threading
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import override
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pytest
from aliyun.log.logclient import LogClient
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceEvent, AgentTraceSpan
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_sdk.egress import Egress, EgressResponse
from dify_trace_sdk.errors import EgressError, ExportOutcomeUnknownError, ExportRejectedError, ExportRetryableError
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent, TracePayload
from dify_trace_sdk.exporting import send_export_request
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from dify_trace_sdk.testing import RecordingEgress, response
from sqlalchemy import Connection, Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    _dict_to_workflow_node_execution_model,
)
from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run
from graphon.enums import WorkflowNodeExecutionStatus
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import App, AppMode, Message, TraceAppConfig
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from repositories import application_trace_repository as repository_module
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from repositories.application_trace_repository import ApplicationTraceRepository, TraceCollectionError
from services.app_tracing_config_service import AppTracingConfigService
from services.tracing import provider_configs as provider_configs_module
from services.tracing import service as service_module
from services.tracing.assembly import TraceAssembler
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.provider_configs import ProviderConfigGateway
from services.tracing.records import GenerateNameTraceInfo, MessageTraceInfo
from services.tracing.registry import UnknownTraceProviderError, provider_class
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import (
    make_account,
    make_app,
    make_conversation,
    make_message,
    make_tenant,
    make_workflow,
)

"""Exercise collection transactions and delivery state against real SQLite rows."""


def _application_trace_collection_identifier(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


@dataclass
class _ApplicationTraceCollectionCollection:
    repository: ApplicationTraceRepository
    sessions: sessionmaker[Session]
    run: ApplicationTraceRun

    def invocation(self, name: str = "first") -> ApplicationTraceInvocation:
        return self.repository.invocation(
            run_id=self.run.id,
            agent_id=_application_trace_collection_identifier("agent"),
            node_execution_id=None,
            attempt=0,
            call_key=name,
        )


class ScriptedProvider(TraceProvider[LangfuseConfig]):
    """Sends each trace as one JSON request through the egress, whose script decides the outcome."""

    id = "langfuse"
    config_model = LangfuseConfig
    capabilities = ProviderCapabilities(native_cost=True, trace_url=True, span_url=True)

    @override
    def verify(self, config: LangfuseConfig) -> LangfuseConfig:
        return config

    @override
    def project_url(self, config: LangfuseConfig) -> str | None:
        return f"{config.host}/project/{config.project_key}"

    @override
    def send(self, config: LangfuseConfig, trace: Trace) -> SendResult:
        reply = send_export_request(
            self.egress,
            "POST",
            f"{config.host}/traces",
            destination="Scripted",
            headers={"Authorization": f"{config.public_key}:{config.secret_key}"},
            content=trace.model_dump_json().encode(),
            sensitive_url=False,
        )
        body = reply.json()
        assert isinstance(body, dict)
        return SendResult(
            trace_id=str(body["trace_id"]), trace_url=body.get("trace_url"), span_urls=body.get("span_urls", {})
        )


def install_decryption(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """A stored ``encrypted-x`` secret decrypts to ``plaintext-x``; returns the ciphertexts decrypted."""
    ciphertexts: list[str] = []

    def decrypt(_tenant_id: str, tokens: list[str]) -> list[str]:
        ciphertexts.extend(tokens)
        return [token.replace("encrypted-", "plaintext-", 1) for token in tokens]

    monkeypatch.setattr(provider_configs_module, "batch_decrypt_token", decrypt)
    return ciphertexts


def _application_trace_collection_install_delivery(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Deliver Agent traces through ``ScriptedProvider``; returns the ciphertexts decrypted."""

    def provider_class(provider_id: str) -> type[ScriptedProvider]:
        if provider_id != ScriptedProvider.id:
            raise UnknownTraceProviderError(provider_id)
        return ScriptedProvider

    monkeypatch.setattr(service_module, "provider_class", provider_class)
    return install_decryption(monkeypatch)


def _application_trace_collection_accepted(trace_id: str) -> RecordingEgress:
    """An egress whose destination acknowledges exactly one trace."""
    return RecordingEgress([response(200, {"trace_id": trace_id})], grpc_target=None)


def _application_trace_collection_no_egress() -> RecordingEgress:
    """An egress that fails any request the test did not script."""
    return RecordingEgress([], grpc_target=None)


def sent_traces(egress: RecordingEgress) -> list[Trace]:
    return [Trace.model_validate_json(request.content or b"") for request in egress.requests]


def _application_trace_collection_tracing_service(
    case: _ApplicationTraceCollectionCollection, egress: Egress
) -> ApplicationTracingService:
    return ApplicationTracingService(
        case.repository,
        assembler=TraceAssembler(case.sessions, files_url="https://files.test", enterprise_details=False),
        builder=CanonicalTraceBuilder(),
        egress=egress,
    )


def _application_trace_collection_seed(
    sessions: sessionmaker[Session],
    name: str,
    *,
    capture_content: bool = False,
    enabled: bool = True,
    capture_agent: bool = True,
) -> _ApplicationTraceCollectionCollection:
    app_id, tenant_id, message_id = (
        _application_trace_collection_identifier(f"app-{name}"),
        _application_trace_collection_identifier("tenant"),
        _application_trace_collection_identifier(f"message-{name}"),
    )
    with sessions.begin() as session:
        session.add(
            make_app(
                app_id=app_id,
                tenant_id=tenant_id,
                mode=AppMode.AGENT,
                tracing=json.dumps(
                    {
                        "enabled": enabled,
                        "tracing_provider": "langfuse",
                        "capture_content": capture_content,
                        "capture_agent": capture_agent,
                    }
                ),
            )
        )
        session.add(
            make_message(
                message_id=message_id,
                app_id=app_id,
                conversation_id=_application_trace_collection_identifier(f"conversation-{name}"),
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
                    "public_key": "encrypted-public",
                    "secret_key": "encrypted-original",
                    "host": "https://langfuse.test",
                    "project_key": "original",
                },
            )
        )
    repository = ApplicationTraceRepository(sessions)
    run = repository.start(
        tenant_id=tenant_id, app_id=app_id, source_kind="message", source_id=message_id, session_id="session-original"
    )
    assert run is not None
    return _ApplicationTraceCollectionCollection(repository, sessions, run)


def attach_conversation(case: _ApplicationTraceCollectionCollection, mode: AppMode) -> None:
    """Message records are assembled only for a message whose conversation belongs to its app."""
    with case.sessions.begin() as session:
        message = session.get(Message, case.run.source_id)
        assert message is not None
        session.add(
            make_conversation(
                conversation_id=message.conversation_id,
                app_id=case.run.app_id,
                mode=mode,
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
            )
        )


def add_app_owner(case: _ApplicationTraceCollectionCollection, name: str) -> str:
    """Workflow records are read as the app creator, who must be a member of the app's workspace."""
    owner_id = _application_trace_collection_identifier(f"owner-{name}")
    with case.sessions.begin() as session:
        if session.get(Tenant, case.run.tenant_id) is None:
            session.add(make_tenant(tenant_id=case.run.tenant_id))
        session.add(make_account(account_id=owner_id, email=f"{name}@example.com"))
        session.add(TenantAccountJoin(tenant_id=case.run.tenant_id, account_id=owner_id, role=TenantAccountRole.OWNER))
        app = session.get(App, case.run.app_id)
        assert app is not None
        app.created_by = owner_id
    return owner_id


def trace_event(case: _ApplicationTraceCollectionCollection, payload: TracePayload) -> TraceEvent:
    return TraceEvent(
        event_id=uuid4().hex,
        tenant_id=case.run.tenant_id,
        app_id=case.run.app_id,
        user_id=None,
        occurred_at=datetime.now(UTC),
        correlation=TraceCorrelation(
            external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
        ),
        payload=payload,
    )


def message_record(service: ApplicationTracingService, case: _ApplicationTraceCollectionCollection) -> MessageTraceInfo:
    """The record the delivery worker assembles when the message reports its end."""
    with case.sessions() as session:
        message = session.get(Message, case.run.source_id)
        assert message is not None
        conversation_id = message.conversation_id
    record = service.assembler.assemble(
        trace_event(case, MessageCompleted(message_id=case.run.source_id, conversation_id=conversation_id))
    )
    assert isinstance(record, MessageTraceInfo)
    return record


def _application_trace_collection_batch_for(
    run: ApplicationTraceRun,
    invocation: ApplicationTraceInvocation,
    *,
    final: bool = True,
    batch_id: UUID | None = None,
    span_id: str = "a" * 16,
) -> AgentTraceBatch:
    return AgentTraceBatch(
        run_id=UUID(run.id),
        invocation_id=UUID(invocation.id),
        batch_id=batch_id or uuid4(),
        final=final,
        spans=[
            AgentTraceSpan(
                trace_id=run.trace_id,
                span_id=span_id,
                parent_span_id=invocation.span_id,
                name="Agent execution",
                start_time_ns=1_000_000_000,
                end_time_ns=2_000_000_000,
                status="ok",
                attributes={"gen_ai.operation.name": "invoke_agent"},
            )
        ],
    )


def _application_trace_collection_ingest(
    collection: _ApplicationTraceCollectionCollection, batch: AgentTraceBatch
) -> tuple[int, str]:
    return collection.repository.ingest(batch, max_spans=100, max_bytes=1_000_000)


def _application_trace_collection_terminal(collection: _ApplicationTraceCollectionCollection) -> None:
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


def _application_trace_collection_claim(
    collection: _ApplicationTraceCollectionCollection,
) -> tuple[ApplicationTraceRun, str] | None:
    return collection.repository.claim(collection.run.id, collection_timeout=60, lease_seconds=30)


class TestApplicationTraceCollectionCases:
    @staticmethod
    @pytest.fixture
    def collection(sqlite_session_factory: sessionmaker[Session]) -> _ApplicationTraceCollectionCollection:
        return _application_trace_collection_seed(sqlite_session_factory, "first")

    @staticmethod
    def test_batch_duplicate_is_idempotent_after_final_and_acceptance(
        collection: _ApplicationTraceCollectionCollection,
    ) -> None:
        invocation = collection.invocation()
        batch = _application_trace_collection_batch_for(collection.run, invocation)
        assert _application_trace_collection_ingest(collection, batch) == (1, collection.run.id)
        assert _application_trace_collection_ingest(collection, batch) == (1, collection.run.id)
        _application_trace_collection_terminal(collection)
        leased = _application_trace_collection_claim(collection)
        assert leased is not None
        collection.repository.complete(
            collection.run.id,
            leased[1],
            state="accepted",
            result=SendResult(trace_id="provider-id", trace_url=None, span_urls={}),
        )
        assert _application_trace_collection_ingest(collection, batch) == (1, collection.run.id)
        stored = collection.repository.get(collection.run.id)
        assert stored is not None
        assert stored.span_count == 1
        with collection.sessions() as session:
            assert session.scalar(select(func.count()).select_from(ApplicationTraceBatch)) == 1

    @staticmethod
    def test_conflicting_batch_id_rolls_back_without_replacing_payload(
        collection: _ApplicationTraceCollectionCollection,
    ) -> None:
        batch = _application_trace_collection_batch_for(collection.run, collection.invocation(), final=False)
        _application_trace_collection_ingest(collection, batch)
        changed = batch.model_copy(update={"final": True})
        with pytest.raises(TraceCollectionError, match="tracing_batch_conflict"):
            _application_trace_collection_ingest(collection, changed)
        invocations, batches = collection.repository.collected(collection.run.id)
        assert invocations[0].finalized is False
        assert batches[0].final is False

    @staticmethod
    def test_run_cannot_ingest_another_runs_invocation(collection: _ApplicationTraceCollectionCollection) -> None:
        other = _application_trace_collection_seed(collection.sessions, "other")
        foreign = other.invocation()
        forged = _application_trace_collection_batch_for(collection.run, foreign)
        with pytest.raises(TraceCollectionError, match="tracing_invocation_not_found"):
            _application_trace_collection_ingest(collection, forged)
        with collection.sessions() as session:
            assert session.scalar(select(func.count()).select_from(ApplicationTraceBatch)) == 0

    @staticmethod
    def test_payload_limits_reject_whole_transaction(collection: _ApplicationTraceCollectionCollection) -> None:
        batch = _application_trace_collection_batch_for(collection.run, collection.invocation())
        with pytest.raises(TraceCollectionError, match="tracing_payload_limit"):
            collection.repository.ingest(batch, max_spans=100, max_bytes=1)
        invocations, batches = collection.repository.collected(collection.run.id)
        assert not batches
        assert invocations[0].finalized is False
        stored = collection.repository.get(collection.run.id)
        assert stored is not None
        assert stored.span_count == 0

    @staticmethod
    def test_wrong_trace_id_is_rejected_before_persistence(collection: _ApplicationTraceCollectionCollection) -> None:
        batch = _application_trace_collection_batch_for(collection.run, collection.invocation())
        altered = batch.model_copy(update={"spans": [batch.spans[0].model_copy(update={"trace_id": "f" * 32})]})
        with pytest.raises(TraceCollectionError, match="tracing_trace_id_mismatch"):
            _application_trace_collection_ingest(collection, altered)
        _, batches = collection.repository.collected(collection.run.id)
        assert not batches

    @staticmethod
    def test_content_off_cleans_the_durable_batch_not_only_the_export(
        collection: _ApplicationTraceCollectionCollection,
    ) -> None:
        original = _application_trace_collection_batch_for(collection.run, collection.invocation(), final=False)
        observation = original.spans[0].model_copy(
            update={
                "status": "error",
                "status_message": "private error",
                "attributes": {
                    "gen_ai.operation.name": "chat",
                    "gen_ai.request.model": "model-one",
                    "gen_ai.input.messages": "private prompt",
                    "gen_ai.tool.call.arguments": "private arguments",
                    "dify.payload": "private metadata",
                    "authorization": "private credential",
                },
                "events": [
                    AgentTraceEvent(
                        name="exception", timestamp_ns=1_500_000_000, attributes={"exception.message": "private event"}
                    )
                ],
            }
        )
        batch = original.model_copy(update={"spans": [observation]})
        _application_trace_collection_ingest(collection, batch)
        _, batches = collection.repository.collected(collection.run.id)
        assert "private" not in json.dumps(batches[0].spans)
        assert batches[0].spans[0]["events"] == []
        assert batches[0].spans[0]["status"] == "error"
        assert batches[0].spans[0]["attributes"]["gen_ai.request.model"] == "model-one"
        # A changed original payload is a conflict even if content-off sanitization
        # would produce exactly the same persisted span.
        changed = batch.model_copy(
            update={"spans": [observation.model_copy(update={"status_message": "different private error"})]}
        )
        with pytest.raises(TraceCollectionError, match="tracing_batch_conflict"):
            _application_trace_collection_ingest(collection, changed)

    @staticmethod
    def test_invocation_key_replay_must_not_change_agent_binding(
        collection: _ApplicationTraceCollectionCollection,
    ) -> None:
        original = collection.invocation()
        repeated = collection.invocation()
        assert original.id == repeated.id
        with pytest.raises(TraceCollectionError, match="tracing_invocation_conflict"):
            collection.repository.invocation(
                run_id=collection.run.id,
                agent_id=_application_trace_collection_identifier("different-agent"),
                node_execution_id=_application_trace_collection_identifier("different-node"),
                attempt=2,
                call_key="first",
            )

    @staticmethod
    def test_claim_waits_for_all_invocations_final_and_then_only_one_lease(
        collection: _ApplicationTraceCollectionCollection,
    ) -> None:
        first, second = collection.invocation("first"), collection.invocation("second")
        _application_trace_collection_terminal(collection)
        _application_trace_collection_ingest(collection, _application_trace_collection_batch_for(collection.run, first))
        assert _application_trace_collection_claim(collection) is None
        _application_trace_collection_ingest(
            collection, _application_trace_collection_batch_for(collection.run, second, span_id="b" * 16)
        )
        leased = _application_trace_collection_claim(collection)
        assert leased is not None
        assert _application_trace_collection_claim(collection) is None
        assert leased[0].attempts == 1

    @staticmethod
    def test_expired_delivery_lease_accepts_confirmed_late_ack_for_same_attempt(
        collection: _ApplicationTraceCollectionCollection,
    ) -> None:
        _application_trace_collection_ingest(
            collection, _application_trace_collection_batch_for(collection.run, collection.invocation())
        )
        _application_trace_collection_terminal(collection)
        leased = _application_trace_collection_claim(collection)
        assert leased is not None
        with collection.sessions.begin() as session:
            stored = session.get(ApplicationTraceRun, collection.run.id)
            assert stored is not None
            stored.export_started_at = naive_utc_now() - timedelta(seconds=60)
            stored.export_heartbeat_at = stored.export_started_at
        assert _application_trace_collection_claim(collection) is None
        current = collection.repository.get(collection.run.id)
        assert current is not None
        assert current.state == "uncertain"
        collection.repository.complete(
            collection.run.id,
            leased[1],
            state="accepted",
            result=SendResult(trace_id="late", trace_url=None, span_urls={}),
        )
        stored = collection.repository.get(collection.run.id)
        assert stored is not None
        assert stored.state == "accepted"
        assert stored.error_code is None
        assert stored.accepted_at is not None
        assert stored.provider_trace_id == "late"
        assert _application_trace_collection_claim(collection) is None

    @staticmethod
    def test_incomplete_final_times_out_without_export(collection: _ApplicationTraceCollectionCollection) -> None:
        collection.invocation()
        _application_trace_collection_terminal(collection)
        with collection.sessions.begin() as session:
            stored = session.get(ApplicationTraceRun, collection.run.id)
            assert stored is not None
            stored.terminal_at = naive_utc_now() - timedelta(seconds=120)
        assert _application_trace_collection_claim(collection) is None
        stored = collection.repository.get(collection.run.id)
        assert stored is not None
        assert stored.state == "failed"
        assert stored.error_code == "agent_trace_collection_incomplete"

    @staticmethod
    def test_running_trace_freezes_credentials_content_policy_and_session(
        collection: _ApplicationTraceCollectionCollection,
    ) -> None:
        original = collection.run
        with collection.sessions.begin() as session:
            app = session.get(App, original.app_id)
            assert app is not None
            app.tracing = json.dumps({"enabled": False, "tracing_provider": "opik", "capture_content": True})
            config = session.scalar(select(TraceAppConfig).where(TraceAppConfig.app_id == original.app_id))
            assert config is not None
            config.tracing_config = {"secret_key": "encrypted-new"}
        repeated = collection.repository.start(
            tenant_id=original.tenant_id,
            app_id=original.app_id,
            source_kind="message",
            source_id=original.source_id,
            session_id="changed",
        )
        assert repeated is not None
        assert repeated.provider == "langfuse"
        assert repeated.provider_config["secret_key"] == "encrypted-original"
        assert repeated.capture_content is False
        assert repeated.config_revision == original.config_revision
        assert repeated.session_id == "session-original"

    @staticmethod
    @pytest.mark.parametrize(
        ("outcome", "reply"),
        [
            ("accepted", response(200, {"trace_id": "vendor-trace", "trace_url": "https://trace.test/example"})),
            ("uncertain", EgressError("acknowledgement lost", request_sent=True)),
            ("retrying", response(503, {})),
        ],
    )
    def test_delivery_checkpoint_controls_replays(
        collection: _ApplicationTraceCollectionCollection,
        monkeypatch: pytest.MonkeyPatch,
        outcome: str,
        reply: EgressResponse | Exception,
    ) -> None:
        _application_trace_collection_ingest(
            collection, _application_trace_collection_batch_for(collection.run, collection.invocation())
        )
        _application_trace_collection_terminal(collection)
        ciphertexts = _application_trace_collection_install_delivery(monkeypatch)
        egress = RecordingEgress([reply], grpc_target=None)
        service = _application_trace_collection_tracing_service(collection, egress)
        service.deliver(collection.run.id)
        service.deliver(collection.run.id)
        assert len(egress.requests) == 1
        request = egress.requests[0]
        assert request.url == "https://langfuse.test/traces"
        assert request.headers["Authorization"] == "plaintext-public:plaintext-original"
        assert ciphertexts == ["encrypted-public", "encrypted-original"]
        stored = collection.repository.get(collection.run.id)
        assert stored is not None
        assert stored.state == outcome
        assert stored.provider_config["secret_key"] == "encrypted-original"
        assert "plaintext" not in json.dumps(stored.outer_trace)

    @staticmethod
    def test_source_owner_checks_app_and_tenant(collection: _ApplicationTraceCollectionCollection) -> None:
        run = collection.run
        assert (
            collection.repository.start(
                tenant_id=_application_trace_collection_identifier("foreign-tenant"),
                app_id=run.app_id,
                source_kind="message",
                source_id=run.source_id,
                session_id="x",
            )
            is None
        )
        other = _application_trace_collection_seed(collection.sessions, "second-app")
        assert (
            collection.repository.start(
                tenant_id=run.tenant_id,
                app_id=other.run.app_id,
                source_kind="message",
                source_id=run.source_id,
                session_id="x",
            )
            is None
        )

    @staticmethod
    def test_disabled_source_decision_stays_disabled_after_config_enable(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        case = _application_trace_collection_seed(sqlite_session_factory, "initially-disabled", enabled=False)
        attach_conversation(case, AppMode.AGENT)
        service = _application_trace_collection_tracing_service(case, _application_trace_collection_no_egress())
        assert case.run.state == "not_collected"
        with case.sessions.begin() as session:
            app = session.get(App, case.run.app_id)
            assert app is not None
            app.tracing = json.dumps({"enabled": True, "tracing_provider": "langfuse", "capture_content": True})
        assert (
            service.start(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                source_kind="message",
                source_id=case.run.source_id,
                session_id="later-session",
            )
            is None
        )
        assert service.capture_terminal(message_record(service, case)) is True
        stored = case.repository.get(case.run.id)
        assert stored is not None
        assert stored.state == "not_collected"
        assert stored.provider_config == {}
        assert stored.outer_trace is None

    @staticmethod
    def test_capture_agent_disabled_preserves_outer_only_content_policy(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        case = _application_trace_collection_seed(sqlite_session_factory, "outer-only", capture_agent=False)
        attach_conversation(case, AppMode.AGENT)
        service = _application_trace_collection_tracing_service(case, _application_trace_collection_no_egress())
        scheduled: list[str] = []
        monkeypatch.setattr(service, "schedule", scheduled.append)
        assert (
            service.prepare_invocation(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                agent_id=_application_trace_collection_identifier("agent"),
                source_kind="message",
                source_id=case.run.source_id,
                session_id="session",
                node_execution_id=None,
                attempt=0,
                call_key="call",
            )
            is None
        )
        info = message_record(service, case).model_copy(update={"inputs": "private input", "outputs": "private output"})
        assert service.capture_terminal(info) is True
        assert scheduled == [case.run.id]
        stored = case.repository.get(case.run.id)
        assert stored is not None
        assert stored.outer_trace is not None
        assert "private" not in json.dumps(stored.outer_trace)
        # The message's synthetic model call is left to the Agent runtime, which reports none here.
        assert len(stored.outer_trace["spans"]) == 1
        invocations, _ = case.repository.collected(case.run.id)
        assert invocations == []

    @staticmethod
    def test_deleting_selected_configuration_keeps_historical_destination(
        collection: _ApplicationTraceCollectionCollection,
    ) -> None:
        original = collection.run
        service = AppTracingConfigService(
            configs=SQLAlchemyAppTracingConfigRepository(session_factory=collection.sessions),
            provider=ProviderConfigGateway(_application_trace_collection_no_egress()),
        )
        service.delete(RequestContext("request", None, "account", original.tenant_id), original.app_id, "langfuse")
        stored = collection.repository.get(original.id)
        assert stored is not None
        assert stored.provider_config == original.provider_config
        assert stored.provider_config["project_key"] == "original"
        assert stored.config_revision == original.config_revision
        with collection.sessions() as session:
            assert session.scalar(select(TraceAppConfig).where(TraceAppConfig.app_id == original.app_id)) is None
            app = session.get(App, original.app_id)
            assert app is not None
            assert app.tracing is not None
            assert json.loads(app.tracing)["enabled"] is False
            assert json.loads(app.tracing)["tracing_provider"] is None


"""Exercise public orchestration, privacy, and delivery decisions against durable rows."""


_ApplicationTraceServiceBoundariesCollection = _ApplicationTraceCollectionCollection
_application_trace_service_boundaries_batch_for = _application_trace_collection_batch_for
_application_trace_service_boundaries_claim = _application_trace_collection_claim
_application_trace_service_boundaries_identifier = _application_trace_collection_identifier
_application_trace_service_boundaries_ingest = _application_trace_collection_ingest
_application_trace_service_boundaries_install_delivery = _application_trace_collection_install_delivery
_application_trace_service_boundaries_no_egress = _application_trace_collection_no_egress
_application_trace_service_boundaries_seed = _application_trace_collection_seed
_application_trace_service_boundaries_terminal = _application_trace_collection_terminal
_application_trace_service_boundaries_tracing_service = _application_trace_collection_tracing_service


FROZEN_LANGFUSE: dict[str, object] = {
    "public_key": "encrypted-public",
    "secret_key": "encrypted-original",
    "host": "https://langfuse.test",
    "project_key": "original",
}


def source(case: _ApplicationTraceServiceBoundariesCollection) -> dict[str, str]:
    return {
        "tenant_id": case.run.tenant_id,
        "app_id": case.run.app_id,
        "source_kind": "message",
        "source_id": case.run.source_id,
    }


def forbid_credentials(monkeypatch: pytest.MonkeyPatch, reason: str) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail(reason)

    monkeypatch.setattr(provider_configs_module, "batch_decrypt_token", forbidden)


def freeze_config(case: _ApplicationTraceServiceBoundariesCollection, provider: str, config: dict[str, object]) -> None:
    with case.sessions.begin() as session:
        run = session.get(ApplicationTraceRun, case.run.id)
        assert run is not None
        run.provider = provider
        run.provider_config = config


class TestApplicationTraceServiceBoundariesCases:
    @staticmethod
    def test_prepare_invocation_returns_only_opaque_context_and_respects_capture_gate(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "prepare", capture_content=True)
        service = _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        )
        context = service.prepare_invocation(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            agent_id=_application_trace_service_boundaries_identifier("agent"),
            source_kind="message",
            source_id=case.run.source_id,
            session_id="ignored-new-session",
            node_execution_id=None,
            attempt=0,
            call_key="call",
        )
        assert context is not None
        assert context.run_id == UUID(case.run.id)
        assert context.capture_content is True
        assert context.session_id == "session-original"
        assert "encrypted-original" not in context.model_dump_json()
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=False)
        assert (
            service.start(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                source_kind="message",
                source_id=case.run.source_id,
                session_id="new",
            )
            is None
        )

    @staticmethod
    @pytest.mark.parametrize("missing", ["tenant", "app", "message"])
    def test_status_denies_foreign_or_absent_source_without_destination_details(
        sqlite_session_factory: sessionmaker[Session], missing: str
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "scope")
        identity = source(case)
        identity[{"tenant": "tenant_id", "app": "app_id", "message": "source_id"}[missing]] = (
            _application_trace_service_boundaries_identifier("foreign")
        )
        with pytest.raises(TraceCollectionError) as caught:
            _application_trace_service_boundaries_tracing_service(
                case, _application_trace_service_boundaries_no_egress()
            ).status(**identity)
        assert caught.value.code == "tracing_source_not_found"
        assert caught.value.status == 404
        assert "encrypted-original" not in str(caught.value)

    @staticmethod
    def test_status_uses_frozen_destination_and_selects_latest_node_attempt(
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "status")
        with case.sessions.begin() as session:
            config = session.scalar(select(TraceAppConfig).where(TraceAppConfig.app_id == case.run.app_id))
            assert config is not None
            config.tracing_config = {**FROZEN_LANGFUSE, "host": "https://new.example", "project_key": "new"}
        forbid_credentials(monkeypatch, "status must not decrypt credentials")
        node_id = _application_trace_service_boundaries_identifier("selected-node")
        invocation = case.repository.invocation(
            run_id=case.run.id,
            agent_id=_application_trace_service_boundaries_identifier("agent"),
            node_execution_id=node_id,
            attempt=1,
            call_key="node:1",
        )
        _application_trace_service_boundaries_ingest(
            case, _application_trace_service_boundaries_batch_for(case.run, invocation)
        )
        _application_trace_service_boundaries_terminal(case)
        lease = _application_trace_service_boundaries_claim(case)
        assert lease is not None
        case.repository.complete(
            case.run.id,
            lease[1],
            state="accepted",
            result=SendResult(
                trace_id="provider-trace",
                trace_url="https://frozen.example/trace",
                span_urls={invocation.span_id: "https://frozen.example/span"},
            ),
        )
        service = _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        )
        result = service.status(**source(case), node_execution_id=node_id)
        assert result["status"] == "accepted"
        assert result["provider"] == "langfuse"
        assert result["trace_id"] == "provider-trace"
        assert result["span_url"] == "https://frozen.example/span"
        assert result["project_url"] == "https://langfuse.test/project/original"
        assert result["config_revision"] == case.run.config_revision
        assert result["queryable"] is None
        assert result["capture_content"] is False
        capabilities = result["capabilities"]
        assert isinstance(capabilities, dict)
        assert capabilities["provider"] == "langfuse"
        assert "provider_config" not in result
        assert "encrypted-original" not in str(result)
        with pytest.raises(TraceCollectionError, match="tracing_node_not_found"):
            service.status(
                **source(case), node_execution_id=_application_trace_service_boundaries_identifier("another-node")
            )

    @staticmethod
    def test_new_run_freezes_updated_project_without_changing_previous_run(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "updated-project")
        new_id = _application_trace_service_boundaries_identifier("new-message")
        with case.sessions.begin() as session:
            config = session.scalar(select(TraceAppConfig).where(TraceAppConfig.app_id == case.run.app_id))
            assert config is not None
            config.tracing_config = {**FROZEN_LANGFUSE, "host": "https://new.example", "project_key": "new"}
            message = session.get(Message, case.run.source_id)
            assert message is not None
            session.add(
                make_message(
                    message_id=new_id,
                    app_id=case.run.app_id,
                    conversation_id=message.conversation_id,
                    inputs={},
                    query="new run",
                    message={},
                    answer="done",
                    message_unit_price=message.message_unit_price,
                    answer_unit_price=message.answer_unit_price,
                    currency=message.currency,
                    from_source=message.from_source,
                )
            )
        new_run = case.repository.start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="message",
            source_id=new_id,
            session_id="new-session",
        )
        assert new_run is not None
        service = _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        )
        assert service.status(**source(case))["project_url"] == "https://langfuse.test/project/original"
        assert (
            service.status(**{**source(case), "source_id": new_id})["project_url"] == "https://new.example/project/new"
        )

    @staticmethod
    @pytest.mark.parametrize(
        "frozen",
        [
            {key: value for key, value in FROZEN_LANGFUSE.items() if key != "public_key"},
            {**FROZEN_LANGFUSE, "host": 1},
            {**FROZEN_LANGFUSE, "host": "javascript:alert(1)"},
            {**FROZEN_LANGFUSE, "host": "//example.com/project"},
            {**FROZEN_LANGFUSE, "host": "https://user:secret@example.com/project"},
            {**FROZEN_LANGFUSE, "host": "https://@example.com"},
            {**FROZEN_LANGFUSE, "host": "https://example.com\\@other.test"},
            {**FROZEN_LANGFUSE, "host": "https://[invalid/project"},
        ],
    )
    def test_status_hides_unavailable_or_unsafe_frozen_project_urls(
        sqlite_session_factory: sessionmaker[Session], frozen: dict[str, object]
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "invalid-project")
        freeze_config(case, "langfuse", frozen)
        result = _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        ).status(**source(case))
        assert result["project_url"] is None
        assert "encrypted-original" not in str(result)

    @staticmethod
    @pytest.mark.parametrize(
        ("provider", "frozen"),
        [
            ("langfuse", FROZEN_LANGFUSE),
            ("aliyun", {"license_key": "encrypted-license", "endpoint": "https://tracing.aliyun.example"}),
            (
                "tencent",
                {"token": "encrypted-token", "endpoint": "https://apm.tencent.example", "service_name": "dify-app"},
            ),
        ],
    )
    def test_status_derives_project_link_from_frozen_provider_not_stored_urls(
        sqlite_session_factory: sessionmaker[Session], provider: str, frozen: dict[str, object]
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "platform-console")
        freeze_config(case, provider, {**frozen, "project_url": "https://stored.example/project"})
        destination = provider_class(provider)
        expected = destination(_application_trace_service_boundaries_no_egress()).project_url(
            destination.config_model.model_validate(frozen)
        )
        result = _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        ).status(**source(case))
        assert expected is not None
        assert result["project_url"] == expected
        capabilities = result["capabilities"]
        assert isinstance(capabilities, dict)
        assert capabilities["provider"] == provider

    @staticmethod
    @pytest.mark.parametrize("disabled", [True, False])
    def test_uncollected_status_and_missing_run_retry_do_not_construct_provider(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, disabled: bool
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "missing", enabled=not disabled)
        if not disabled:
            with case.sessions.begin() as session:
                stored = session.get(ApplicationTraceRun, case.run.id)
                assert stored is not None
                session.delete(stored)

        def forbidden(_provider_id: str) -> None:
            pytest.fail("an uncollected source has no destination to construct")

        monkeypatch.setattr(service_module, "provider_class", forbidden)
        service = _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        )
        assert service.status(**source(case)) == {
            "status": "not_collected",
            "source_kind": "message",
            "source_id": case.run.source_id,
        }
        if not disabled:
            with pytest.raises(TraceCollectionError, match="tracing_run_not_found"):
                service.retry(**source(case), acknowledge_possible_duplicates=True)

    @staticmethod
    def test_retry_acknowledgement_guards_schedule_and_keeps_frozen_snapshot(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "retry")
        _application_trace_service_boundaries_ingest(
            case, _application_trace_service_boundaries_batch_for(case.run, case.invocation())
        )
        _application_trace_service_boundaries_terminal(case)
        lease = _application_trace_service_boundaries_claim(case)
        assert lease is not None
        case.repository.complete(case.run.id, lease[1], state="uncertain", error_code="provider_acceptance_unknown")
        scheduled: list[str] = []
        service = _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        )
        monkeypatch.setattr(service, "schedule", scheduled.append)
        with pytest.raises(TraceCollectionError, match="tracing_duplicate_acknowledgement_required"):
            service.retry(**source(case), acknowledge_possible_duplicates=False)
        assert scheduled == []
        result = service.retry(**source(case), acknowledge_possible_duplicates=True)
        assert scheduled == [case.run.id]
        assert result["status"] == "ready"
        assert result["config_revision"] == case.run.config_revision
        current = case.repository.get(case.run.id)
        assert current is not None
        assert current.provider_config == case.run.provider_config

    @staticmethod
    @pytest.mark.parametrize(
        ("failure", "max_attempts", "state", "code"),
        [
            (ExportRetryableError("private-transport-error"), 1, "failed", "provider_retry_exhausted"),
            (ExportRetryableError("private-transport-error"), 2, "retrying", "provider_temporarily_unavailable"),
            (ExportRejectedError("private-rejection"), 2, "failed", "provider_export_rejected"),
            (ExportOutcomeUnknownError("private-acknowledgement"), 2, "uncertain", "provider_acceptance_unknown"),
            (ValueError("private-credential-error"), 2, "failed", "provider_export_rejected"),
        ],
    )
    def test_delivery_maps_provider_failures_to_stable_codes_without_vendor_details(
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        failure: Exception,
        max_attempts: int,
        state: str,
        code: str,
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_MAX_ATTEMPTS=max_attempts)
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "delivery")
        _application_trace_service_boundaries_ingest(
            case, _application_trace_service_boundaries_batch_for(case.run, case.invocation())
        )
        _application_trace_service_boundaries_terminal(case)
        _application_trace_service_boundaries_install_delivery(monkeypatch)
        destination = RecordingEgress([failure], grpc_target=None)
        service = _application_trace_service_boundaries_tracing_service(case, destination)
        service.deliver(case.run.id)
        current = case.repository.get(case.run.id)
        assert current is not None
        assert (current.state, current.error_code) == (state, code)
        assert (current.next_attempt_at is not None) is (state == "retrying")
        assert current.attempts == 1
        assert len(destination.requests) == 1
        assert "private-" not in caplog.text
        service.deliver(_application_trace_service_boundaries_identifier("missing-run"))

    @staticmethod
    @pytest.mark.parametrize("unreadable", ["decryption", "validation"])
    def test_unreadable_frozen_configuration_fails_before_provider_io(
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        unreadable: str,
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "unreadable")
        _application_trace_service_boundaries_ingest(
            case, _application_trace_service_boundaries_batch_for(case.run, case.invocation())
        )
        _application_trace_service_boundaries_terminal(case)
        _application_trace_service_boundaries_install_delivery(monkeypatch)
        if unreadable == "decryption":

            def undecryptable(_tenant_id: str, _tokens: list[str]) -> list[str]:
                raise ValueError("private-ciphertext")

            monkeypatch.setattr(provider_configs_module, "batch_decrypt_token", undecryptable)
        else:
            freeze_config(case, "langfuse", {**FROZEN_LANGFUSE, "host": "private-host-without-scheme"})
        destination = RecordingEgress([], grpc_target=None)
        _application_trace_service_boundaries_tracing_service(case, destination).deliver(case.run.id)
        current = case.repository.get(case.run.id)
        assert current is not None
        assert (current.state, current.error_code) == ("failed", "tracing_config_unreadable")
        assert destination.requests == []
        assert "private-" not in caplog.text
        with pytest.raises(TraceCollectionError, match="tracing_retry_not_allowed"):
            case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)

    @staticmethod
    def test_unavailable_frozen_provider_fails_before_decryption(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "retired-provider")
        _application_trace_service_boundaries_ingest(
            case, _application_trace_service_boundaries_batch_for(case.run, case.invocation())
        )
        _application_trace_service_boundaries_terminal(case)
        freeze_config(case, "retired-provider", FROZEN_LANGFUSE)
        forbid_credentials(monkeypatch, "an unavailable provider must not decrypt credentials")
        _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        ).deliver(case.run.id)
        current = case.repository.get(case.run.id)
        assert current is not None
        assert (current.state, current.error_code) == ("failed", "tracing_provider_unavailable")

    @staticmethod
    @pytest.mark.parametrize("capture_content", [False, True])
    @pytest.mark.parametrize(
        "status",
        [
            WorkflowNodeExecutionStatus.RUNNING,
            WorkflowNodeExecutionStatus.SUCCEEDED,
            WorkflowNodeExecutionStatus.FAILED,
        ],
    )
    def test_preview_terminal_uses_persisted_node_state_and_frozen_privacy(
        sqlite_session_factory: sessionmaker[Session], status: WorkflowNodeExecutionStatus, capture_content: bool
    ) -> None:
        case = _application_trace_service_boundaries_seed(
            sqlite_session_factory, "preview", capture_content=capture_content
        )
        node_id = _application_trace_service_boundaries_identifier("preview-node")
        workflow_id = _application_trace_service_boundaries_identifier("preview-definition")
        with case.sessions.begin() as session:
            session.add(make_workflow(workflow_id=workflow_id, tenant_id=case.run.tenant_id, app_id=case.run.app_id))
            node_record = WorkflowNodeExecutionModel(
                id=node_id,
                node_execution_id=node_id,
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                workflow_id=workflow_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
                index=0,
                node_id="agent",
                node_type="agent",
                title="Agent preview",
                inputs='{"secret":"private-input"}',
                outputs='{"answer":"private-output"}',
                process_data="{}",
                status=status,
                elapsed_time=2,
                error="private-model-error" if status == WorkflowNodeExecutionStatus.FAILED else None,
                created_by=_application_trace_service_boundaries_identifier("account"),
                created_by_role=CreatorUserRole.ACCOUNT,
            )
            node_record.created_at = datetime(2026, 1, 1)
            session.add(node_record)
        run = case.repository.start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="node",
            source_id=node_id,
            workflow_id=workflow_id,
            session_id="preview-session",
        )
        assert run is not None
        _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        ).settle_preview(run)
        current = case.repository.get(run.id)
        assert current is not None
        if status == WorkflowNodeExecutionStatus.RUNNING:
            assert current.outer_trace is None
        else:
            assert current.outer_trace is not None
            trace = Trace.model_validate(current.outer_trace)
            root = trace.root
            assert root.span_id == run.root_span_id
            assert root.status.value == ("error" if status == WorkflowNodeExecutionStatus.FAILED else "ok")
            assert ("private-" in trace.model_dump_json()) is capture_content
            assert root.attributes["node_execution_id"] == node_id
            assert (root.end_time - root.start_time).total_seconds() == 2
            if not capture_content and status == WorkflowNodeExecutionStatus.FAILED:
                assert root.error == "Node execution failed"

    @staticmethod
    @pytest.mark.parametrize(
        ("invalid", "code"),
        [
            ("empty", "tracing_invocation_empty"),
            ("foreign_parent", "tracing_invocation_parent_invalid"),
            ("no_invocation_root", "tracing_invocation_root_missing"),
            ("self_parent", "tracing_payload_invalid"),
            ("conflicting_span", "tracing_span_conflict"),
        ],
    )
    def test_invalid_runtime_tree_is_rejected_before_provider_credentials_or_io(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, invalid: str, code: str
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "invalid-runtime")
        batch = _application_trace_service_boundaries_batch_for(case.run, case.invocation())
        if invalid == "empty":
            batch.spans = []
        elif invalid == "foreign_parent":
            batch.spans[0] = batch.spans[0].model_copy(update={"parent_span_id": "f" * 16})
        elif invalid == "no_invocation_root":
            # Every parent is a collected span, but none of them hangs from the invocation.
            batch.spans = [
                batch.spans[0].model_copy(update={"parent_span_id": "b" * 16}),
                batch.spans[0].model_copy(update={"span_id": "b" * 16, "parent_span_id": "a" * 16}),
            ]
        elif invalid == "self_parent":
            batch.spans[0] = batch.spans[0].model_copy(update={"parent_span_id": batch.spans[0].span_id})
        else:
            _application_trace_service_boundaries_ingest(case, batch.model_copy(update={"final": False}))
            batch = batch.model_copy(
                update={
                    "batch_id": uuid4(),
                    "spans": [batch.spans[0].model_copy(update={"name": "conflicting-version"})],
                }
            )
        _application_trace_service_boundaries_ingest(case, batch)
        _application_trace_service_boundaries_terminal(case)

        def forbidden(*_args: object, **_kwargs: object) -> None:
            pytest.fail("invalid trees must fail before credentials or provider requests")

        monkeypatch.setattr(provider_configs_module, "batch_decrypt_token", forbidden)
        monkeypatch.setattr(service_module, "provider_class", forbidden)
        _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        ).deliver(case.run.id)
        current = case.repository.get(case.run.id)
        assert current is not None
        assert current.state == "failed"
        assert current.error_code == code

    @staticmethod
    def test_assemble_requires_a_persisted_business_terminal(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "no-terminal")
        with pytest.raises(TraceCollectionError, match="tracing_terminal_missing"):
            _application_trace_service_boundaries_tracing_service(
                case, _application_trace_service_boundaries_no_egress()
            ).assemble(case.run)

    @staticmethod
    def test_assembled_trace_nests_runtime_spans_under_their_invocation_with_trusted_identity(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "assembled")
        invocation = case.invocation()
        _application_trace_service_boundaries_ingest(
            case, _application_trace_service_boundaries_batch_for(case.run, invocation)
        )
        _application_trace_service_boundaries_terminal(case)
        stored = case.repository.get(case.run.id)
        assert stored is not None
        trace = _application_trace_service_boundaries_tracing_service(
            case, _application_trace_service_boundaries_no_egress()
        ).assemble(stored)
        assert trace.trace_id == case.run.trace_id
        assert trace.session_id == "session-original"
        assert [(span.span_id, span.parent_span_id) for span in trace.spans] == [
            (case.run.root_span_id, None),
            (invocation.span_id, case.run.root_span_id),
            ("a" * 16, invocation.span_id),
        ]
        attempt = trace.spans[1]
        assert attempt.name == "Agent attempt 1"
        assert attempt.attributes["invocation_id"] == invocation.id
        assert (attempt.start_time, attempt.end_time) == (trace.spans[2].start_time, trace.spans[2].end_time)
        for span in trace.spans:
            assert span.attributes["dify.tracing.run_id"] == case.run.id
            assert span.attributes["dify.source.id"] == case.run.source_id
            assert span.attributes["tenant_id"] == case.run.tenant_id


"""Malformed durable traces must never be sent or offered for provider retry."""


_invalid_trace_delivery_batch_for = _application_trace_collection_batch_for
_invalid_trace_delivery_ingest = _application_trace_collection_ingest
_invalid_trace_delivery_no_egress = _application_trace_collection_no_egress
_invalid_trace_delivery_seed = _application_trace_collection_seed
_invalid_trace_delivery_terminal = _application_trace_collection_terminal
_invalid_trace_delivery_tracing_service = _application_trace_collection_tracing_service


class TestInvalidTraceDeliveryCases:
    @staticmethod
    @pytest.mark.parametrize("invalid", ["cycle", "invalid_envelope"])
    def test_invalid_tree_is_permanent_before_decryption_or_provider_io(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, invalid: str
    ) -> None:
        case = _invalid_trace_delivery_seed(sqlite_session_factory, str(uuid4()))
        batch = _invalid_trace_delivery_batch_for(case.run, case.invocation())
        if invalid == "cycle":
            for span_id, parent_id in [("b" * 16, "c" * 16), ("c" * 16, "b" * 16)]:
                batch.spans.append(
                    AgentTraceSpan(
                        trace_id=case.run.trace_id,
                        span_id=span_id,
                        parent_span_id=parent_id,
                        name="cyclic tool",
                        start_time_ns=1_000_000_000,
                        end_time_ns=2_000_000_000,
                        status="ok",
                    )
                )
        _invalid_trace_delivery_ingest(case, batch)
        _invalid_trace_delivery_terminal(case)
        if invalid == "invalid_envelope":
            with case.sessions.begin() as session:
                row = session.get(ApplicationTraceRun, case.run.id)
                assert row is not None
                row.outer_trace = {"corrupt": True}

        def forbidden(*_args: object, **_kwargs: object) -> None:
            pytest.fail("invalid traces must fail before credentials or provider I/O")

        monkeypatch.setattr(provider_configs_module, "batch_decrypt_token", forbidden)
        monkeypatch.setattr(service_module, "provider_class", forbidden)
        _invalid_trace_delivery_tracing_service(case, _invalid_trace_delivery_no_egress()).deliver(case.run.id)
        current = case.repository.get(case.run.id)
        assert current is not None
        assert current.state == "failed"
        assert current.error_code == "tracing_payload_invalid"
        assert current.attempts == 1
        with pytest.raises(TraceCollectionError, match="tracing_retry_not_allowed"):
            case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)


"""Node logs resolve the caller's trace using SQL or configured LogStore ownership."""


_ApplicationTraceNodeAliasCollection = _ApplicationTraceCollectionCollection
_application_trace_node_alias_batch_for = _application_trace_collection_batch_for
_application_trace_node_alias_claim = _application_trace_collection_claim
_application_trace_node_alias_identifier = _application_trace_collection_identifier
_application_trace_node_alias_ingest = _application_trace_collection_ingest
_application_trace_node_alias_no_egress = _application_trace_collection_no_egress
_application_trace_node_alias_seed = _application_trace_collection_seed
_application_trace_node_alias_terminal = _application_trace_collection_terminal
_application_trace_node_alias_tracing_service = _application_trace_collection_tracing_service


@dataclass
class NodeAlias:
    case: _ApplicationTraceNodeAliasCollection
    node: dict[str, object]
    workflow: dict[str, object]
    requests: list[str]
    logstore: bool

    def service(self) -> ApplicationTracingService:
        return _application_trace_node_alias_tracing_service(self.case, _application_trace_node_alias_no_egress())

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
                agent_id=_application_trace_node_alias_identifier("referenced-agent"),
                node_execution_id=str(self.node["id"]),
                attempt=attempt,
                call_key=f"attempt-{attempt}",
            )
            _application_trace_node_alias_ingest(
                self.case,
                _application_trace_node_alias_batch_for(self.case.run, invocation, span_id=str(attempt + 1) * 16),
            )
            span_urls[invocation.span_id] = f"https://provider.test/span/{attempt}"
        _application_trace_node_alias_terminal(self.case)
        lease = _application_trace_node_alias_claim(self.case)
        assert lease is not None
        self.case.repository.complete(
            self.case.run.id,
            lease[1],
            state="accepted",
            result=SendResult(
                trace_id="provider-trace",
                trace_url="https://provider.test/trace",
                span_urls=span_urls if spans else {},
            ),
        )
        return "https://provider.test/trace", "https://provider.test/span/1"


class TestApplicationTraceNodeAliasCases:
    @staticmethod
    @pytest.fixture(params=["sql", "logstore"])
    def alias(
        request: pytest.FixtureRequest,
        sqlite_engine: Engine,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> Iterator[NodeAlias]:
        case = _application_trace_node_alias_seed(sqlite_session_factory, "node-alias")
        with case.sessions.begin() as session:
            app = session.get(App, case.run.app_id)
            assert app is not None
            app.mode = AppMode.WORKFLOW
        common: dict[str, object] = {
            "tenant_id": case.run.tenant_id,
            "app_id": case.run.app_id,
            "workflow_id": _application_trace_node_alias_identifier("definition"),
            "created_by": _application_trace_node_alias_identifier("actor"),
            "created_at": naive_utc_now().isoformat(),
            "status": "succeeded",
        }
        workflow = {
            **common,
            "id": _application_trace_node_alias_identifier("workflow-source"),
            "graph": json.dumps({"nodes": []}),
        }
        node = {
            **common,
            "id": _application_trace_node_alias_identifier("node-source"),
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
                assert f'id:"{_application_trace_node_alias_identifier("node-source")}"' in query.replace(": ", ":")
                assert f"tenant_id = '{case.run.tenant_id}'" in sql
                assert f"id = '{_application_trace_node_alias_identifier('node-source')}'" in sql
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
                _ApplicationTraceNodeAliasCollection(case.repository, case.sessions, run),
                node,
                workflow,
                requests,
                request.param == "logstore",
            )
        finally:
            event.remove(sqlite_engine, "begin", begun)
            event.remove(sqlite_engine, "commit", ended)
            event.remove(sqlite_engine, "rollback", ended)

    @staticmethod
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

    @staticmethod
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
            _application_trace_node_alias_terminal(alias.case)
            lease = _application_trace_node_alias_claim(alias.case)
            assert lease is not None
            alias.case.repository.complete(
                alias.case.run.id,
                lease[1],
                state="accepted",
                result=SendResult(trace_id="outer-only", trace_url="https://provider.test/outer", span_urls={}),
            )
        status = alias.status()
        assert status["status"] == ("accepted" if accepted else "collecting")
        assert status["span_url"] is None
        assert status["capture_agent"] is capture_agent
        assert status["trace_url"] == ("https://provider.test/outer" if accepted else None)

    @staticmethod
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

    @staticmethod
    def test_explicit_other_node_filter_cannot_select_sibling_span(
        alias: NodeAlias, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        sibling = alias.case.repository.invocation(
            run_id=alias.case.run.id,
            agent_id=_application_trace_node_alias_identifier("referenced-agent"),
            node_execution_id=_application_trace_node_alias_identifier("sibling-node"),
            attempt=0,
            call_key="sibling",
        )
        _application_trace_node_alias_ingest(
            alias.case, _application_trace_node_alias_batch_for(alias.case.run, sibling, span_id="f" * 16)
        )
        alias.accept()
        with pytest.raises(TraceCollectionError, match="tracing_node_not_found") as error:
            alias.status(_application_trace_node_alias_identifier("sibling-node"))
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
                node_execution_id=_application_trace_node_alias_identifier("sibling-node"),
                acknowledge_possible_duplicates=True,
            )
        assert not scheduled

    @staticmethod
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

    @staticmethod
    @pytest.mark.parametrize("source", ["node", "workflow"])
    @pytest.mark.parametrize("field", ["tenant_id", "app_id", "workflow_id"])
    def test_alias_rejects_broken_owner_chain(alias: NodeAlias, source: str, field: str) -> None:
        alias.accept()
        row = alias.node if source == "node" else alias.workflow
        if alias.logstore:
            row[field] = _application_trace_node_alias_identifier("foreign")
        else:
            with alias.case.sessions.begin() as session:
                model = session.get(WorkflowNodeExecutionModel if source == "node" else WorkflowRun, str(row["id"]))
                assert model is not None
                # Keep field assignments explicit so ownership failures are visible.
                if field == "tenant_id":
                    model.tenant_id = _application_trace_node_alias_identifier("foreign")
                elif field == "app_id":
                    model.app_id = _application_trace_node_alias_identifier("foreign")
                else:
                    model.workflow_id = _application_trace_node_alias_identifier("foreign")
        with pytest.raises(TraceCollectionError, match="tracing_source_not_found") as error:
            alias.status()
        assert error.value.status == 404

    @staticmethod
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

    @staticmethod
    def test_owned_alias_without_parent_trace_is_not_collected(alias: NodeAlias) -> None:
        with alias.case.sessions.begin() as session:
            run = session.get(ApplicationTraceRun, alias.case.run.id)
            assert run is not None
            session.delete(run)
        assert alias.status() == {"status": "not_collected", "source_kind": "node", "source_id": alias.node["id"]}


"""Real SQLite state transitions and background renewal for delivery leases.

PostgreSQL row-lock scheduling and the deployed Celery pool still need dev
validation; these tests establish token and acknowledgement semantics.
"""


_ExportLeaseCollection = _ApplicationTraceCollectionCollection
_export_lease_accepted = _application_trace_collection_accepted
_export_lease_batch_for = _application_trace_collection_batch_for
_export_lease_claim = _application_trace_collection_claim
_export_lease_ingest = _application_trace_collection_ingest
_export_lease_install_delivery = _application_trace_collection_install_delivery
_export_lease_seed = _application_trace_collection_seed
_export_lease_terminal = _application_trace_collection_terminal
_export_lease_tracing_service = _application_trace_collection_tracing_service


class _SlowDestination(RecordingEgress):
    """Runs ``during_request`` while the export request is in flight."""

    def __init__(self, replies: list[EgressResponse | Exception], during_request: Callable[[], None]) -> None:
        super().__init__(replies, grpc_target=None)
        self._during_request = during_request

    @override
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        content: bytes | None,
        timeout: float,
        sensitive_url: bool,
    ) -> EgressResponse:
        self._during_request()
        return super().request(
            method, url, headers=headers, content=content, timeout=timeout, sensitive_url=sensitive_url
        )


def result(trace_id: str) -> SendResult:
    return SendResult(trace_id=trace_id, trace_url=None, span_urls={})


def _stored(case: _ExportLeaseCollection) -> ApplicationTraceRun:
    row = case.repository.get(case.run.id)
    assert row is not None
    return row


def _expire(case: _ExportLeaseCollection) -> str:
    leased = _export_lease_claim(case)
    assert leased is not None
    with case.sessions.begin() as session:
        row = session.get(ApplicationTraceRun, case.run.id)
        assert row is not None
        row.export_started_at = naive_utc_now() - timedelta(seconds=60)
        row.export_heartbeat_at = row.export_started_at
    assert _export_lease_claim(case) is None
    assert _stored(case).state == "uncertain"
    return leased[1]


class TestExportLeaseCases:
    @staticmethod
    @pytest.fixture
    def case(sqlite_session_factory: sessionmaker[Session]) -> _ExportLeaseCollection:
        collection = _export_lease_seed(sqlite_session_factory, "lease-test")
        _export_lease_ingest(collection, _export_lease_batch_for(collection.run, collection.invocation()))
        _export_lease_terminal(collection)
        return collection

    @staticmethod
    def test_renewal_keeps_long_export_alive_then_missing_heartbeat_expires(
        case: _ExportLeaseCollection, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        clock = [naive_utc_now()]
        monkeypatch.setattr(repository_module, "naive_utc_now", lambda: clock[0])
        leased = _export_lease_claim(case)
        assert leased is not None
        token = leased[1]
        clock[0] += timedelta(seconds=20)
        assert case.repository.renew_export_lease(case.run.id, token)
        clock[0] += timedelta(seconds=20)
        assert _export_lease_claim(case) is None
        current = _stored(case)
        assert current.state == "exporting"
        assert current.attempts == 1
        assert current.export_started_at is not None
        assert current.export_started_at + timedelta(seconds=30) < clock[0]
        clock[0] += timedelta(seconds=11)
        assert _export_lease_claim(case) is None
        expired = _stored(case)
        assert expired.state == "uncertain"
        assert expired.error_code == "export_lease_expired"
        assert expired.export_token == token
        assert not case.repository.renew_export_lease(case.run.id, token)

    @staticmethod
    def test_old_rows_without_heartbeat_use_started_at(case: _ExportLeaseCollection) -> None:
        leased = _export_lease_claim(case)
        assert leased is not None
        with case.sessions.begin() as session:
            row = session.get(ApplicationTraceRun, case.run.id)
            assert row is not None
            row.export_started_at = naive_utc_now() - timedelta(seconds=60)
            row.export_heartbeat_at = None
        assert _export_lease_claim(case) is None
        current = _stored(case)
        assert current.state == "uncertain"
        assert current.export_token == leased[1]

    @staticmethod
    def test_wrong_token_cannot_renew_or_complete(case: _ExportLeaseCollection) -> None:
        leased = _export_lease_claim(case)
        assert leased is not None
        before = _stored(case)
        assert not case.repository.renew_export_lease(case.run.id, "other-token")
        case.repository.complete(case.run.id, "other-token", state="accepted", result=result("wrong"))
        current = _stored(case)
        assert current.export_token == leased[1]
        assert current.export_heartbeat_at == before.export_heartbeat_at
        assert current.state == "exporting"
        assert current.provider_trace_id is None

    @staticmethod
    def test_late_success_wins_before_manual_retry_and_is_idempotent(case: _ExportLeaseCollection) -> None:
        token = _expire(case)
        confirmed = SendResult(
            trace_id="confirmed",
            trace_url="https://example.com/trace",
            span_urls={"a" * 16: "https://example.com/span"},
        )
        case.repository.complete(case.run.id, token, state="accepted", result=confirmed)
        current = _stored(case)
        assert current.state == "accepted"
        assert current.error_code is None
        assert current.export_token is None
        assert current.accepted_at is not None
        assert current.trace_url == confirmed.trace_url
        assert current.span_urls == {"a" * 16: "https://example.com/span"}
        case.repository.complete(case.run.id, token, state="accepted", result=result("duplicate-ack"))
        assert _stored(case).provider_trace_id == "confirmed"
        with pytest.raises(TraceCollectionError, match="tracing_already_accepted"):
            case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)

    @staticmethod
    def test_manual_retry_revokes_old_heartbeat_and_ack_before_and_after_new_claim(
        case: _ExportLeaseCollection,
    ) -> None:
        old_token = _expire(case)
        case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)
        assert not case.repository.renew_export_lease(case.run.id, old_token)
        case.repository.complete(case.run.id, old_token, state="accepted", result=result("old"))
        assert _stored(case).state == "ready"
        second = _export_lease_claim(case)
        assert second is not None
        assert second[1] != old_token
        case.repository.complete(case.run.id, old_token, state="accepted", result=result("old"))
        current = _stored(case)
        assert current.state == "exporting"
        assert current.export_token == second[1]
        assert current.provider_trace_id is None
        case.repository.complete(case.run.id, second[1], state="accepted", result=result("new"))
        assert _stored(case).provider_trace_id == "new"

    @staticmethod
    @pytest.mark.parametrize("late_state", ["failed", "retrying", "uncertain"])
    def test_late_non_success_cannot_overwrite_lease_expiry(case: _ExportLeaseCollection, late_state: str) -> None:
        token = _expire(case)
        case.repository.complete(case.run.id, token, state=late_state, error_code="late-failure")
        current = _stored(case)
        assert current.state == "uncertain"
        assert current.error_code == "export_lease_expired"

    @staticmethod
    def test_other_uncertain_reason_cannot_be_promoted_by_late_ack(case: _ExportLeaseCollection) -> None:
        token = _expire(case)
        with case.sessions.begin() as session:
            row = session.get(ApplicationTraceRun, case.run.id)
            assert row is not None
            row.error_code = "provider_acceptance_unknown"
        case.repository.complete(case.run.id, token, state="accepted", result=result("late"))
        assert _stored(case).state == "uncertain"

    @staticmethod
    @pytest.mark.parametrize("transient_failure", [False, True])
    @pytest.mark.parametrize(
        ("outcome", "reply"),
        [
            ("accepted", response(200, {"trace_id": "ack"})),
            ("uncertain", EgressError("lost acknowledgement", request_sent=True)),
        ],
    )
    def test_service_heartbeats_during_export_and_stops_on_every_outcome(
        case: _ExportLeaseCollection,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        transient_failure: bool,
        outcome: str,
        reply: EgressResponse | Exception,
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_EXPORT_LEASE_SECONDS=1)
        clock = [naive_utc_now()]
        monkeypatch.setattr(repository_module, "naive_utc_now", lambda: clock[0])
        _export_lease_install_delivery(monkeypatch)
        renewed = threading.Event()
        calls: list[int] = []
        original = case.repository.renew_export_lease

        def renew(run_id: str, token: str) -> bool:
            calls.append(threading.get_ident())
            if transient_failure and len(calls) == 1:
                raise RuntimeError("private-provider-value")
            renewal = original(run_id, token)
            renewed.set()
            return renewal

        monkeypatch.setattr(case.repository, "renew_export_lease", renew)
        observed: list[tuple[bool, bool, str]] = []

        def while_exporting() -> None:
            # The original start time is now beyond the lease; only a real background
            # transaction can prevent a second claimant from marking it uncertain.
            clock[0] += timedelta(seconds=3)
            heartbeat_committed = renewed.wait(3)
            second_claim = case.repository.claim(case.run.id, collection_timeout=60, lease_seconds=1)
            observed.append((heartbeat_committed, second_claim is None, _stored(case).state))

        _export_lease_tracing_service(case, _SlowDestination([reply], while_exporting)).deliver(case.run.id)
        assert observed == [(True, True, "exporting")]
        assert _stored(case).state == outcome
        assert calls
        assert all(thread_id != threading.get_ident() for thread_id in calls)
        assert not any(thread.name == f"application-trace-lease-{case.run.id}" for thread in threading.enumerate())
        assert "private-provider-value" not in caplog.text

    @staticmethod
    def test_heartbeat_stops_even_when_completion_database_write_raises(
        case: _ExportLeaseCollection, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _export_lease_install_delivery(monkeypatch)

        def fail_complete(*_args: object, **_kwargs: object) -> None:
            raise RuntimeError("database unavailable")

        monkeypatch.setattr(case.repository, "complete", fail_complete)
        with pytest.raises(RuntimeError, match="database unavailable"):
            _export_lease_tracing_service(case, _export_lease_accepted("ack")).deliver(case.run.id)
        assert not any(thread.name == f"application-trace-lease-{case.run.id}" for thread in threading.enumerate())


_application_trace_ownership_seed = _application_trace_collection_seed
_application_trace_ownership_tracing_service = _application_trace_collection_tracing_service


class TestApplicationTraceOwnershipCases:
    @staticmethod
    def test_naming_without_a_message_stays_with_its_agent_app(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = _application_trace_ownership_seed(sqlite_session_factory, "naming")
        service = _application_trace_ownership_tracing_service(case, RecordingEgress([], grpc_target=None))
        record = GenerateNameTraceInfo(
            message_id=None,
            message_data=None,
            inputs="hello",
            outputs="Greeting",
            start_time=datetime(2026, 1, 1),
            end_time=datetime(2026, 1, 1),
            metadata={"app_id": case.run.app_id, "conversation_id": "conversation-1", "trace_event_id": "event-1"},
            conversation_id="conversation-1",
            tenant_id=case.run.tenant_id,
        )

        assert service.capture_terminal(record) is True

    @staticmethod
    def test_runs_frozen_for_an_unavailable_provider_report_no_capabilities() -> None:
        assert ApplicationTracingService._frozen_capabilities("not-a-provider") is None
