"""Exercise collection transactions and delivery state against real SQLite rows."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import pytest
from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceEvent, AgentTraceSpan
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.ops.entities.trace_entity import MessageTraceInfo
from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.enums import ConversationFromSource
from models.model import App, AppMode, Message, TraceAppConfig
from repositories.application_trace_repository import ApplicationTraceRepository, TraceCollectionError
from services.tracing import service as service_module
from services.tracing.provider_dispatch import TraceExportResult, TraceExportUncertainError
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_app, make_message


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
                tracing_config={"host": "https://langfuse.test", "secret_key": "encrypted-original"},
            )
        )
    repository = ApplicationTraceRepository(sessions)
    run = repository.start(
        tenant_id=tenant_id, app_id=app_id, source_kind="message", source_id=message_id, session_id="session-original"
    )
    assert run is not None
    return Collection(repository, sessions, run)


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
    root = CanonicalSpan(
        id=run.root_span_id,
        parent_id=None,
        name="Agent turn",
        kind=CanonicalSpanKind.CHAIN,
        start_time=datetime.fromtimestamp(0, UTC),
        end_time=datetime.fromtimestamp(3, UTC),
        status=CanonicalSpanStatus.OK,
    )
    trace = CanonicalTrace(trace_id=run.trace_id, session_id=run.session_id, root_span_id=root.id, spans=(root,))
    collection.repository.terminal(run.id, trace.model_dump(mode="json"), root.id)


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
        collection.run.id, leased[1], state="accepted", result=TraceExportResult("provider-id")
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
    assert collection.repository.get(collection.run.id).state == "uncertain"
    collection.repository.complete(collection.run.id, leased[1], state="accepted", result=TraceExportResult("late"))
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


@pytest.mark.parametrize("outcome", ["accepted", "uncertain", "retrying"])
def test_delivery_checkpoint_controls_replays(
    collection: Collection, monkeypatch: pytest.MonkeyPatch, outcome: str
) -> None:
    ingest(collection, batch_for(collection.run, collection.invocation()))
    terminal(collection)
    exports: list[tuple[str, dict[str, object], CanonicalTrace]] = []
    decryptions: list[dict[str, object]] = []

    def decrypt(_tenant: str, _provider: str, config: dict[str, object]) -> dict[str, object]:
        decryptions.append(config)
        return {"secret_key": "plaintext-only-in-worker"}

    def export(provider: str, config: dict[str, object], trace: CanonicalTrace) -> TraceExportResult:
        exports.append((provider, config, trace))
        if outcome == "uncertain":
            raise TraceExportUncertainError("ack lost")
        if outcome == "retrying":
            raise RetryableTraceDispatchError("busy")
        return TraceExportResult("vendor-trace", "https://trace.test/example")

    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", decrypt)
    monkeypatch.setattr(service_module, "export_trace", export)
    service = ApplicationTracingService(collection.repository)
    service.deliver(collection.run.id)
    service.deliver(collection.run.id)
    assert len(exports) == 1
    assert decryptions[0]["secret_key"] == "encrypted-original"
    stored = collection.repository.get(collection.run.id)
    assert stored is not None
    assert stored.state == outcome
    assert stored.provider_config["secret_key"] == "encrypted-original"
    assert "plaintext-only-in-worker" not in json.dumps(stored.outer_trace)
    assert exports[0][1]["host"] == "https://langfuse.test"


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
    service = ApplicationTracingService(case.repository)
    assert case.run.state == "not_collected"
    with case.sessions.begin() as session:
        app = session.get(App, case.run.app_id)
        assert app is not None
        app.tracing = json.dumps({"enabled": True, "tracing_provider": "langfuse", "capture_content": True})
        message = session.get(Message, case.run.source_id)
        assert message is not None
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
    info = MessageTraceInfo(
        metadata={},
        message_data=message,
        message_id=message.id,
        conversation_model="agent",
        conversation_mode="agent",
        message_tokens=1,
        answer_tokens=1,
        total_tokens=2,
    )
    assert service.capture_terminal(info) is True
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
    service = ApplicationTracingService(case.repository)
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
    with case.sessions() as session:
        message = session.get(Message, case.run.source_id)
        assert message is not None
    info = MessageTraceInfo(
        metadata={},
        message_data=message,
        message_id=message.id,
        conversation_model="agent",
        conversation_mode="agent",
        message_tokens=1,
        answer_tokens=1,
        total_tokens=2,
        inputs="private input",
        outputs="private output",
    )
    assert service.capture_terminal(info) is True
    assert scheduled == [case.run.id]
    stored = case.repository.get(case.run.id)
    assert stored is not None
    assert stored.outer_trace is not None
    assert "private" not in json.dumps(stored.outer_trace)
    assert len(stored.outer_trace["spans"]) == 1
    invocations, _ = case.repository.collected(case.run.id)
    assert invocations == []
