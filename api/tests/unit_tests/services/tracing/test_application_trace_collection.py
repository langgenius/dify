"""Exercise collection transactions and delivery state against real SQLite rows."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import override
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pytest
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceEvent, AgentTraceSpan
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_sdk.egress import Egress, EgressResponse
from dify_trace_sdk.errors import EgressError
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent, TracePayload
from dify_trace_sdk.exporting import send_export_request
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from dify_trace_sdk.testing import RecordingEgress, response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.enums import ConversationFromSource
from models.model import App, AppMode, Message, TraceAppConfig
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from repositories.application_trace_repository import ApplicationTraceRepository, TraceCollectionError
from services.app_tracing_config_service import AppTracingConfigService
from services.tracing import provider_configs as provider_configs_module
from services.tracing import service as service_module
from services.tracing.assembly import TraceAssembler
from services.tracing.canonical import CanonicalTraceBuilder
from services.tracing.provider_configs import ProviderConfigGateway
from services.tracing.records import MessageTraceInfo
from services.tracing.registry import UnknownTraceProviderError
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_app, make_conversation, make_message, make_tenant


def identifier(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


@dataclass
class Collection:
    repository: ApplicationTraceRepository
    sessions: sessionmaker[Session]
    run: ApplicationTraceRun

    def invocation(self, name: str = "first") -> ApplicationTraceInvocation:
        return self.repository.invocation(
            run_id=self.run.id, agent_id=identifier("agent"), node_execution_id=None, attempt=0, call_key=name
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


def install_delivery(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Deliver Agent traces through ``ScriptedProvider``; returns the ciphertexts decrypted."""

    def provider_class(provider_id: str) -> type[ScriptedProvider]:
        if provider_id != ScriptedProvider.id:
            raise UnknownTraceProviderError(provider_id)
        return ScriptedProvider

    monkeypatch.setattr(service_module, "provider_class", provider_class)
    return install_decryption(monkeypatch)


def accepted(trace_id: str) -> RecordingEgress:
    """An egress whose destination acknowledges exactly one trace."""
    return RecordingEgress([response(200, {"trace_id": trace_id})], grpc_target=None)


def no_egress() -> RecordingEgress:
    """An egress that fails any request the test did not script."""
    return RecordingEgress([], grpc_target=None)


def sent_traces(egress: RecordingEgress) -> list[Trace]:
    return [Trace.model_validate_json(request.content or b"") for request in egress.requests]


def tracing_service(case: Collection, egress: Egress) -> ApplicationTracingService:
    return ApplicationTracingService(
        case.repository,
        assembler=TraceAssembler(case.sessions, files_url="https://files.test", enterprise_details=False),
        builder=CanonicalTraceBuilder(),
        egress=egress,
    )


def seed(
    sessions: sessionmaker[Session],
    name: str,
    *,
    capture_content: bool = False,
    enabled: bool = True,
    capture_agent: bool = True,
) -> Collection:
    app_id, tenant_id, message_id = identifier(f"app-{name}"), identifier("tenant"), identifier(f"message-{name}")
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
    return Collection(repository, sessions, run)


def attach_conversation(case: Collection, mode: AppMode) -> None:
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


def add_app_owner(case: Collection, name: str) -> str:
    """Workflow records are read as the app creator, who must be a member of the app's workspace."""
    owner_id = identifier(f"owner-{name}")
    with case.sessions.begin() as session:
        if session.get(Tenant, case.run.tenant_id) is None:
            session.add(make_tenant(tenant_id=case.run.tenant_id))
        session.add(make_account(account_id=owner_id, email=f"{name}@example.com"))
        session.add(TenantAccountJoin(tenant_id=case.run.tenant_id, account_id=owner_id, role=TenantAccountRole.OWNER))
        app = session.get(App, case.run.app_id)
        assert app is not None
        app.created_by = owner_id
    return owner_id


def trace_event(case: Collection, payload: TracePayload) -> TraceEvent:
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


def message_record(service: ApplicationTracingService, case: Collection) -> MessageTraceInfo:
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


@pytest.fixture
def collection(sqlite_session_factory: sessionmaker[Session]) -> Collection:
    return seed(sqlite_session_factory, "first")


def batch_for(
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


def claim(collection: Collection) -> tuple[ApplicationTraceRun, str] | None:
    return collection.repository.claim(collection.run.id, collection_timeout=60, lease_seconds=30)


def test_batch_duplicate_is_idempotent_after_final_and_acceptance(collection: Collection) -> None:
    invocation = collection.invocation()
    batch = batch_for(collection.run, invocation)
    assert ingest(collection, batch) == (1, collection.run.id)
    assert ingest(collection, batch) == (1, collection.run.id)
    terminal(collection)
    leased = claim(collection)
    assert leased is not None
    collection.repository.complete(
        collection.run.id,
        leased[1],
        state="accepted",
        result=SendResult(trace_id="provider-id", trace_url=None, span_urls={}),
    )
    assert ingest(collection, batch) == (1, collection.run.id)
    stored = collection.repository.get(collection.run.id)
    assert stored is not None
    assert stored.span_count == 1
    with collection.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ApplicationTraceBatch)) == 1


def test_conflicting_batch_id_rolls_back_without_replacing_payload(collection: Collection) -> None:
    batch = batch_for(collection.run, collection.invocation(), final=False)
    ingest(collection, batch)
    changed = batch.model_copy(update={"final": True})
    with pytest.raises(TraceCollectionError, match="tracing_batch_conflict"):
        ingest(collection, changed)
    invocations, batches = collection.repository.collected(collection.run.id)
    assert invocations[0].finalized is False
    assert batches[0].final is False


def test_run_cannot_ingest_another_runs_invocation(collection: Collection) -> None:
    other = seed(collection.sessions, "other")
    foreign = other.invocation()
    forged = batch_for(collection.run, foreign)
    with pytest.raises(TraceCollectionError, match="tracing_invocation_not_found"):
        ingest(collection, forged)
    with collection.sessions() as session:
        assert session.scalar(select(func.count()).select_from(ApplicationTraceBatch)) == 0


def test_payload_limits_reject_whole_transaction(collection: Collection) -> None:
    batch = batch_for(collection.run, collection.invocation())
    with pytest.raises(TraceCollectionError, match="tracing_payload_limit"):
        collection.repository.ingest(batch, max_spans=100, max_bytes=1)
    invocations, batches = collection.repository.collected(collection.run.id)
    assert not batches
    assert invocations[0].finalized is False
    stored = collection.repository.get(collection.run.id)
    assert stored is not None
    assert stored.span_count == 0


def test_wrong_trace_id_is_rejected_before_persistence(collection: Collection) -> None:
    batch = batch_for(collection.run, collection.invocation())
    altered = batch.model_copy(update={"spans": [batch.spans[0].model_copy(update={"trace_id": "f" * 32})]})
    with pytest.raises(TraceCollectionError, match="tracing_trace_id_mismatch"):
        ingest(collection, altered)
    _, batches = collection.repository.collected(collection.run.id)
    assert not batches


def test_content_off_cleans_the_durable_batch_not_only_the_export(collection: Collection) -> None:
    original = batch_for(collection.run, collection.invocation(), final=False)
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
    ingest(collection, batch)
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
        ingest(collection, changed)


def test_invocation_key_replay_must_not_change_agent_binding(collection: Collection) -> None:
    original = collection.invocation()
    repeated = collection.invocation()
    assert original.id == repeated.id
    with pytest.raises(TraceCollectionError, match="tracing_invocation_conflict"):
        collection.repository.invocation(
            run_id=collection.run.id,
            agent_id=identifier("different-agent"),
            node_execution_id=identifier("different-node"),
            attempt=2,
            call_key="first",
        )


def test_claim_waits_for_all_invocations_final_and_then_only_one_lease(collection: Collection) -> None:
    first, second = collection.invocation("first"), collection.invocation("second")
    terminal(collection)
    ingest(collection, batch_for(collection.run, first))
    assert claim(collection) is None
    ingest(collection, batch_for(collection.run, second, span_id="b" * 16))
    leased = claim(collection)
    assert leased is not None
    assert claim(collection) is None
    assert leased[0].attempts == 1


def test_expired_delivery_lease_accepts_confirmed_late_ack_for_same_attempt(collection: Collection) -> None:
    ingest(collection, batch_for(collection.run, collection.invocation()))
    terminal(collection)
    leased = claim(collection)
    assert leased is not None
    with collection.sessions.begin() as session:
        stored = session.get(ApplicationTraceRun, collection.run.id)
        assert stored is not None
        stored.export_started_at = naive_utc_now() - timedelta(seconds=60)
        stored.export_heartbeat_at = stored.export_started_at
    assert claim(collection) is None
    current = collection.repository.get(collection.run.id)
    assert current is not None
    assert current.state == "uncertain"
    collection.repository.complete(
        collection.run.id, leased[1], state="accepted", result=SendResult(trace_id="late", trace_url=None, span_urls={})
    )
    stored = collection.repository.get(collection.run.id)
    assert stored is not None
    assert stored.state == "accepted"
    assert stored.error_code is None
    assert stored.accepted_at is not None
    assert stored.provider_trace_id == "late"
    assert claim(collection) is None


def test_incomplete_final_times_out_without_export(collection: Collection) -> None:
    collection.invocation()
    terminal(collection)
    with collection.sessions.begin() as session:
        stored = session.get(ApplicationTraceRun, collection.run.id)
        assert stored is not None
        stored.terminal_at = naive_utc_now() - timedelta(seconds=120)
    assert claim(collection) is None
    stored = collection.repository.get(collection.run.id)
    assert stored is not None
    assert stored.state == "failed"
    assert stored.error_code == "agent_trace_collection_incomplete"


def test_running_trace_freezes_credentials_content_policy_and_session(collection: Collection) -> None:
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


@pytest.mark.parametrize(
    ("outcome", "reply"),
    [
        ("accepted", response(200, {"trace_id": "vendor-trace", "trace_url": "https://trace.test/example"})),
        ("uncertain", EgressError("acknowledgement lost", request_sent=True)),
        ("retrying", response(503, {})),
    ],
)
def test_delivery_checkpoint_controls_replays(
    collection: Collection, monkeypatch: pytest.MonkeyPatch, outcome: str, reply: EgressResponse | Exception
) -> None:
    ingest(collection, batch_for(collection.run, collection.invocation()))
    terminal(collection)
    ciphertexts = install_delivery(monkeypatch)
    egress = RecordingEgress([reply], grpc_target=None)
    service = tracing_service(collection, egress)
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


def test_source_owner_checks_app_and_tenant(collection: Collection) -> None:
    run = collection.run
    assert (
        collection.repository.start(
            tenant_id=identifier("foreign-tenant"),
            app_id=run.app_id,
            source_kind="message",
            source_id=run.source_id,
            session_id="x",
        )
        is None
    )
    other = seed(collection.sessions, "second-app")
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


def test_disabled_source_decision_stays_disabled_after_config_enable(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    case = seed(sqlite_session_factory, "initially-disabled", enabled=False)
    attach_conversation(case, AppMode.AGENT)
    service = tracing_service(case, no_egress())
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


def test_capture_agent_disabled_preserves_outer_only_content_policy(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    case = seed(sqlite_session_factory, "outer-only", capture_agent=False)
    attach_conversation(case, AppMode.AGENT)
    service = tracing_service(case, no_egress())
    scheduled: list[str] = []
    monkeypatch.setattr(service, "schedule", scheduled.append)
    assert (
        service.prepare_invocation(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            agent_id=identifier("agent"),
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


def test_deleting_selected_configuration_keeps_historical_destination(collection: Collection) -> None:
    original = collection.run
    service = AppTracingConfigService(
        configs=SQLAlchemyAppTracingConfigRepository(session_factory=collection.sessions),
        provider=ProviderConfigGateway(no_egress()),
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
