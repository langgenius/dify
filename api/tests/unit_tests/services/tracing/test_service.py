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
from graphon.enums import WorkflowNodeExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import App, AppMode, Message, TraceAppConfig
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.application_trace_repository import ApplicationTraceRepository, TraceCollectionError
from services.tracing import service as service_module
from services.tracing.provider_dispatch import TraceExportResult, TraceExportUncertainError
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_app, make_message, make_workflow

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
                    "host": "https://langfuse.test",
                    "secret_key": "encrypted-original",
                    "project_url": "https://langfuse.test/project/original",
                },
            )
        )
    repository = ApplicationTraceRepository(sessions)
    run = repository.start(
        tenant_id=tenant_id, app_id=app_id, source_kind="message", source_id=message_id, session_id="session-original"
    )
    assert run is not None
    return _ApplicationTraceCollectionCollection(repository, sessions, run)


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
            collection.run.id, leased[1], state="accepted", result=TraceExportResult("provider-id")
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
        collection.repository.complete(collection.run.id, leased[1], state="accepted", result=TraceExportResult("late"))
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
    @pytest.mark.parametrize("outcome", ["accepted", "uncertain", "retrying"])
    def test_delivery_checkpoint_controls_replays(
        collection: _ApplicationTraceCollectionCollection, monkeypatch: pytest.MonkeyPatch, outcome: str
    ) -> None:
        _application_trace_collection_ingest(
            collection, _application_trace_collection_batch_for(collection.run, collection.invocation())
        )
        _application_trace_collection_terminal(collection)
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

    @staticmethod
    def test_capture_agent_disabled_preserves_outer_only_content_policy(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        case = _application_trace_collection_seed(sqlite_session_factory, "outer-only", capture_agent=False)
        service = ApplicationTracingService(case.repository)
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

    @staticmethod
    def test_deleting_selected_configuration_keeps_historical_destination(
        collection: _ApplicationTraceCollectionCollection,
    ) -> None:
        from machinery.context import RequestContext
        from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
        from services.app_tracing_config_gateway import OpsTraceManagerGateway
        from services.app_tracing_config_service import AppTracingConfigService

        original = collection.run
        service = AppTracingConfigService(
            configs=SQLAlchemyAppTracingConfigRepository(session_factory=collection.sessions),
            provider=OpsTraceManagerGateway(),
        )
        service.delete(RequestContext("request", None, "account", original.tenant_id), original.app_id, "langfuse")
        stored = collection.repository.get(original.id)
        assert stored is not None
        assert stored.provider_config == original.provider_config
        assert stored.provider_config["project_url"] == "https://langfuse.test/project/original"
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
_application_trace_service_boundaries_seed = _application_trace_collection_seed
_application_trace_service_boundaries_terminal = _application_trace_collection_terminal


def source(case: _ApplicationTraceServiceBoundariesCollection) -> dict[str, str]:
    return {
        "tenant_id": case.run.tenant_id,
        "app_id": case.run.app_id,
        "source_kind": "message",
        "source_id": case.run.source_id,
    }


class TestApplicationTraceServiceBoundariesCases:
    @staticmethod
    def test_prepare_invocation_returns_only_opaque_context_and_respects_capture_gate(
        sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "prepare", capture_content=True)
        service = ApplicationTracingService(case.repository)
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
            ApplicationTracingService(case.repository).status(**identity)
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
            config.tracing_config = {"project_url": "https://new.example/project/new", "secret_key": "encrypted-new"}

        def forbidden(*_args: object, **_kwargs: object) -> None:
            pytest.fail("status must not decrypt credentials or resolve current provider metadata")

        monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", forbidden)
        monkeypatch.setattr(service_module.OpsTraceManager, "get_trace_config_project_url", forbidden)
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
            result=TraceExportResult(
                "provider-trace",
                trace_url="https://frozen.example/trace",
                span_urls={invocation.span_id: "https://frozen.example/span"},
            ),
        )
        service = ApplicationTracingService(case.repository)
        result = service.status(**source(case), node_execution_id=node_id)
        assert result["status"] == "accepted"
        assert result["trace_id"] == "provider-trace"
        assert result["span_url"] == "https://frozen.example/span"
        assert result["project_url"] == "https://langfuse.test/project/original"
        assert result["config_revision"] == case.run.config_revision
        assert result["queryable"] is None
        assert result["capture_content"] is False
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
            config.tracing_config = {"project_url": "https://new.example/project/new", "secret_key": "encrypted-new"}
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
        service = ApplicationTracingService(case.repository)
        assert service.status(**source(case))["project_url"] == "https://langfuse.test/project/original"
        assert (
            service.status(**{**source(case), "source_id": new_id})["project_url"] == "https://new.example/project/new"
        )

    @staticmethod
    @pytest.mark.parametrize(
        "project_url",
        [
            None,
            "",
            1,
            "javascript:alert(1)",
            "//example.com/project",
            "https://user:secret@example.com/project",
            "https://@example.com",
            "https://example.com\\@other.test",
            "https://example.com:invalid/project",
            "https://[invalid/project",
            "https://example.com/\nproject",
        ],
    )
    def test_status_hides_unavailable_or_unsafe_frozen_project_urls(
        sqlite_session_factory: sessionmaker[Session], project_url: object
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "invalid-project")
        with case.sessions.begin() as session:
            run = session.get(ApplicationTraceRun, case.run.id)
            assert run is not None
            run.provider_config = {
                "secret_key": "encrypted-original",
                **({"project_url": project_url} if project_url is not None else {}),
            }
        result = ApplicationTracingService(case.repository).status(**source(case))
        assert result["project_url"] is None
        assert "encrypted-original" not in str(result)

    @staticmethod
    @pytest.mark.parametrize("provider", ["aliyun", "tencent"])
    def test_status_does_not_present_platform_console_as_project(
        sqlite_session_factory: sessionmaker[Session], provider: str
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "platform-console")
        with case.sessions.begin() as session:
            run = session.get(ApplicationTraceRun, case.run.id)
            assert run is not None
            run.provider = provider
            run.provider_config = {"project_url": "https://console.example.com"}
        assert ApplicationTracingService(case.repository).status(**source(case))["project_url"] is None

    @staticmethod
    @pytest.mark.parametrize("disabled", [True, False])
    def test_uncollected_status_and_missing_run_retry_do_not_construct_provider(
        sqlite_session_factory: sessionmaker[Session], disabled: bool
    ) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "missing", enabled=not disabled)
        if not disabled:
            with case.sessions.begin() as session:
                stored = session.get(ApplicationTraceRun, case.run.id)
                assert stored is not None
                session.delete(stored)
        service = ApplicationTracingService(case.repository)
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
        service = ApplicationTracingService(case.repository)
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
        ("failure", "code"),
        [
            (RetryableTraceDispatchError("private-transport-error"), "provider_retry_exhausted"),
            (ValueError("private-credential-error"), "provider_export_rejected"),
        ],
    )
    def test_delivery_exhaustion_and_rejection_never_log_vendor_details(
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        failure: Exception,
        code: str,
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_MAX_ATTEMPTS=1)
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "delivery")
        _application_trace_service_boundaries_ingest(
            case, _application_trace_service_boundaries_batch_for(case.run, case.invocation())
        )
        _application_trace_service_boundaries_terminal(case)

        def export(*_args: object) -> TraceExportResult:
            raise failure

        monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
        monkeypatch.setattr(service_module, "export_trace", export)
        service = ApplicationTracingService(case.repository)
        service.deliver(case.run.id)
        current = case.repository.get(case.run.id)
        assert current is not None
        assert current.state == "failed"
        assert current.error_code == code
        assert "private-" not in caplog.text
        service.deliver(_application_trace_service_boundaries_identifier("missing-run"))

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
            session.add(
                WorkflowNodeExecutionModel(
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
                    created_at=datetime(2026, 1, 1),
                    created_by=_application_trace_service_boundaries_identifier("account"),
                    created_by_role=CreatorUserRole.ACCOUNT,
                )
            )
        run = case.repository.start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="node",
            source_id=node_id,
            workflow_id=workflow_id,
            session_id="preview-session",
        )
        assert run is not None
        ApplicationTracingService(case.repository).settle_preview(run)
        current = case.repository.get(run.id)
        assert current is not None
        if status == WorkflowNodeExecutionStatus.RUNNING:
            assert current.outer_trace is None
        else:
            assert current.outer_trace is not None
            trace = service_module.CanonicalTrace.model_validate(current.outer_trace)
            root = trace.spans[0]
            assert root.status.value == ("error" if status == WorkflowNodeExecutionStatus.FAILED else "ok")
            assert ("private-" in trace.model_dump_json()) is capture_content
            assert root.metadata["node_execution_id"] == node_id
            if not capture_content and status == WorkflowNodeExecutionStatus.FAILED:
                assert root.error == "Node execution failed"

    @staticmethod
    @pytest.mark.parametrize("owner_state", ["no_creator", "missing_account", "wrong_app"])
    def test_missing_owner_identity_cannot_authorize_trace_expansion(
        sqlite_session_factory: sessionmaker[Session], owner_state: str
    ) -> None:
        from models.model import App

        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "owner")
        with case.sessions.begin() as session:
            app = session.get(App, case.run.app_id)
            assert app is not None
            app.created_by = (
                None
                if owner_state == "no_creator"
                else _application_trace_service_boundaries_identifier("missing-owner")
            )
        app_id = (
            _application_trace_service_boundaries_identifier("another-app")
            if owner_state == "wrong_app"
            else case.run.app_id
        )
        with pytest.raises(TraceCollectionError, match="tracing_owner_not_found"):
            ApplicationTracingService(case.repository)._service_account(case.run, app_id)

    @staticmethod
    @pytest.mark.parametrize(
        ("invalid", "code"),
        [
            ("empty", "tracing_invocation_empty"),
            ("foreign_parent", "tracing_invocation_parent_invalid"),
            ("no_invocation_root", "tracing_invocation_root_missing"),
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
            batch.spans[0] = batch.spans[0].model_copy(update={"parent_span_id": batch.spans[0].span_id})
        else:
            _application_trace_service_boundaries_ingest(case, batch.model_copy(update={"final": False}))
            from uuid import uuid4

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

        monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", forbidden)
        monkeypatch.setattr(service_module, "export_trace", forbidden)
        service = ApplicationTracingService(case.repository)
        service.deliver(case.run.id)
        current = case.repository.get(case.run.id)
        assert current is not None
        assert current.state == "failed"
        assert current.error_code == code

    @staticmethod
    def test_assemble_requires_a_persisted_business_terminal(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = _application_trace_service_boundaries_seed(sqlite_session_factory, "no-terminal")
        with pytest.raises(TraceCollectionError, match="tracing_terminal_missing"):
            ApplicationTracingService(case.repository).assemble(case.run)


"""Malformed durable traces must never be sent or offered for provider retry."""


_invalid_trace_delivery_batch_for = _application_trace_collection_batch_for
_invalid_trace_delivery_ingest = _application_trace_collection_ingest
_invalid_trace_delivery_seed = _application_trace_collection_seed
_invalid_trace_delivery_terminal = _application_trace_collection_terminal


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

        monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", forbidden)
        monkeypatch.setattr(service_module, "export_trace", forbidden)
        ApplicationTracingService(case.repository).deliver(case.run.id)
        current = case.repository.get(case.run.id)
        assert current is not None
        assert current.state == "failed"
        assert current.error_code == "tracing_payload_invalid"
        assert current.attempts == 1
        with pytest.raises(TraceCollectionError, match="tracing_retry_not_allowed"):
            case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)
