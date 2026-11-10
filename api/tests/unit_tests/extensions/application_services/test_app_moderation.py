from collections.abc import Callable, Generator
from contextvars import copy_context
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Event, Thread
from time import perf_counter
from typing import override

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import (
    AppConfig,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
    SensitiveWordAvoidanceEntity,
    WorkflowUIBasedAppConfig,
)
from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.apps.advanced_chat.generate_task_pipeline import (
    AdvancedChatAppGenerateTaskPipeline,
    ConversationSnapshot,
    MessageSnapshot,
    WorkflowSnapshot,
)
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.chat.generate_response_converter import ChatAppGenerateResponseConverter
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, ChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import QueueAdvancedChatMessageEndEvent, QueueLLMChunkEvent, QueueMessageEndEvent
from core.app.entities.task_entities import MessageReplaceStreamResponse, MessageStreamResponse
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.model_context import get_app_moderation_runtime
from core.moderation.base import ModerationAction
from core.moderation.input_moderation import InputModeration
from core.moderation.openai_moderation.openai_moderation import OpenAIModeration
from core.moderation.output_moderation import ModerationRule as OutputModerationRule
from core.moderation.output_moderation import OutputModeration
from enums import DeploymentEdition
from extensions.application_services.app_moderation import (
    app_moderation_scope,
    app_output_evaluator,
    app_rejection_replacement,
    build_app_openai_checker,
    configure_app_moderation,
    current_moderation_session,
    evaluate_app_input,
    evaluate_app_output,
    workflow_rejection_handler,
)
from extensions.application_services.moderation import build_llm_moderation_guard
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from graphon.runtime import RuntimeState
from machinery.context import AppRequestContext
from models.enums import ConversationFromSource, MessageStatus
from models.model import AppMode, Conversation, Message
from services.moderation_invocation_errors import (
    ModerationRejectedInvocationError,
    ModerationUnavailableInvocationError,
    PlatformModerationRejectedInvocationError,
)
from services.moderation_service import (
    ModerationPhase,
    ModerationReplacement,
    ModerationRequest,
    ModerationRule,
    ModerationService,
    ModerationVerdict,
)
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.model_factories import make_account, make_conversation, make_message
from tests.workflow_test_utils import build_test_variable_pool


class RecordingGateway:
    def __init__(self) -> None:
        self.calls: list[tuple[str, ModerationPhase]] = []

    def check(
        self, context: AppRequestContext, *, rule: ModerationRule, request: ModerationRequest, phase: ModerationPhase
    ) -> ModerationVerdict:
        assert context.tenant_id == "tenant-1"
        assert rule.type == "openai_moderation"
        self.calls.append((request.text, phase))
        return ModerationVerdict(
            flagged="blocked" in request.text, message=f"Model {phase} was rejected by moderation."
        )


class RecordingAppService:
    def __init__(self) -> None:
        self.calls: list[tuple[AppRequestContext, ModerationRule, ModerationRequest, ModerationPhase]] = []

    def evaluate(
        self,
        context: AppRequestContext,
        *,
        rule: ModerationRule,
        request: ModerationRequest,
        phase: ModerationPhase,
    ) -> ModerationVerdict:
        self.calls.append((context, rule, request, phase))
        return ModerationVerdict(
            flagged=True,
            message="Service rejection",
            replacement=ModerationReplacement(
                action="overridden",
                inputs={"input_key": "rewritten"},
                query="rewritten query",
                text="rewritten output",
            ),
        )


class TransientOutputFailureGateway:
    def __init__(self) -> None:
        self.calls = 0

    def check(
        self, context: AppRequestContext, *, rule: ModerationRule, request: ModerationRequest, phase: ModerationPhase
    ) -> ModerationVerdict:
        assert context.tenant_id == "tenant-1"
        assert rule.type == "api"
        assert isinstance(request.text, str)
        assert phase == "output"
        self.calls += 1
        if self.calls == 1:
            raise ValueError("request timeout: private backend diagnostic")
        return ModerationVerdict(flagged=False, message="")


class BlockingOutputFailureGateway(TransientOutputFailureGateway):
    def __init__(self) -> None:
        super().__init__()
        self.entered = Event()
        self.release = Event()

    @override
    def check(
        self, context: AppRequestContext, *, rule: ModerationRule, request: ModerationRequest, phase: ModerationPhase
    ) -> ModerationVerdict:
        self.entered.set()
        assert self.release.wait(5)
        return super().check(context, rule=rule, request=request, phase=phase)


@dataclass(frozen=True)
class ModerationServices:
    moderation: ModerationService


def app_config(backend: str = "openai_moderation") -> AppConfig:
    return AppConfig(
        tenant_id="tenant-1",
        app_id="app-1",
        app_mode=AppMode.CHAT,
        sensitive_word_avoidance=SensitiveWordAvoidanceEntity(
            type=backend,
            config={
                "inputs_config": {"enabled": True, "preset_response": "App input replacement"},
                "outputs_config": {"enabled": True, "preset_response": "App output replacement"},
            },
        ),
    )


def test_app_and_model_share_input_verdict_and_preserve_app_replacement() -> None:
    gateway = RecordingGateway()
    service = ModerationService(gateway=gateway)
    rule = ModerationRule(
        type="openai_moderation", config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": True}}
    )

    with app_moderation_scope("tenant-1", "app-1") as session:
        guard = build_llm_moderation_guard(
            AppRequestContext(tenant_id="tenant-1", app_id="app-1"), service=service, rule=rule, platform=True
        )
        check = build_app_openai_checker(session, "input", service=service)
        assert check("safe") is False
        guard.check_inputs([UserPromptMessage(content="safe")])
        assert gateway.calls == [("safe", "input")]
        assert check("blocked") is True

        config = app_config().sensitive_word_avoidance
        assert config is not None
        backend = OpenAIModeration(app_id="app-1", tenant_id="tenant-1", config=config.config)
        verdict = backend.moderation_for_inputs({}, "blocked")
        assert verdict.flagged
        assert verdict.preset_response == "App input replacement"
        assert gateway.calls == [("safe", "input"), ("blocked", "input")]


def test_unrelated_capabilities_cannot_be_marked_as_shared_platform_openai_checks() -> None:
    gateway = RecordingGateway()
    rule = ModerationRule(
        type="keywords", config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": True}}
    )
    with app_moderation_scope("tenant-1", "app-1") as session:
        with pytest.raises(ValueError, match="OpenAI rule"):
            build_llm_moderation_guard(
                AppRequestContext(tenant_id="tenant-1", app_id="app-1"),
                service=ModerationService(gateway=gateway),
                rule=rule,
                platform=True,
            )
        assert not session.enabled
    assert not gateway.calls


def test_app_input_evaluation_uses_the_shared_use_case(monkeypatch: pytest.MonkeyPatch) -> None:
    service = RecordingAppService()
    monkeypatch.setattr("extensions.application_services.app_moderation._app_service", lambda: service)
    config = app_config("keywords")
    with app_moderation_scope("tenant-1", "app-1") as session:
        result = evaluate_app_input(session, config, {"input_key": "value"}, "query")

    assert result is not None
    assert result.flagged is True
    assert result.action == ModerationAction.OVERRIDDEN
    assert result.inputs == {"input_key": "rewritten"}
    assert result.query == "rewritten query"
    assert len(service.calls) == 1
    assert service.calls[0][2].inputs == {"input_key": "value"}
    assert service.calls[0][2].query == "query"
    assert service.calls[0][3] == "input"


def test_app_output_evaluation_uses_the_shared_use_case(monkeypatch: pytest.MonkeyPatch) -> None:
    service = RecordingAppService()
    monkeypatch.setattr("extensions.application_services.app_moderation._app_service", lambda: service)
    config = app_config("keywords")
    with app_moderation_scope("tenant-1", "app-1") as session:
        result = evaluate_app_output(session, config, "model output")

    assert result is not None
    assert result.flagged is True
    assert result.action == ModerationAction.OVERRIDDEN
    assert result.text == "rewritten output"
    assert len(service.calls) == 1
    assert service.calls[0][2].text == "model output"
    assert service.calls[0][3] == "output"


def test_input_moderation_runtime_uses_the_shared_use_case(monkeypatch: pytest.MonkeyPatch) -> None:
    service = RecordingAppService()
    monkeypatch.setattr("extensions.application_services.app_moderation._app_service", lambda: service)
    config = app_config("keywords")
    with app_moderation_scope("tenant-1", "app-1"):
        flagged, inputs, query = InputModeration().check(
            app_id="app-1",
            tenant_id="tenant-1",
            app_config=config,
            inputs={"input_key": "value"},
            query="query",
            message_id="message-1",
            trace_scope=None,
        )

    assert flagged is True
    assert inputs == {"input_key": "rewritten"}
    assert query == "rewritten query"
    assert len(service.calls) == 1


@pytest.mark.parametrize("stream", [False, True])
def test_app_output_reuses_approved_model_output_without_another_call(stream: bool) -> None:
    gateway = RecordingGateway()
    service = ModerationService(gateway=gateway)
    rule = ModerationRule(
        type="openai_moderation", config={"inputs_config": {"enabled": False}, "outputs_config": {"enabled": True}}
    )

    with app_moderation_scope("tenant-1", "app-1") as session:
        guard = build_llm_moderation_guard(
            AppRequestContext(tenant_id="tenant-1", app_id="app-1"), service=service, rule=rule, platform=True
        )
        if stream:
            chunks = [
                LLMResultChunk(
                    model="model",
                    delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="safe answer")),
                )
            ]
            response = guard.check_output(chunk for chunk in chunks)
            assert isinstance(response, Generator)
            assert list(response) == chunks
        else:
            guard.check_result(
                LLMResult(
                    model="model", message=AssistantPromptMessage(content="safe answer"), usage=LLMUsage.empty_usage()
                )
            )
        assert gateway.calls == [("safe answer", "output")]
        check = build_app_openai_checker(session, "output", service=service)
        assert not check("safe")
        assert not check("safe answer")
        assert gateway.calls == [("safe answer", "output")]
        assert not check("different answer")
        assert gateway.calls[-1] == ("different answer", "output")


@pytest.mark.parametrize("phase", ["input", "output"])
def test_only_platform_rejections_use_the_matching_app_preset(phase: ModerationPhase) -> None:
    config = app_config()
    error = PlatformModerationRejectedInvocationError(phase, "Rejected")
    assert app_rejection_replacement(config, error) == (f"App {phase} replacement", phase)
    assert app_rejection_replacement(config, ModerationUnavailableInvocationError()) is None
    explicit_error = ModerationRejectedInvocationError(phase, "Explicit policy rejection")
    assert app_rejection_replacement(config, explicit_error) is None
    assert app_rejection_replacement(app_config("keywords"), error) is None
    assert config.sensitive_word_avoidance is not None
    config.sensitive_word_avoidance.config[f"{phase}s_config"]["enabled"] = False
    assert app_rejection_replacement(config, error) is None


def test_scope_is_isolated_and_shared_with_copied_worker_contexts() -> None:
    with app_moderation_scope("tenant-1", "app-1") as session:
        observed: list[object] = []
        context = copy_context()
        worker = Thread(target=lambda: context.run(lambda: observed.append(current_moderation_session("tenant-1"))))
        worker.start()
        worker.join()
        assert observed == [session]
        assert current_moderation_session("tenant-2") is None
    assert current_moderation_session("tenant-1") is None
    with app_moderation_scope("tenant-1", "app-1") as other_session:
        assert other_session is not session


@pytest.mark.parametrize(
    "edition", [DeploymentEdition.CLOUD, DeploymentEdition.COMMUNITY, DeploymentEdition.ENTERPRISE]
)
@pytest.mark.parametrize("enabled", [False, True])
def test_workflow_app_sharing_requires_cloud_and_the_global_switch(
    config_overrides: Callable[..., None], edition: DeploymentEdition, enabled: bool
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition, HOSTED_MODERATION_ENABLED=enabled)
    config = WorkflowUIBasedAppConfig(
        **app_config().model_copy(update={"app_mode": AppMode.ADVANCED_CHAT}).model_dump(),
        workflow_id="workflow-1",
    )
    entity = AdvancedChatAppGenerateEntity(
        task_id="task-1",
        app_config=config,
        query="safe",
        inputs={},
        files=[],
        user_id="account-1",
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    with app_moderation_scope("tenant-1", "app-1") as session:
        configure_app_moderation(entity)
        expected = enabled and edition == DeploymentEdition.CLOUD
        assert session.enabled is expected
        assert (app_output_evaluator(config) is not None) is True


def test_runtime_does_not_share_output_checks_or_presets_with_another_app() -> None:
    config = app_config().model_copy(update={"app_id": "app-2"})
    with app_moderation_scope("tenant-1", "app-1") as session:
        session.enabled = True
        runtime = get_app_moderation_runtime()
        assert runtime is not None
        assert app_output_evaluator(config) is None
        assert runtime.replacement(config, PlatformModerationRejectedInvocationError("output", "Rejected")) is None


def test_workflow_replacement_uses_only_an_exact_rejection_from_the_same_scope() -> None:
    with app_moderation_scope("tenant-1", "app-1") as session:
        handler = workflow_rejection_handler(app_config())

        def reject() -> None:
            raise PlatformModerationRejectedInvocationError("output", "Rejected model output")

        with pytest.raises(PlatformModerationRejectedInvocationError):
            session.check("blocked", "output", reject)
    assert handler("Rejected model output") == ("App output replacement", "output")
    assert handler("Unrelated workflow failure") is None


@pytest.mark.parametrize("phase", ["input", "output"])
@pytest.mark.parametrize("previous_answer", ["", "safe prefix"])
def test_chat_pipeline_renders_platform_rejection_with_existing_app_reply_events(
    phase: ModerationPhase, previous_answer: str
) -> None:
    config = EasyUIBasedAppConfig(
        **app_config().model_dump(),
        app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
        app_model_config_dict={},
        model=ModelConfigEntity(provider="test-provider", model="test-model"),
        prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
    )
    entity = ChatAppGenerateEntity(
        task_id="task-1",
        app_config=config,
        model_conf=make_model_config(provider="test-provider", model="test-model", mode="chat"),
        inputs={},
        files=[],
        user_id="account-1",
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    queue = MessageBasedAppQueueManager(
        task_id="task-1",
        user_id="account-1",
        invoke_from=InvokeFrom.DEBUGGER,
        conversation_id="conversation-1",
        app_mode=AppMode.CHAT,
        message_id="message-1",
    )
    message = Message(id="message-1")
    message.created_at = datetime.now(UTC)
    with app_moderation_scope("tenant-1", "app-1"):
        pipeline = EasyUIBasedGenerateTaskPipeline(
            application_generate_entity=entity,
            queue_manager=queue,
            conversation=Conversation(id="conversation-1", mode=AppMode.CHAT),
            message=message,
            stream=True,
        )
    pipeline._task_state.llm_result.message.content = previous_answer
    queue.publish_error(PlatformModerationRejectedInvocationError(phase, "Rejected"), PublishFrom.TASK_PIPELINE)
    response = pipeline._process_stream_response(None)
    try:
        event = next(response)
        if previous_answer:
            assert isinstance(event, MessageReplaceStreamResponse)
        else:
            assert isinstance(event, MessageStreamResponse)
        assert event.answer == f"App {phase} replacement"
        assert pipeline.output_moderation_handler is None
    finally:
        response.close()


@pytest.mark.parametrize("advanced", [False, True])
@pytest.mark.parametrize("background", [False, True])
@pytest.mark.parametrize("stream", [False, True])
def test_output_failure_emits_safe_error_and_persists_message_status(
    sqlite_session_factory: sessionmaker[Session], advanced: bool, background: bool, stream: bool
) -> None:
    gateway = TransientOutputFailureGateway()
    flask_app = Flask(__name__)
    flask_app.extensions["application_services"] = ModerationServices(ModerationService(gateway=gateway))
    mode = AppMode.ADVANCED_CHAT if advanced else AppMode.CHAT
    config = app_config("api").model_copy(update={"app_mode": mode})
    conversation = make_conversation(mode=mode, from_source=ConversationFromSource.CONSOLE)
    message = make_message(
        query="query", message={}, answer="", from_source=ConversationFromSource.CONSOLE, created_at=datetime.now(UTC)
    )
    with sqlite_session_factory() as database:
        database.add_all([conversation, message])
        database.commit()
    queue = MessageBasedAppQueueManager(
        task_id="task-1",
        user_id="account-1",
        invoke_from=InvokeFrom.DEBUGGER,
        conversation_id="conversation-1",
        app_mode=mode,
        message_id="message-1",
    )
    with flask_app.app_context(), app_moderation_scope("tenant-1", "app-1"):
        if advanced:
            entity = AdvancedChatAppGenerateEntity(
                task_id="task-1",
                app_config=WorkflowUIBasedAppConfig(**config.model_dump(), workflow_id="workflow-1"),
                query="query",
                inputs={},
                files=[],
                user_id="account-1",
                stream=stream,
                invoke_from=InvokeFrom.DEBUGGER,
            )
            queue.graph_runtime_state = RuntimeState(
                workflow_id="workflow-1", variable_pool=build_test_variable_pool(), start_at=perf_counter()
            )
            pipeline = AdvancedChatAppGenerateTaskPipeline(
                application_generate_entity=entity,
                workflow=WorkflowSnapshot(id="workflow-1", tenant_id="tenant-1", features_dict={}),
                queue_manager=queue,
                conversation=ConversationSnapshot.from_conversation(conversation),
                message=MessageSnapshot.from_message(message),
                user=make_account(),
                stream=stream,
                dialogue_count=1,
                draft_var_saver_factory=BaseAppGenerator._get_draft_var_saver_factory(
                    InvokeFrom.DEBUGGER, make_account(), tenant_id="tenant-1"
                ),
            )
            pipeline._task_state.answer = "model output"
            handler = pipeline._base_task_pipeline.output_moderation_handler
        else:
            entity = ChatAppGenerateEntity(
                task_id="task-1",
                app_config=EasyUIBasedAppConfig(
                    **config.model_dump(),
                    app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
                    app_model_config_dict={},
                    model=ModelConfigEntity(provider="test-provider", model="test-model"),
                    prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
                ),
                model_conf=make_model_config(provider="test-provider", model="test-model", mode="chat"),
                query="query",
                inputs={},
                files=[],
                user_id="account-1",
                stream=stream,
                invoke_from=InvokeFrom.DEBUGGER,
            )
            pipeline = EasyUIBasedGenerateTaskPipeline(
                application_generate_entity=entity,
                queue_manager=queue,
                conversation=conversation,
                message=message,
                stream=stream,
            )
            handler = pipeline.output_moderation_handler
    assert handler is not None
    if background:
        queue.publish(
            QueueLLMChunkEvent(
                chunk=LLMResultChunk(
                    model="test-model",
                    delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="must not be delivered")),
                )
            ),
            PublishFrom.TASK_PIPELINE,
        )
        handler.buffer = "output being checked"
        handler.worker(flask_app, 1)
        assert not handler.thread_running
        with pytest.raises(ModerationUnavailableInvocationError):
            handler.moderation_completion("later safe output")
    else:
        terminal = (
            QueueAdvancedChatMessageEndEvent()
            if advanced
            else QueueMessageEndEvent(
                llm_result=LLMResult(
                    model="test-model",
                    message=AssistantPromptMessage(content="model output"),
                    usage=LLMUsage.empty_usage(),
                )
            )
        )
        queue.publish(terminal, PublishFrom.TASK_PIPELINE)

    with flask_app.app_context():
        responses = pipeline._process_stream_response(None)
        if stream:
            converter = AdvancedChatAppGenerateResponseConverter if advanced else ChatAppGenerateResponseConverter
            chunks = list(converter.convert_stream_full_response(pipeline._to_stream_response(responses)))
            assert len(chunks) == 1
            assert isinstance(chunks[0], dict)
            assert chunks[0]["event"] == "error"
            assert chunks[0]["code"] == "moderation_unavailable"
            assert chunks[0]["status"] == 503
            assert chunks[0]["message"] == str(ModerationUnavailableInvocationError())
        else:
            with pytest.raises(ModerationUnavailableInvocationError):
                pipeline._to_blocking_response(responses)
    assert gateway.calls == 1
    with sqlite_session_factory() as database:
        saved = database.get(Message, "message-1")
        assert saved is not None
        assert saved.status == MessageStatus.ERROR
        assert saved.error == str(ModerationUnavailableInvocationError())


def test_final_output_cannot_approve_a_racing_background_failure() -> None:
    gateway = BlockingOutputFailureGateway()
    flask_app = Flask(__name__)
    flask_app.extensions["application_services"] = ModerationServices(ModerationService(gateway=gateway))
    config = app_config("api")
    rule = config.sensitive_word_avoidance
    assert rule is not None
    queue = MessageBasedAppQueueManager(
        task_id="task-1",
        user_id="account-1",
        invoke_from=InvokeFrom.DEBUGGER,
        conversation_id="conversation-1",
        app_mode=AppMode.CHAT,
        message_id="message-1",
    )
    with app_moderation_scope("tenant-1", "app-1"):
        handler = OutputModeration(
            tenant_id="tenant-1",
            app_id="app-1",
            rule=OutputModerationRule(type=rule.type, config=rule.config),
            queue_manager=queue,
            output_evaluator=app_output_evaluator(config),
            buffer="pending output",
        )
    final_entered = Event()
    final_finished = Event()
    final_errors: list[ModerationUnavailableInvocationError] = []

    def finalize() -> None:
        with flask_app.app_context():
            final_entered.set()
            try:
                handler.moderation_completion("final output")
            except ModerationUnavailableInvocationError as error:
                final_errors.append(error)
            finally:
                final_finished.set()

    worker = Thread(target=handler.worker, args=(flask_app, 1))
    handler.thread = worker
    worker.start()
    final_worker = Thread(target=finalize)
    try:
        assert gateway.entered.wait(5)
        final_worker.start()
        assert final_entered.wait(5)
        assert not final_finished.wait(0.05)
    finally:
        gateway.release.set()
        handler.stop_thread()
        worker.join(5)
        if final_worker.ident is not None:
            final_worker.join(5)
    assert not worker.is_alive()
    assert not final_worker.is_alive()
    assert gateway.calls == 1
    assert len(final_errors) == 1
    assert handler.error is final_errors[0]
