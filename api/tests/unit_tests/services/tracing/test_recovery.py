"""Recover lost terminal notifications using real business rows and TraceTask."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from core.app.entities.app_invoke_entities import ChatAppGenerateEntity
from core.ops.ops_trace_manager import TraceTask
from core.ops.unified_trace.entities import CanonicalTrace
from extensions.ext_database import db
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceInvocation
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus, WorkflowRunTriggeredFrom
from models.model import App, AppMode, Message
from models.workflow import WorkflowRun, WorkflowType
from services.tracing import recovery
from services.tracing import service as service_module
from services.tracing.normalization import span_id
from services.tracing.provider_dispatch import TraceExportResult, TraceExportUncertainError
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.model_factories import make_account, make_conversation
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_batch_for as batch_for
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_identifier as identifier
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_ingest as ingest
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_seed as seed
from tests.unit_tests.services.tracing.test_service import _ApplicationTraceCollectionCollection as Collection


@dataclass
class RecoveryCase:
    collection: Collection
    service: ApplicationTracingService
    now: datetime
    scheduled: list[str]


def attach_conversation(case: Collection) -> None:
    with case.sessions.begin() as session:
        message = session.get(Message, case.run.source_id)
        assert message is not None
        session.add(
            make_conversation(
                conversation_id=message.conversation_id,
                app_id=case.run.app_id,
                mode=AppMode.AGENT,
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
            )
        )


@pytest.fixture
def case(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> RecoveryCase:
    collection = seed(sqlite_session_factory, "recover", capture_content=True)
    attach_conversation(collection)
    invocation = collection.invocation()
    ingest(collection, batch_for(collection.run, invocation))
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        message = session.get(Message, collection.run.source_id)
        assert message is not None
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
    monkeypatch.setattr(TraceTask, "_workflow_run_repo", None)
    monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)
    monkeypatch.setattr(recovery, "naive_utc_now", lambda: now)
    service = ApplicationTracingService(collection.repository)
    scheduled: list[str] = []
    monkeypatch.setattr(service, "schedule", scheduled.append)
    return RecoveryCase(collection, service, now, scheduled)


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
) -> list[TraceTask]:
    """Run the real consumer save and tracing queue against the owned SQL rows."""
    import queue

    from flask import Flask

    from core.app.app_config.entities import (
        EasyUIBasedAppConfig,
        EasyUIBasedAppModelConfigFrom,
        ModelConfigEntity,
        PromptTemplateEntity,
    )
    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.app.entities.queue_entities import QueueStopEvent
    from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
    from core.ops import ops_trace_manager
    from core.ops.base_trace_instance import bind_application_tracing_hooks
    from services.tracing import runtime_bridge
    from tests.helpers.unit.config_override import apply_config_overrides
    from tests.helpers.unit.core.model_fixtures import make_model_config
    from tests.unit_tests.core.app.task_pipeline.test_easy_ui_based_generate_task_pipeline import (
        _QueueManager,
        queue_message,
    )

    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    monkeypatch.setattr(runtime_bridge, "_service", lambda: case.service)
    monkeypatch.setattr(ops_trace_manager, "trace_manager_queue", queue.Queue())
    monkeypatch.setattr(ops_trace_manager.TraceQueueManager, "start_timer", lambda _manager: None)

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
        conversation = session.get(service_module.Conversation, message.conversation_id)
        assert conversation is not None
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
    )
    queue_manager = _QueueManager()
    pipeline = EasyUIBasedGenerateTaskPipeline(entity, queue_manager, conversation, message, stream=True)
    pipeline._task_state.llm_result.message.content = answer
    application = Flask(__name__)
    bind_application_tracing_hooks(application, runtime_bridge.RuntimeApplicationTracingHooks())
    with application.app_context():
        trace_manager = ops_trace_manager.TraceQueueManager(app_id=case.collection.run.app_id)
        if process_stream:
            queue_manager.messages = [queue_message(QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL))]
            # Token estimates and moderation are separate external boundaries;
            # exercise real stream dispatch, SQL save, commit and notification.
            monkeypatch.setattr(pipeline, "_handle_stop", lambda _event: None)
            monkeypatch.setattr(pipeline, "handle_output_moderation_when_task_finished", lambda _answer: None)
            list(pipeline._process_stream_response(publisher=None, trace_manager=trace_manager))
        elif consumer_session is None:
            with case.collection.sessions.begin() as session:
                pipeline._save_message(session=session, trace_manager=trace_manager, preserve_existing_usage=True)
        else:
            pipeline._save_message(session=consumer_session, trace_manager=trace_manager, preserve_existing_usage=True)
            consumer_session.commit()
        return trace_manager.collect_tasks()


@pytest.mark.parametrize("receiver_fails", [False, True])
def test_stopped_agent_notifies_the_real_provider_receiver_once_after_commit(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch, receiver_fails: bool
) -> None:
    from sqlalchemy import inspect

    from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit, SystemConfiguration
    from events.event_handlers import update_provider_when_message_created as receiver

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
    from typing import cast

    from core.ops.entities.trace_entity import MessageTraceInfo, TraceTaskName
    from models.model import MessageDict

    # Simulate an old queued notification as well as the current consumer save:
    # persisted state, not a detached event payload, must decide who owns the end.
    notification = TraceTask(
        TraceTaskName.MESSAGE_TRACE,
        message_id=case.collection.run.source_id,
        conversation_id=identifier("conversation-recover"),
    )
    info = notification.execute()
    assert isinstance(info, MessageTraceInfo)
    assert isinstance(info.message_data, dict)
    info.message_data = Message.from_dict(cast(MessageDict, info.message_data))
    exported: list[CanonicalTrace] = []

    def export(_provider: str, _config: dict[str, object], trace: CanonicalTrace) -> TraceExportResult:
        exported.append(trace)
        if delivery == "uncertain":
            raise TraceExportUncertainError("acknowledgment lost")
        return TraceExportResult(trace_id=trace.trace_id)

    monkeypatch.setattr(service_module, "export_trace", export)
    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
    queued = save_agent_stop(case, monkeypatch, answer)
    assert case.service.capture_terminal(info) is True
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.outer_trace is None, "a stopped SSE save is not the runtime terminal"
    assert queued == []
    assert recovery.recover_terminal(case.service, stored) is False
    assert case.collection.repository.claim(stored.id, collection_timeout=60, lease_seconds=30) is None
    case.service.deliver(stored.id)
    assert exported == []

    output = "real runtime answer" if outcome == "succeeded" else None
    case.service.capture_agent_app_terminal(
        tenant_id=stored.tenant_id,
        app_id=stored.app_id,
        message_id=stored.source_id,
        outcome=outcome,
        output=output,
    )
    terminal = case.collection.repository.get(stored.id)
    assert terminal is not None
    trace = case.service.assemble(terminal)
    root = next(span for span in trace.spans if span.id == trace.root_span_id)
    assert root.metadata["message_execution_state"] == outcome
    assert root.status.value == ("ok" if outcome == "succeeded" else "error")
    assert len(trace.spans) == 3

    # A duplicate worker result and late consumer notification cannot rewrite
    # the frozen end or create a second ingestion attempt after acceptance.
    case.service.deliver(stored.id)
    case.service.deliver(stored.id)
    assert len(exported) == 1
    assert exported[0] == trace
    frozen = case.collection.repository.get(stored.id)
    assert frozen is not None
    assert frozen.state == delivery
    case.service.capture_agent_app_terminal(
        tenant_id=stored.tenant_id,
        app_id=stored.app_id,
        message_id=stored.source_id,
        outcome="succeeded" if outcome != "succeeded" else "cancelled",
        output="late result must not replace the accepted envelope",
    )
    assert case.service.capture_terminal(info) is True
    unchanged = case.collection.repository.get(stored.id)
    assert unchanged is not None
    assert unchanged.outer_trace == frozen.outer_trace
    assert unchanged.attempts == frozen.attempts == 1
    case.service.deliver(stored.id)
    assert len(exported) == 1
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
    queued = save_agent_stop(case, monkeypatch, "classic partial answer", mode=mode)
    assert len(queued) == 1
    assert queued[0].trace_type is service_module.TraceTaskName.MESSAGE_TRACE
    with case.collection.sessions() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        assert "agent_stop_requested" not in json.loads(message.message_metadata or "{}")


def test_worker_usage_flush_preserves_stop_intent_from_a_newer_consumer_save(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.app.apps.agent_app.app_runner import AgentAppRunner
    from graphon.model_runtime.entities.llm_entities import LLMUsage

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
    from core.app.apps.agent_app.app_runner import AgentAppRunner
    from graphon.model_runtime.entities.llm_entities import LLMUsage

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
    from typing import cast

    from flask import Flask

    from clients.agent_backend import FakeAgentBackendRunClient, FakeAgentBackendScenario
    from core.app.apps.agent_app.session_store import AgentAppSessionScope
    from core.app.apps.base_app_queue_manager import AppQueueManager
    from core.app.apps.exc import GenerateTaskStoppedError
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from core.ops.base_trace_instance import bind_application_tracing_hooks
    from services.tracing import runtime_bridge
    from tests.helpers.unit.config_override import apply_config_overrides
    from tests.unit_tests.core.app.apps.agent_app.test_app_runner import (
        _CancelAndWaitFailingClient,
        _ExplodingSessionStore,
        _FakeSessionStore,
        _runner,
        _StoppedQueueManager,
    )

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
    application = Flask(__name__)
    bind_application_tracing_hooks(application, runtime_bridge.RuntimeApplicationTracingHooks())
    with application.app_context(), pytest.raises(GenerateTaskStoppedError):
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
    root = next(span for span in trace.spans if span.id == trace.root_span_id)
    assert root.metadata["message_execution_state"] == runtime_outcome
    assert root.status.value == ("ok" if runtime_outcome == "succeeded" else "error")
    assert len(store.saved) == (0 if snapshot_save_fails else 1)
    exported: list[CanonicalTrace] = []

    def export(_provider: str, _config: dict[str, object], payload: CanonicalTrace) -> TraceExportResult:
        exported.append(payload)
        return TraceExportResult(trace_id=payload.trace_id)

    monkeypatch.setattr(service_module, "export_trace", export)
    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
    if pending_invocation is not None:
        assert case.collection.repository.claim(run.id, collection_timeout=60, lease_seconds=30) is None
        case.service.deliver(run.id)
        assert exported == []
        ingest(case.collection, batch_for(run, pending_invocation, final=True, span_id="b" * 16))
    case.service.deliver(run.id)
    case.service.deliver(run.id)
    assert len(exported) == 1
    assert len(exported[0].spans) == (3 if final_batch_arrived else 5)
    accepted = case.collection.repository.get(run.id)
    assert accepted is not None
    assert accepted.state == "accepted"
    assert accepted.attempts == 1
    with case.collection.sessions() as session:
        message = session.get(Message, run.source_id)
        assert message is not None
        assert message.answer == "partial answer"
        assert recovery.agent_stop_requested(message) is True


@pytest.mark.parametrize("incomplete", [False, True])
def test_missing_runtime_stop_terminal_converges_without_inventing_success(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch, incomplete: bool
) -> None:
    from tests.helpers.unit.config_override import apply_config_overrides

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
    from cachetools import TTLCache
    from flask import Flask

    from clients.agent_backend import FakeAgentBackendRunClient
    from core.app.apps import base_app_queue_manager
    from core.app.apps.base_app_queue_manager import PublishFrom
    from core.app.apps.exc import GenerateTaskStoppedError
    from core.app.apps.execution_coordinator import set_app_task_stop_flag
    from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from core.app.entities.queue_entities import (
        AppQueueEvent,
        MessageQueueMessage,
        QueueLLMChunkEvent,
        QueueMessageEndEvent,
    )
    from core.ops.base_trace_instance import bind_application_tracing_hooks
    from services.tracing import runtime_bridge
    from tests.unit_tests.core.app.apps.agent_app.test_app_runner import _FakeSessionStore, _runner, _soul

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
    application = Flask(__name__)
    bind_application_tracing_hooks(application, runtime_bridge.RuntimeApplicationTracingHooks())
    with application.app_context(), pytest.raises(GenerateTaskStoppedError):
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
    trace = CanonicalTrace.model_validate(frozen.outer_trace)
    root = next(span for span in trace.spans if span.id == trace.root_span_id)
    assert root.metadata["message_execution_state"] == "succeeded"
    assert root.status.value == "ok"
    assert len(store.saved) == 1


@pytest.mark.parametrize("stop_during_cleanup", [False, True])
def test_runtime_cleanup_cancellation_does_not_reclassify_a_business_stream_failure(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch, stop_during_cleanup: bool
) -> None:
    from collections.abc import Iterator
    from typing import cast

    from dify_agent.protocol import RunEvent
    from flask import Flask

    from core.app.apps.agent_app.session_store import AgentAppSessionScope
    from core.app.apps.base_app_queue_manager import AppQueueManager
    from core.app.apps.exc import GenerateTaskStoppedError
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from core.ops.base_trace_instance import bind_application_tracing_hooks
    from services.tracing import runtime_bridge
    from tests.helpers.unit.config_override import apply_config_overrides
    from tests.unit_tests.core.app.apps.agent_app.test_app_runner import (
        _FakeQueueManager,
        _FakeSessionStore,
        _runner,
        _UsageCancellationClient,
    )

    apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_ENABLED=True)
    monkeypatch.setattr(runtime_bridge, "_service", lambda: case.service)
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
    application = Flask(__name__)
    bind_application_tracing_hooks(application, runtime_bridge.RuntimeApplicationTracingHooks())
    with application.app_context():
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
    trace = CanonicalTrace.model_validate(frozen.outer_trace)
    root = next(span for span in trace.spans if span.id == trace.root_span_id)
    assert root.metadata["message_execution_state"] == ("cancelled" if stop_during_cleanup else "failed")
    assert root.status.value == "error"
    assert len(store.saved) == 1
    with case.collection.sessions() as session:
        message = session.get(Message, run.source_id)
        assert message is not None
        assert message.message_tokens == 13
        assert message.answer_tokens == 8
        assert message.total_price == Decimal("0.21")
    exported: list[CanonicalTrace] = []

    def export(_provider: str, _config: dict[str, object], payload: CanonicalTrace) -> TraceExportResult:
        exported.append(payload)
        return TraceExportResult(trace_id=payload.trace_id)

    monkeypatch.setattr(service_module, "export_trace", export)
    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
    case.service.deliver(run.id)
    case.service.deliver(run.id)
    accepted = case.collection.repository.get(run.id)
    assert accepted is not None
    assert accepted.state == "accepted"
    assert accepted.attempts == 1
    assert len(exported) == 1


@pytest.mark.parametrize("capture_agent", [False, True])
def test_missing_stop_worker_without_runtime_spans_also_reaches_a_delivery_failure(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch, capture_agent: bool
) -> None:
    from tests.helpers.unit.config_override import apply_config_overrides

    collection = seed(case.collection.sessions, f"stop-without-spans-{capture_agent}", capture_agent=capture_agent)
    attach_conversation(collection)
    stopped = RecoveryCase(collection, ApplicationTracingService(collection.repository), case.now, [])
    monkeypatch.setattr(stopped.service, "schedule", stopped.scheduled.append)
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
    trace = CanonicalTrace.model_validate(stored.outer_trace)
    root = trace.spans[0]
    assert root.metadata["message_execution_state"] == outcome
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
    from repositories.application_trace_repository import TraceCollectionError

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


def test_recovers_real_message_terminal_once_through_existing_trace_task(case: RecoveryCase) -> None:
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


def test_deliver_recovers_and_exports_once_after_terminal_queue_loss(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    with case.collection.sessions.begin() as session:
        message = session.get(Message, case.collection.run.source_id)
        assert message is not None
        message.message_metadata = complete_metadata()
        message.updated_at = case.now - timedelta(seconds=11)
    exported: list[CanonicalTrace] = []

    def export(_provider: str, _config: dict[str, object], trace: CanonicalTrace) -> TraceExportResult:
        exported.append(trace)
        return TraceExportResult(trace_id="provider-id")

    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
    monkeypatch.setattr(service_module, "export_trace", export)
    case.service.deliver(case.collection.run.id)
    case.service.deliver(case.collection.run.id)
    assert len(exported) == 1
    assert exported[0].spans[0].outputs == "persisted final answer"
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.state == "accepted"
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
    assert stored.outer_trace["spans"][0]["status"] == "error"
    assert stored.outer_trace["spans"][0]["outputs"] == ""
    assert stored.outer_trace["spans"][0]["metadata"]["aggregate_total_tokens"] == 0


def test_cross_tenant_source_is_rejected_before_trace_task_executes(
    case: RecoveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    with case.collection.sessions.begin() as session:
        app = session.get(App, case.collection.run.app_id)
        assert app is not None
        app.tenant_id = identifier("other-tenant")
    called: list[bool] = []

    def forbidden(_task: TraceTask) -> None:
        called.append(True)

    monkeypatch.setattr(TraceTask, "execute", forbidden)
    assert recovery.recover_terminal(case.service, case.collection.run) is False
    assert called == []
    stored = case.collection.repository.get(case.collection.run.id)
    assert stored is not None
    assert stored.error_code == "tracing_source_not_found"


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
    owner_id, workflow_run_id = identifier("workflow-owner"), identifier("recover-workflow-run")
    with case.collection.sessions.begin() as session:
        app = session.get(App, case.collection.run.app_id)
        assert app is not None
        app.created_by = owner_id
        session.add(make_account(account_id=owner_id))
        session.add(
            WorkflowRun(
                id=workflow_run_id,
                tenant_id=case.collection.run.tenant_id,
                app_id=app.id,
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
                created_by=owner_id,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_at=case.now - timedelta(seconds=30),
                finished_at=case.now - timedelta(seconds=10) if finished else None,
                elapsed_time=20,
                total_tokens=0,
                total_steps=0,
            )
        )
    run = case.collection.repository.start(
        tenant_id=case.collection.run.tenant_id,
        app_id=case.collection.run.app_id,
        source_kind="workflow",
        source_id=workflow_run_id,
        session_id="workflow-session",
    )
    assert run is not None
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
        assert stored.outer_trace["root_span_id"] == span_id(workflow_run_id)
        assert stored.outer_trace["spans"][0]["outputs"] == {"result": "persisted workflow output"}
    else:
        assert stored.outer_trace is None


@pytest.mark.parametrize("formatted", [None, "", " \n\t", "{}", "[]", "null", " { } ", "[\n]", {}, []])
@pytest.mark.parametrize("capture_content", [False, True])
def test_early_error_root_preserves_known_query_only_when_content_is_enabled(
    case: RecoveryCase, formatted: object, capture_content: bool
) -> None:
    from sqlalchemy import update

    from models.application_trace import ApplicationTraceRun

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
    trace = CanonicalTrace.model_validate(stored.outer_trace)
    root = trace.spans[0]
    assert root.status.value == "error"
    assert root.metadata["message_execution_state"] == "failed"
    assert root.inputs == ({"query": query} if capture_content else None)
    assert root.outputs == ("" if capture_content else None)
    assembled = case.service.assemble(stored)
    assert (query in assembled.model_dump_json()) is capture_content
    assert all(span.inputs is None for span in assembled.spans if span.id != assembled.root_span_id)
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
    from sqlalchemy import update

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
    trace = CanonicalTrace.model_validate(stored.outer_trace)
    assert trace.spans[0].inputs == expected
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
    assert CanonicalTrace.model_validate(stored.outer_trace).spans[0].inputs == {}
