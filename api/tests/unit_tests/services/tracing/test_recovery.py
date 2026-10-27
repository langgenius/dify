"""Recover lost terminal notifications from real business rows through the trace assembler."""

import json
from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal, cast, override

import pytest
from cachetools import TTLCache
from dify_agent.protocol import RunEvent
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.errors import EgressError
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent
from dify_trace_sdk.ids import span_id_for
from dify_trace_sdk.model import Trace
from dify_trace_sdk.testing import RecordingEgress, response
from flask import Flask
from sqlalchemy import Engine, delete, inspect, update
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from clients.agent_backend import FakeAgentBackendRunClient, FakeAgentBackendScenario
from core.app.app_config.entities import (
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps import base_app_queue_manager
from core.app.apps.agent_app.app_runner import AgentAppRunner
from core.app.apps.agent_app.session_store import AgentAppSessionScope
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.execution_coordinator import set_app_task_stop_flag
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity, DifyRunContext, InvokeFrom, UserFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    MessageQueueMessage,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueStopEvent,
)
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit, SystemConfiguration
from events.event_handlers import update_provider_when_message_created as receiver
from extensions.ext_database import db
from extensions.tracing import bind_tracing
from graphon.enums import WorkflowExecutionStatus
from graphon.model_runtime.entities.llm_entities import LLMUsage
from libs.datetime_utils import naive_utc_now
from models.account import Account, TenantAccountJoin
from models.application_trace import ApplicationTraceInvocation, ApplicationTraceRun
from models.enums import CreatorUserRole, MessageStatus, WorkflowRunTriggeredFrom
from models.model import App, AppMode, Conversation, Message
from models.workflow import WorkflowRun, WorkflowType
from repositories.application_trace_repository import TraceCollectionError
from services.tracing import recovery, runtime_bridge
from services.tracing.assembly import SourceNotReadyError
from services.tracing.emitter import TraceScopes
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.unit_tests.core.app.apps.agent_app.test_app_runner import (
    _CancelAndWaitFailingClient,
    _ExplodingSessionStore,
    _FakeQueueManager,
    _FakeSessionStore,
    _runner,
    _soul,
    _StoppedQueueManager,
    _UsageCancellationClient,
)
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_accepted as accepted
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_batch_for as batch_for
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_claim as claim
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_identifier as identifier
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_ingest as ingest
from tests.unit_tests.services.tracing.test_service import (
    _application_trace_collection_install_delivery as install_delivery,
)
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_seed as seed
from tests.unit_tests.services.tracing.test_service import (
    _application_trace_collection_tracing_service as tracing_service,
)
from tests.unit_tests.services.tracing.test_service import _ApplicationTraceCollectionCollection as Collection
from tests.unit_tests.services.tracing.test_service import (
    add_app_owner,
    attach_conversation,
    message_record,
    sent_traces,
)


@dataclass
class RecoveryCase:
    collection: Collection
    service: ApplicationTracingService
    now: datetime
    scheduled: list[str]
    destination: RecordingEgress


class _Recorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


class _QueueManager(AppQueueManager):
    """Finite in-memory event source for the consumer's stream dispatch."""

    def __init__(self, messages: list[MessageQueueMessage]) -> None:
        self.messages = messages

    @override
    def listen(self) -> Generator[MessageQueueMessage]:
        yield from self.messages

    @override
    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        raise AssertionError("Stream dispatch must not publish queue events")


def recording_service(
    collection: Collection, destination: RecordingEgress, scheduled: list[str], monkeypatch: pytest.MonkeyPatch
) -> ApplicationTracingService:
    """The ledger the runtime hooks reach; scheduled exports are recorded instead of enqueued."""
    service = tracing_service(collection, destination)
    monkeypatch.setattr(service, "schedule", scheduled.append)
    monkeypatch.setattr(runtime_bridge, "_service", lambda: service)
    return service


def tracing_application(collection: Collection) -> Flask:
    """An application bound like the composition root, with events kept in memory."""
    application = Flask(__name__)
    bind_tracing(
        application,
        scopes=TraceScopes(emitter=_Recorder(), session_factory=collection.sessions, enterprise_enabled=lambda: False),
        hooks=runtime_bridge.RuntimeApplicationTracingHooks(),
    )
    return application


@pytest.fixture
def case(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> RecoveryCase:
    collection = seed(sqlite_session_factory, "recover", capture_content=True)
    attach_conversation(collection, AppMode.AGENT)
    invocation = collection.invocation()
    ingest(collection, batch_for(collection.run, invocation))
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        message = session.get(Message, collection.run.source_id)
        stored_invocation = session.get(ApplicationTraceInvocation, invocation.id)
        assert message is not None
        assert stored_invocation is not None
        message.created_at = now - timedelta(seconds=30)
        message.updated_at = now - timedelta(seconds=10)
        message.answer = "persisted final answer"
        message.provider_response_latency = 1.0
        message.message_tokens = 2
        message.answer_tokens = 1
        stored_invocation.finalized_at = now - timedelta(seconds=10)
    monkeypatch.setattr(type(db), "engine", property(lambda _db: sqlite_engine))
    monkeypatch.setattr(db, "session", scoped_session(sqlite_session_factory))
    monkeypatch.setattr(recovery, "naive_utc_now", lambda: now)
    install_delivery(monkeypatch)
    destination = accepted("provider-id")
    scheduled: list[str] = []
    service = recording_service(collection, destination, scheduled, monkeypatch)
    return RecoveryCase(collection, service, now, scheduled, destination)


def complete_metadata() -> str:
    return json.dumps(
        {
            "annotation_reply": None,
            "retriever_resources": [],
            "reasoning": {},
            "usage": {"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3},
        }
    )


def save_agent_stop(
    case: RecoveryCase,
    monkeypatch: pytest.MonkeyPatch,
    answer: str,
    *,
    mode: AppMode = AppMode.AGENT,
    consumer_session: Session | None = None,
    process_stream: bool = False,
    notify: Callable[[Message, ChatAppGenerateEntity], None] | None = None,
) -> list[TraceEvent]:
    """Run the real consumer save against the owned SQL rows; returns the trace events it emitted."""
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)

    def send(message: Message, *, application_generate_entity: ChatAppGenerateEntity) -> None:
        if notify is not None:
            notify(message, application_generate_entity)

    monkeypatch.setattr("core.app.task_pipeline.easy_ui_based_generate_task_pipeline.message_was_created.send", send)
    monkeypatch.setattr(
        "core.app.task_pipeline.easy_ui_based_generate_task_pipeline.naive_utc_now",
        lambda: case.now - timedelta(seconds=10),
    )
    with case.collection.sessions.begin() as session:
        persisted = session.get(Message, case.collection.run.source_id)
        assert persisted is not None
        if persisted.message_metadata is None:
            persisted.message_metadata = complete_metadata()
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        conversation = session.get(Conversation, message.conversation_id)
        assert conversation is not None
    recorder = _Recorder()
    entity = ChatAppGenerateEntity(
        task_id=identifier("stop-race-task"),
        app_config=EasyUIBasedAppConfig(
            tenant_id=case.collection.run.tenant_id,
            app_id=case.collection.run.app_id,
            app_mode=mode,
            app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
            app_model_config_dict={},
            model=ModelConfigEntity(provider="test-provider", model="test-model"),
            prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
        ),
        model_conf=make_model_config(provider="test-provider", model="test-model", mode="chat"),
        inputs={},
        files=[],
        user_id=identifier("stop-race-user"),
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        trace_scope=TraceScope(
            emitter=recorder,
            tenant_id=case.collection.run.tenant_id,
            app_id=case.collection.run.app_id,
            user_id=identifier("stop-race-user"),
            correlation=TraceCorrelation(
                external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
            ),
        ),
    )
    stop = MessageQueueMessage(
        task_id=entity.task_id,
        app_mode=mode,
        message_id=message.id,
        conversation_id=conversation.id,
        event=QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL),
    )
    pipeline = EasyUIBasedGenerateTaskPipeline(
        entity, _QueueManager([stop] if process_stream else []), conversation, message, stream=True
    )
    pipeline._task_state.llm_result.message.content = answer
    if process_stream:
        # Token estimates and moderation are separate external boundaries;
        # exercise real stream dispatch, SQL save, commit and notification.
        monkeypatch.setattr(pipeline, "_handle_stop", lambda _event: None)
        monkeypatch.setattr(pipeline, "handle_output_moderation_when_task_finished", lambda _answer: None)
        list(pipeline._process_stream_response(publisher=None))
    elif consumer_session is None:
        with case.collection.sessions.begin() as session:
            pipeline._save_message(session=session, preserve_existing_usage=True)
    else:
        pipeline._save_message(session=consumer_session, preserve_existing_usage=True)
        consumer_session.commit()
    return recorder.events


@pytest.mark.parametrize("receiver_fails", [False, True])
def test_stopped_agent_notifies_the_real_provider_receiver_once_after_commit(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch, receiver_fails: bool
) -> None:
    calls: list[str] = []
    provider_updates: list[str] = []
    monkeypatch.setattr(
        receiver,
        "_execute_provider_updates",
        lambda updates: provider_updates.extend(operation.description for operation in updates),
    )

    def notify(message: Message, entity: ChatAppGenerateEntity) -> None:
        # The production session factory does not expire on commit. Check real
        # detached fields used by the actual receiver, not a mocked send order.
        assert inspect(message).detached is True
        assert not inspect(message).expired_attributes
        assert message.answer == "partial answer"
        with case.collection.sessions() as session:
            saved = session.get(Message, message.id)
            assert saved is not None
            assert recovery.agent_stop_requested(saved) is True
            assert saved.answer == message.answer
        system = SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                    quota_used=0,
                    is_valid=True,
                )
            ],
        )
        assert receiver._calculate_quota_usage(message=message, system_configuration=system, model_name="test") == 3
        receiver.handle(message, application_generate_entity=entity)
        calls.append(message.id)
        if receiver_fails:
            raise RuntimeError("receiver failed after commit")

    if receiver_fails:
        with pytest.raises(RuntimeError, match="receiver failed after commit"):
            save_agent_stop(case, monkeypatch, "partial answer", process_stream=True, notify=notify)
    else:
        # The Agent worker reports a stopped Agent run's terminal itself.
        assert save_agent_stop(case, monkeypatch, "partial answer", process_stream=True, notify=notify) == []
    assert calls == [case.collection.run.source_id]
    assert provider_updates == ["basic_last_used_update"]
    with case.collection.sessions() as session:
        saved = session.get(Message, case.collection.run.source_id)
        assert saved is not None
        assert recovery.agent_stop_requested(saved) is True


@pytest.mark.parametrize("answer", ["", "partial answer before stop"])
@pytest.mark.parametrize("outcome", ["succeeded", "failed", "cancelled"])
@pytest.mark.parametrize("delivery", ["accepted", "uncertain"])
def test_stopped_consumer_cannot_freeze_a_terminal_before_the_runtime_worker(
    case: RecoveryCase,
    monkeypatch: pytest.MonkeyPatch,
    answer: str,
    outcome: Literal["succeeded", "failed", "cancelled"],
    delivery: str,
) -> None:
    destination = RecordingEgress(
        [
            response(200, {"trace_id": "provider-id"})
            if delivery == "accepted"
            else EgressError("acknowledgement lost", request_sent=True)
        ],
        grpc_target=None,
    )
    service = recording_service(case.collection, destination, case.scheduled, monkeypatch)
    # Simulate an old queued notification as well as the current consumer save:
    # persisted state, not a detached event payload, must decide who owns the end.
    notification = message_record(service, case.collection)
    queued = save_agent_stop(case, monkeypatch, answer)
    assert service.capture_terminal(notification) is True
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is None, "a stopped SSE save is not the runtime terminal"
    assert queued == []
    assert recovery.recover_terminal(service, stored) is False
    assert case.collection.repository.claim(stored.id, collection_timeout=60, lease_seconds=30) is None
    service.deliver(stored.id)
    assert destination.requests == []

    output = "real runtime answer" if outcome == "succeeded" else None
    service.capture_agent_app_terminal(
        tenant_id=stored.tenant_id,
        app_id=stored.app_id,
        message_id=stored.source_id,
        outcome=outcome,
        output=output,
    )
    terminal = case.collection.repository.get(stored.id)
    assert terminal is not None
    trace = service.assemble(terminal)
    assert trace.root.attributes["message_execution_state"] == outcome
    assert trace.root.status.value == ("ok" if outcome == "succeeded" else "error")
    assert len(trace.spans) == 3

    # A duplicate worker result and late consumer notification cannot rewrite
    # the frozen end or create a second ingestion attempt after acceptance.
    service.deliver(stored.id)
    service.deliver(stored.id)
    assert sent_traces(destination) == [trace]
    frozen = case.collection.repository.get(stored.id)
    assert frozen is not None
    assert frozen.state == delivery
    service.capture_agent_app_terminal(
        tenant_id=stored.tenant_id,
        app_id=stored.app_id,
        message_id=stored.source_id,
        outcome="succeeded" if outcome != "succeeded" else "cancelled",
        output="late result must not replace the accepted envelope",
    )
    assert service.capture_terminal(notification) is True
    unchanged = case.collection.repository.get(stored.id)
    assert unchanged is not None
    assert unchanged.outer_trace == frozen.outer_trace
    assert unchanged.attempts == frozen.attempts == 1
    service.deliver(stored.id)
    assert len(destination.requests) == 1
    with case.collection.sessions() as session:
        message = session.get(Message, stored.source_id)
        assert message is not None
        assert message.status is MessageStatus.NORMAL
        assert message.answer == answer
        assert message.message_tokens == 2
        assert message.answer_tokens == 1


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT])
def test_classic_stopped_consumer_keeps_its_existing_trace_notification(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch, mode: AppMode
) -> None:
    queued = save_agent_stop(case, monkeypatch, "classic partial answer", mode=mode, process_stream=True)
    assert [event.payload for event in queued] == [
        MessageCompleted(message_id=case.collection.run.source_id, conversation_id=identifier("conversation-recover"))
    ]
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        assert "agent_stop_requested" not in json.loads(message.message_metadata or "{}")


def test_worker_usage_flush_preserves_stop_intent_from_a_newer_consumer_save(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The worker's scoped session may already have loaded this Message before
    # the consumer commits its independent stop transaction.
    cached_message = db.session.get(Message, case.collection.run.source_id)
    assert cached_message is not None
    assert cached_message.message_metadata is None
    save_agent_stop(case, monkeypatch, "partial answer")
    AgentAppRunner._persist_message_usage(
        message_id=cached_message.id,
        usage=LLMUsage.from_metadata({"prompt_tokens": 13, "completion_tokens": 8, "total_price": "0.21"}),
    )
    with case.collection.sessions() as session:
        message = session.get(Message, cached_message.id)
        assert message is not None
        assert recovery.agent_stop_requested(message) is True
        assert message.answer == "partial answer"
        assert message.message_tokens == 13
        assert message.answer_tokens == 8
        assert json.loads(message.message_metadata or "{}")["usage"]["total_tokens"] == 21


def test_stop_save_preserves_worker_usage_committed_after_its_cached_message_read(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    with case.collection.sessions.begin() as session:
        initial = session.get(Message, case.collection.run.source_id)
        assert initial is not None
        initial.message_tokens = 0
        initial.answer_tokens = 0
    with case.collection.sessions() as consumer:
        cached = consumer.get(Message, case.collection.run.source_id)
        assert cached is not None
        assert cached.message_tokens == 0
        AgentAppRunner._persist_message_usage(
            message_id=cached.id,
            usage=LLMUsage.from_metadata({"prompt_tokens": 13, "completion_tokens": 8, "total_price": "0.21"}),
        )
        save_agent_stop(case, monkeypatch, "partial answer", consumer_session=consumer)
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        assert recovery.agent_stop_requested(message) is True
        assert message.message_tokens == 13
        assert message.answer_tokens == 8
        assert message.total_price == Decimal("0.21")
        assert json.loads(message.message_metadata or "{}")["usage"]["total_tokens"] == 21


@pytest.mark.parametrize("runtime_outcome", ["succeeded", "failed", "cancelled", "cancel_wait_failed"])
@pytest.mark.parametrize("final_batch_arrived", [False, True])
@pytest.mark.parametrize("snapshot_save_fails", [False, True])
def test_stopped_runner_hands_off_only_an_observed_runtime_terminal(
    case: RecoveryCase,
    monkeypatch: pytest.MonkeyPatch,
    runtime_outcome: str,
    final_batch_arrived: bool,
    snapshot_save_fails: bool,
) -> None:
    save_agent_stop(case, monkeypatch, "partial answer")
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_COLLECTION_TIMEOUT=60)
    pending_invocation = None
    if not final_batch_arrived:
        pending_invocation = case.collection.invocation("awaiting-stop-final-batch")
        ingest(case.collection, batch_for(case.collection.run, pending_invocation, final=False, span_id="b" * 16))
    client = (
        _CancelAndWaitFailingClient()
        if runtime_outcome == "cancel_wait_failed"
        else FakeAgentBackendRunClient(
            scenario=FakeAgentBackendScenario.FAILED
            if runtime_outcome == "failed"
            else FakeAgentBackendScenario.SUCCESS
        )
    )
    if runtime_outcome in {"succeeded", "failed"}:
        # The terminal frame has arrived, but stop is already visible at the
        # next check. Do not discard this known result and ask SDK cancellation
        # to reclassify it (the SDK rejects non-cancelled terminal events).
        arrived_terminal = client._events(client.run_id)[-1]
        monkeypatch.setattr(client, "stream_events", lambda _run_id, **_kwargs: iter([arrived_terminal]))

        def unexpected_cancel(*_args: object, **_kwargs: object) -> None:
            raise AssertionError("a known runtime terminal must not be cancelled again")

        monkeypatch.setattr(client, "cancel_run_and_wait", unexpected_cancel)
    store = _ExplodingSessionStore() if snapshot_save_fails else _FakeSessionStore()
    runner = _runner(client, store)
    run = case.collection.run
    context = DifyRunContext(
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        user_id=identifier("stop-race-user"),
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    scope = AgentAppSessionScope(
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        conversation_id=identifier("conversation-recover"),
        agent_id=identifier("stop-agent"),
        agent_config_snapshot_id=identifier("stop-snapshot"),
        home_snapshot_id=None,
    )
    with tracing_application(case.collection).app_context(), pytest.raises(GenerateTaskStoppedError):
        runner._consume_stream(
            client.run_id,
            dify_context=context,
            message_id=run.source_id,
            queue_manager=cast(AppQueueManager, _StoppedQueueManager()),
            model_name="test-model",
            query="test query",
            session_scope=scope,
            binding_id=identifier("stop-binding"),
        )
    frozen = case.collection.repository.get(run.id)
    assert frozen is not None
    if runtime_outcome == "cancel_wait_failed":
        assert frozen.outer_trace is None
        assert store.saved == []
        monkeypatch.setattr(recovery, "naive_utc_now", lambda: case.now + timedelta(seconds=120))
        assert recovery.recover_terminal(case.service, frozen) is False
        expired = case.collection.repository.get(run.id)
        assert expired is not None
        assert expired.state == "failed"
        assert expired.error_code == (
            "business_terminal_not_persisted" if final_batch_arrived else "agent_trace_collection_incomplete"
        )
        return
    assert frozen.outer_trace is not None
    trace = case.service.assemble(frozen)
    assert trace.root.attributes["message_execution_state"] == runtime_outcome
    assert trace.root.status.value == ("ok" if runtime_outcome == "succeeded" else "error")
    assert len(store.saved) == (0 if snapshot_save_fails else 1)
    if pending_invocation is not None:
        assert case.collection.repository.claim(run.id, collection_timeout=60, lease_seconds=30) is None
        case.service.deliver(run.id)
        assert case.destination.requests == []
        ingest(case.collection, batch_for(run, pending_invocation, final=True, span_id="b" * 16))
    case.service.deliver(run.id)
    case.service.deliver(run.id)
    exported = sent_traces(case.destination)
    assert len(exported) == 1
    assert len(exported[0].spans) == (3 if final_batch_arrived else 5)
    accepted_run = case.collection.repository.get(run.id)
    assert accepted_run is not None
    assert accepted_run.state == "accepted"
    assert accepted_run.attempts == 1
    with case.collection.sessions() as session:
        message = session.get(Message, run.source_id)
        assert message is not None
        assert message.answer == "partial answer"
        assert recovery.agent_stop_requested(message) is True


@pytest.mark.parametrize("incomplete", [False, True])
def test_missing_runtime_stop_terminal_converges_without_inventing_success(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch, incomplete: bool
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_COLLECTION_TIMEOUT=60)
    save_agent_stop(case, monkeypatch, "partial answer")
    if incomplete:
        invocation = case.collection.invocation("still-collecting")
        ingest(case.collection, batch_for(case.collection.run, invocation, final=False, span_id="b" * 16))
    monkeypatch.setattr(recovery, "naive_utc_now", lambda: case.now + timedelta(seconds=120))
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.state == "failed"
    assert stored.error_code == (
        "agent_trace_collection_incomplete" if incomplete else "business_terminal_not_persisted"
    )
    assert stored.outer_trace is None
    assert case.collection.repository.claim(stored.id, collection_timeout=60, lease_seconds=30) is None


@pytest.mark.parametrize("stop_on_end", [False, True])
def test_stop_during_final_queue_publication_preserves_the_already_observed_success(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch, stop_on_end: bool
) -> None:
    save_agent_stop(case, monkeypatch, "partial answer")
    # Only Redis storage is in memory. Use the real queue's publish stop check
    # rather than an already-stopped fake consumer or an exception-only stub.
    flags: dict[str, object] = {}
    monkeypatch.setattr(base_app_queue_manager.redis_client, "get", flags.get)
    monkeypatch.setattr(
        base_app_queue_manager.redis_client, "setex", lambda key, _ttl, value: flags.__setitem__(key, value)
    )
    monkeypatch.setattr(
        "core.app.apps.agent_app.runtime_request_builder.resolve_model_context_window", lambda **_kwargs: None
    )
    task_id = identifier("stop-at-final-publish")
    queue_manager = MessageBasedAppQueueManager(
        task_id=task_id,
        user_id=identifier("stop-race-user"),
        invoke_from=InvokeFrom.DEBUGGER,
        conversation_id=identifier("conversation-recover"),
        app_mode=AppMode.AGENT,
        message_id=case.collection.run.source_id,
    )
    clock = [0.0]
    queue_manager._stopped_cache = TTLCache(maxsize=1, ttl=1, timer=lambda: clock[0])
    store = _FakeSessionStore()
    runner = _runner(FakeAgentBackendRunClient(), store)
    original_publish = queue_manager._publish

    def publish_after_stop(event: AppQueueEvent, pub_from: PublishFrom) -> None:
        if isinstance(event, QueueMessageEndEvent if stop_on_end else QueueLLMChunkEvent):
            set_app_task_stop_flag(task_id)
            clock[0] = 2.0  # Expire the real queue's earlier cached false result.
        original_publish(event, pub_from)

    monkeypatch.setattr(queue_manager, "_publish", publish_after_stop)
    run = case.collection.run
    context = DifyRunContext(
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        user_id=identifier("stop-race-user"),
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    with tracing_application(case.collection).app_context(), pytest.raises(GenerateTaskStoppedError):
        runner.run(
            dify_context=context,
            agent_id=identifier("stop-agent"),
            agent_config_snapshot_id=identifier("stop-snapshot"),
            agent_soul=_soul(),
            home_snapshot_id=None,
            conversation_id=identifier("conversation-recover"),
            query="test query",
            message_id=run.source_id,
            model_name="test-model",
            queue_manager=queue_manager,
        )
    published = queue_manager._q.get_nowait()
    assert isinstance(published, MessageQueueMessage)
    assert isinstance(published.event, QueueLLMChunkEvent)
    if stop_on_end:
        published_end = queue_manager._q.get_nowait()
        assert isinstance(published_end, MessageQueueMessage)
        assert isinstance(published_end.event, QueueMessageEndEvent)
    frozen = case.collection.repository.get(run.id)
    assert frozen is not None
    assert frozen.outer_trace is not None, "success arrived before the final queue publication saw Stop"
    root = Trace.model_validate(frozen.outer_trace).root
    assert root.attributes["message_execution_state"] == "succeeded"
    assert root.status.value == "ok"
    assert len(store.saved) == 1


@pytest.mark.parametrize("stop_during_cleanup", [False, True])
def test_runtime_cleanup_cancellation_does_not_reclassify_a_business_stream_failure(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch, stop_during_cleanup: bool
) -> None:
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    client = _UsageCancellationClient()
    queue_manager = _FakeQueueManager()

    def disconnected_stream(*_args: object, **_kwargs: object) -> Iterator[RunEvent]:
        raise RuntimeError("stream transport failed")

    monkeypatch.setattr(client, "stream_events", disconnected_stream)
    if stop_during_cleanup:
        original_cancel = client.cancel_run_and_wait

        def cancel_then_stop(*_args: object, **_kwargs: object) -> RunEvent:
            terminal = original_cancel(client.run_id)
            queue_manager.request_stop()
            return terminal

        monkeypatch.setattr(client, "cancel_run_and_wait", cancel_then_stop)
    store = _FakeSessionStore()
    runner = _runner(client, store)
    run = case.collection.run
    context = DifyRunContext(
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        user_id=identifier("cleanup-user"),
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    scope = AgentAppSessionScope(
        tenant_id=run.tenant_id,
        app_id=run.app_id,
        conversation_id=identifier("conversation-recover"),
        agent_id=identifier("cleanup-agent"),
        agent_config_snapshot_id=identifier("cleanup-snapshot"),
        home_snapshot_id=None,
    )
    with tracing_application(case.collection).app_context():
        with pytest.raises(GenerateTaskStoppedError if stop_during_cleanup else RuntimeError):
            runner._consume_stream(
                client.run_id,
                dify_context=context,
                message_id=run.source_id,
                queue_manager=cast(AppQueueManager, queue_manager),
                model_name="test-model",
                query="test query",
                session_scope=scope,
                binding_id=identifier("cleanup-binding"),
            )
        if not stop_during_cleanup:
            # This is the generator's existing generic exception handoff. A
            # cleanup child-run cancellation must not win the application root.
            runtime_bridge.capture_agent_app_terminal(
                tenant_id=run.tenant_id,
                app_id=run.app_id,
                message_id=run.source_id,
                outcome="failed",
                output=None,
            )
    frozen = case.collection.repository.get(run.id)
    assert frozen is not None
    assert frozen.outer_trace is not None
    root = Trace.model_validate(frozen.outer_trace).root
    assert root.attributes["message_execution_state"] == ("cancelled" if stop_during_cleanup else "failed")
    assert root.status.value == "error"
    assert len(store.saved) == 1
    with case.collection.sessions() as session:
        message = session.get(Message, run.source_id)
        assert message is not None
        assert message.message_tokens == 13
        assert message.answer_tokens == 8
        assert message.total_price == Decimal("0.21")
    case.service.deliver(run.id)
    case.service.deliver(run.id)
    delivered = case.collection.repository.get(run.id)
    assert delivered is not None
    assert delivered.state == "accepted"
    assert delivered.attempts == 1
    assert len(case.destination.requests) == 1


@pytest.mark.parametrize("capture_agent", [False, True])
def test_missing_stop_worker_without_runtime_spans_also_reaches_a_delivery_failure(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch, capture_agent: bool
) -> None:
    collection = seed(case.collection.sessions, f"stop-without-spans-{capture_agent}", capture_agent=capture_agent)
    attach_conversation(collection, AppMode.AGENT)
    scheduled: list[str] = []
    destination = RecordingEgress([], grpc_target=None)
    stopped = RecoveryCase(
        collection,
        recording_service(collection, destination, scheduled, monkeypatch),
        case.now,
        scheduled,
        destination,
    )
    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_COLLECTION_TIMEOUT=60)
    save_agent_stop(stopped, monkeypatch, "")
    monkeypatch.setattr(recovery, "naive_utc_now", lambda: case.now + timedelta(seconds=120))
    assert recovery.recover_terminal(stopped.service, collection.run) is False
    stored = collection.repository.get(collection.run.id)
    assert stored is not None
    assert stored.state == "failed"
    assert stored.error_code == "business_terminal_not_persisted"
    assert stored.outer_trace is None


@pytest.mark.parametrize("outcome", ["succeeded", "cancelled", "failed"])
def test_worker_terminal_survives_closed_sse_without_inventing_a_message_write(
    case: RecoveryCase, outcome: Literal["succeeded", "failed", "cancelled"]
) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = json.dumps({"usage": {"prompt_tokens": 2, "completion_tokens": 1}})
        message.answer = ""
    # A runtime final/usage flush still does not imply that an API message ended.
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    output = "actual worker result" if outcome == "succeeded" else None
    case.service.capture_agent_app_terminal(
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        message_id=case.collection.run.source_id,
        outcome=outcome,
        output=output,
    )
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    root = Trace.model_validate(stored.outer_trace).root
    assert root.attributes["message_execution_state"] == outcome
    assert root.status.value == ("ok" if outcome == "succeeded" else "error")
    assert root.outputs == (output or "")
    assert case.scheduled == [stored.id]
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        assert message.answer == ""
        assert message.message_metadata is not None
        assert set(json.loads(message.message_metadata)) == {"usage"}


def test_worker_terminal_revalidates_message_tenant(case: RecoveryCase) -> None:
    with pytest.raises(TraceCollectionError, match="tracing_source_not_found"):
        case.service.capture_agent_app_terminal(
            tenant_id=identifier("foreign-tenant"),
            app_id=case.collection.run.app_id,
            message_id=case.collection.run.source_id,
            outcome="succeeded",
            output="must not export",
        )
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is None


def test_recovers_real_message_terminal_once_through_the_assembler(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = complete_metadata()
        message.updated_at = case.now - timedelta(seconds=11)
    assert recovery.recover_terminal(case.service, case.collection.run) is True
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is not None
    assert stored.outer_trace["session_id"] == "session-original"
    assert stored.outer_trace["spans"][0]["outputs"] == "persisted final answer"
    assert recovery.recover_terminal(case.service, stored) is False
    assert case.scheduled == [stored.id]
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        assert message.message_tokens == 2
        assert message.answer_tokens == 1
        assert message.answer == "persisted final answer"


def test_deliver_recovers_and_exports_once_after_terminal_queue_loss(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = complete_metadata()
        message.updated_at = case.now - timedelta(seconds=11)
    case.service.deliver(case.collection.run.id)
    case.service.deliver(case.collection.run.id)
    exported = sent_traces(case.destination)
    assert len(exported) == 1
    assert exported[0].spans[0].outputs == "persisted final answer"
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.state == "accepted"
    assert stored.provider_trace_id == "provider-id"
    assert stored.attempts == 1


def test_early_usage_commit_is_not_treated_as_a_final_answer(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = json.dumps({"usage": {"prompt_tokens": 2, "completion_tokens": 1}})
        message.answer = ""
        message.updated_at = case.now - timedelta(seconds=11)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is None
    assert stored.state == "collecting"
    assert not case.scheduled


def test_final_without_business_commit_times_out_as_failed_not_success(case: RecoveryCase) -> None:
    invocations, _ = case.collection.repository.collected(case.collection.run.id)
    with case.collection.sessions.begin() as session:
        invocation = session.get(ApplicationTraceInvocation, invocations[0].id)
        assert invocation is not None
        invocation.finalized_at = case.now - timedelta(hours=1)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.state == "failed"
    assert stored.error_code == "business_terminal_not_persisted"
    assert stored.outer_trace is None


def test_final_settle_window_and_all_invocations_must_finish(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = complete_metadata()
        message.updated_at = case.now - timedelta(seconds=1)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    second = case.collection.invocation("pending-second")
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.updated_at = case.now - timedelta(seconds=10)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    with case.collection.sessions() as session:
        invocation = session.get(ApplicationTraceInvocation, second.id)
        assert invocation is not None
        assert invocation.finalized is False


def test_explicit_message_failure_can_recover_without_fabricating_usage(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.status = MessageStatus.ERROR
        message.error = "model initialization failed"
        message.answer = ""
        message.message_metadata = None
        message.message_tokens = 0
        message.answer_tokens = 0
        message.updated_at = case.now - timedelta(seconds=11)
    assert recovery.recover_terminal(case.service, case.collection.run) is True
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is not None
    root = stored.outer_trace["spans"][0]
    assert root["status"] == "error"
    assert root["error"] == "model initialization failed"
    assert root["outputs"] == ""
    # The message's own model call is left to the Agent runtime; the root carries no usage of its own.
    assert [(span["usage"], span["cost"]) for span in stored.outer_trace["spans"]] == [(None, None)]


def test_cross_tenant_source_is_rejected_before_the_assembler_runs(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    with case.collection.sessions.begin() as session:
        app = session.get(App, case.collection.run.app_id)
        assert app is not None
        app.tenant_id = identifier("other-tenant")
    called: list[TraceEvent] = []

    def forbidden(event: TraceEvent) -> None:
        called.append(event)

    monkeypatch.setattr(case.service.assembler, "assemble", forbidden)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    assert called == []
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.error_code == "tracing_source_not_found"


def test_source_not_ready_for_assembly_is_retried_later(case: RecoveryCase, monkeypatch: pytest.MonkeyPatch) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = complete_metadata()
        message.updated_at = case.now - timedelta(seconds=11)
    events: list[TraceEvent] = []

    def not_ready(event: TraceEvent) -> None:
        events.append(event)
        raise SourceNotReadyError

    monkeypatch.setattr(case.service.assembler, "assemble", not_ready)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    assert [event.payload for event in events] == [
        MessageCompleted(message_id=case.collection.run.source_id, conversation_id=identifier("conversation-recover"))
    ]
    assert events[0].correlation.session_id == "session-original"
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert (stored.state, stored.error_code, stored.outer_trace) == ("collecting", None, None)
    assert case.scheduled == []


def test_unresolved_recovery_rotates_behind_unchecked_sources(case: RecoveryCase) -> None:
    other = seed(case.collection.sessions, "other-recovery")
    assert case.collection.repository.pending_ids(limit=1) == [case.collection.run.id]
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    assert case.collection.repository.pending_ids(limit=1) == [other.run.id]
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.state == "collecting"


@pytest.mark.parametrize("status", [MessageStatus.PAUSED, MessageStatus.NORMAL])
def test_no_final_marker_or_paused_message_is_not_recovered(case: RecoveryCase, status: MessageStatus) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.status = status
        message.updated_at = case.now - timedelta(seconds=10)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    assert not case.scheduled


def add_workflow_run(case: RecoveryCase, status: WorkflowExecutionStatus, *, finished: bool, created_by: str) -> str:
    workflow_run_id = identifier("recover-workflow-run")
    workflow_run = WorkflowRun(
        id=workflow_run_id,
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        workflow_id=identifier("workflow"),
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        outputs=json.dumps({"result": "persisted workflow output"}),
        status=status,
        error="actual workflow failure"
        if status in {WorkflowExecutionStatus.FAILED, WorkflowExecutionStatus.STOPPED}
        else None,
        created_by=created_by,
        created_by_role=CreatorUserRole.ACCOUNT,
        finished_at=case.now - timedelta(seconds=10) if finished else None,
        elapsed_time=20,
        total_tokens=0,
        total_steps=0,
    )
    workflow_run.created_at = case.now - timedelta(seconds=30)
    with case.collection.sessions.begin() as session:
        session.add(workflow_run)
    return workflow_run_id


def start_workflow(case: RecoveryCase, workflow_run_id: str) -> ApplicationTraceRun:
    run = case.collection.repository.start(
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        source_kind="workflow",
        source_id=workflow_run_id,
        session_id="workflow-session",
    )
    assert run is not None
    return run


@pytest.mark.parametrize(
    ("status", "finished"),
    [
        (WorkflowExecutionStatus.RUNNING, False),
        (WorkflowExecutionStatus.PAUSED, True),
        (WorkflowExecutionStatus.SUCCEEDED, False),
        (WorkflowExecutionStatus.SUCCEEDED, True),
        (WorkflowExecutionStatus.PARTIAL_SUCCEEDED, True),
        (WorkflowExecutionStatus.FAILED, True),
        (WorkflowExecutionStatus.STOPPED, True),
    ],
)
def test_workflow_recovery_requires_committed_terminal_state(
    case: RecoveryCase, status: WorkflowExecutionStatus, finished: bool
) -> None:
    owner_id = add_app_owner(case.collection, "workflow")
    workflow_run_id = add_workflow_run(case, status, finished=finished, created_by=owner_id)
    run = start_workflow(case, workflow_run_id)
    expected = finished and status in {
        WorkflowExecutionStatus.SUCCEEDED,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
        WorkflowExecutionStatus.FAILED,
        WorkflowExecutionStatus.STOPPED,
    }
    assert recovery.recover_terminal(case.service, run) is expected
    stored = case.collection.repository.get(run.id)
    assert stored is not None
    if expected:
        assert stored.outer_trace is not None
        assert stored.root_span_id == span_id_for(workflow_run_id)
        root = stored.outer_trace["spans"][0]
        assert root["span_id"] == span_id_for(workflow_run_id)
        assert root["outputs"] == {"result": "persisted workflow output"}
        succeeded = status in {WorkflowExecutionStatus.SUCCEEDED, WorkflowExecutionStatus.PARTIAL_SUCCEEDED}
        assert root["status"] == ("ok" if succeeded else "error")
        assert stored.outer_trace["session_id"] == "workflow-session"
        assert stored.outer_trace["user_id"] == owner_id
    else:
        assert stored.outer_trace is None
        assert (stored.state, stored.error_code) == ("collecting", None)


@pytest.mark.parametrize("owner_state", ["no_creator", "missing_account", "not_a_member"])
def test_workflow_recovery_does_not_depend_on_the_app_creator(case: RecoveryCase, owner_state: str) -> None:
    owner_id = add_app_owner(case.collection, "workflow")
    with case.collection.sessions.begin() as session:
        app = session.get(App, case.collection.run.app_id)
        assert app is not None
        if owner_state == "no_creator":
            app.created_by = None
        elif owner_state == "missing_account":
            account = session.get(Account, owner_id)
            assert account is not None
            session.delete(account)
        else:
            session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == owner_id))
    workflow_run_id = add_workflow_run(case, WorkflowExecutionStatus.SUCCEEDED, finished=True, created_by=owner_id)
    run = start_workflow(case, workflow_run_id)
    assert recovery.recover_terminal(case.service, run) is True
    stored = case.collection.repository.get(run.id)
    assert stored is not None
    assert stored.outer_trace is not None
    assert stored.root_span_id == span_id_for(workflow_run_id)


@pytest.mark.parametrize("formatted", [None, "", " \n\t", "{}", "[]", "null", " { } ", "[\n]", {}, []])
@pytest.mark.parametrize("capture_content", [False, True])
def test_early_error_root_preserves_known_query_only_when_content_is_enabled(
    case: RecoveryCase, formatted: object, capture_content: bool
) -> None:
    query = "KNOWN_USER_QUERY_BEFORE_FORMATTED_MESSAGE"
    with case.collection.sessions.begin() as session:
        # Historical rows can contain JSON strings/lists despite the ORM's dict annotation.
        session.execute(
            update(Message.metadata.tables["messages"])
            .where(Message.id == case.collection.run.source_id)
            .values(message=formatted, query=query, answer="")
        )
        run = session.get(ApplicationTraceRun, case.collection.run.id)
        assert run is not None
        run.capture_content = capture_content
    case.service.capture_agent_app_terminal(
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        message_id=case.collection.run.source_id,
        outcome="failed",
        output=None,
    )
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    root = Trace.model_validate(stored.outer_trace).root
    assert root.status.value == "error"
    assert root.attributes["message_execution_state"] == "failed"
    assert root.inputs == ({"query": query} if capture_content else None)
    assert root.outputs == ("" if capture_content else None)
    assembled = case.service.assemble(stored)
    assert (query in assembled.model_dump_json()) is capture_content
    assert all(span.inputs is None for span in assembled.spans if span.span_id != assembled.root.span_id)
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        assert message.message == formatted
        assert message.query == query
        assert message.answer == ""


@pytest.mark.parametrize(
    ("formatted", "expected"),
    [
        (
            {"messages": [{"role": "user", "content": "actual formatted input"}]},
            {"messages": [{"role": "user", "content": "actual formatted input"}]},
        ),
        (
            '{"messages":[{"role":"user","content":"actual formatted input"}]}',
            {"messages": [{"role": "user", "content": "actual formatted input"}]},
        ),
        (
            [{"role": "user", "content": "actual formatted input"}],
            [{"role": "user", "content": "actual formatted input"}],
        ),
        (
            '[{"role":"user","content":"actual formatted input"}]',
            [{"role": "user", "content": "actual formatted input"}],
        ),
        ("opaque non-JSON formatted input", "opaque non-JSON formatted input"),
        ("0", "0"),
        ("false", "false"),
    ],
)
def test_worker_handoff_never_replaces_existing_formatted_inputs(
    case: RecoveryCase, formatted: object, expected: object
) -> None:
    query = "QUERY_MUST_NOT_REPLACE_FORMATTED_INPUTS"
    with case.collection.sessions.begin() as session:
        session.execute(
            update(Message.metadata.tables["messages"])
            .where(Message.id == case.collection.run.source_id)
            .values(message=formatted, query=query, answer="")
        )
    case.service.capture_agent_app_terminal(
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        message_id=case.collection.run.source_id,
        outcome="failed",
        output=None,
    )
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    trace = Trace.model_validate(stored.outer_trace)
    assert trace.root.inputs == expected
    assert query not in trace.model_dump_json()
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        assert message.message == formatted


def test_worker_handoff_does_not_invent_input_when_query_is_empty(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message = {}
        message.query = ""
        message.answer = ""
    case.service.capture_agent_app_terminal(
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        message_id=case.collection.run.source_id,
        outcome="failed",
        output=None,
    )
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert Trace.model_validate(stored.outer_trace).root.inputs == {}


def test_worker_handoff_leaves_a_not_collected_run_untouched(case: RecoveryCase) -> None:
    with case.collection.sessions.begin() as session:
        run = session.get(ApplicationTraceRun, case.collection.run.id)
        assert run is not None
        run.state = "not_collected"
    case.service.capture_agent_app_terminal(
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        message_id=case.collection.run.source_id,
        outcome="succeeded",
        output="answer",
    )
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is None
    assert case.scheduled == []
    assert claim(case.collection) is None
