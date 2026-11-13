from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Barrier
from time import perf_counter
from typing import Literal, override

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
from core.app.entities.queue_entities import (
    QueueAdvancedChatMessageEndEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueTextChunkEvent,
)
from core.app.entities.task_entities import (
    ChatbotAppBlockingResponse,
    MessageReplaceStreamResponse,
    MessageStreamResponse,
)
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.model_manager import ModelManager
from core.moderation.base import ModerationAction, ModerationInputsResult, ModerationOutputsResult
from core.moderation.input_moderation import InputModeration
from core.moderation.output_moderation import ModerationRule as OutputModerationRule
from core.moderation.output_moderation import OutputModeration
from events.message_event import message_was_created
from extensions.application_services.app_moderation import (
    DEFAULT_CHAT_MODERATION_REPLY,
    AppModeration,
    app_output_evaluator,
    app_rejection_replacement,
    evaluate_app_input,
    evaluate_app_output,
    workflow_moderation_error,
)
from extensions.application_services.moderation import build_llm_moderation_guard
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from graphon.runtime import RuntimeState
from machinery.context import AppRequestContext
from models.enums import ConversationFromSource, MessageStatus
from models.model import AppMode, Conversation, Message
from services.moderation_adapters import HostedOpenAIModerationGateway, LLMModerationGuard
from services.moderation_invocation_errors import (
    ModerationRejectedInvocationError,
    ModerationUnavailableInvocationError,
    PlatformModerationInputRejectedInvocationError,
    PlatformModerationOutputRejectedInvocationError,
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
from tests.helpers.unit.core.model_moderation_fixtures import RecordingHostedModerationClient
from tests.helpers.unit.model_factories import make_account, make_conversation, make_message
from tests.workflow_test_utils import build_test_variable_pool


@pytest.fixture(autouse=True)
def inject_app_moderation(monkeypatch: pytest.MonkeyPatch) -> None:
    moderation = AppModeration()
    monkeypatch.setattr("core.moderation.input_moderation.get_app_moderation", lambda: moderation)
    monkeypatch.setattr("core.app.task_pipeline.based_generate_task_pipeline.get_app_moderation", lambda: moderation)


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


class ParallelGateway(RecordingGateway):
    def __init__(self) -> None:
        super().__init__()
        self.barrier = Barrier(2)

    @override
    def check(
        self, context: AppRequestContext, *, rule: ModerationRule, request: ModerationRequest, phase: ModerationPhase
    ) -> ModerationVerdict:
        self.barrier.wait(timeout=5)
        return super().check(context, rule=rule, request=request, phase=phase)


class SegmentGateway:
    def __init__(self, action: Literal["direct_output", "overridden"], preset: str) -> None:
        self.action = action
        self.preset = preset
        self.calls: list[str] = []

    def check(
        self, context: AppRequestContext, *, rule: ModerationRule, request: ModerationRequest, phase: ModerationPhase
    ) -> ModerationVerdict:
        assert context.tenant_id == "tenant-1"
        assert rule.type == "api"
        assert phase == "output"
        self.calls.append(request.text)
        return ModerationVerdict(
            flagged="blocked" in request.text,
            message=self.preset,
            replacement=ModerationReplacement(
                action=self.action, preset_response=self.preset, text=request.text.replace("blocked", "masked")
            ),
        )


def check_phase(guard: LLMModerationGuard, phase: ModerationPhase, text: str) -> None:
    if phase == "input":
        guard.check_inputs([UserPromptMessage(content=text)])
    else:
        guard.check_result(
            LLMResult(model="model", message=AssistantPromptMessage(content=text), usage=LLMUsage.empty_usage())
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


def test_model_owns_input_checks_and_app_only_renders_rejection() -> None:
    gateway = RecordingGateway()
    service = ModerationService(gateway=gateway)
    rule = ModerationRule(
        type="openai_moderation", config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": True}}
    )

    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="tenant-1", app_id="app-1"), service=service, rule=rule, platform=True
    )
    config = app_config()
    app_result = evaluate_app_input(config, {}, "safe")
    assert app_result is not None
    assert not app_result.flagged
    guard.check_inputs([UserPromptMessage(content="safe")])
    assert gateway.calls == [("safe", "input")]
    with pytest.raises(PlatformModerationRejectedInvocationError) as rejected:
        guard.check_inputs([UserPromptMessage(content="blocked")])
    assert app_rejection_replacement(config, rejected.value) == ("App input replacement", "input")
    app_result = evaluate_app_input(config, {}, "blocked")
    assert app_result is not None
    assert not app_result.flagged
    assert gateway.calls == [("safe", "input"), ("blocked", "input")]


@pytest.mark.parametrize(
    ("error_type", "phase"),
    [
        (PlatformModerationInputRejectedInvocationError, "input"),
        (PlatformModerationOutputRejectedInvocationError, "output"),
    ],
)
def test_workflow_rejection_phase_comes_from_node_error_type(
    error_type: type[PlatformModerationRejectedInvocationError], phase: ModerationPhase
) -> None:
    error = workflow_moderation_error(error_type.__name__)
    assert isinstance(error, error_type)
    assert error.phase == phase
    assert app_rejection_replacement(app_config(), error) == (f"App {phase} replacement", phase)


def test_workflow_classification_does_not_use_display_text() -> None:
    unavailable = workflow_moderation_error(ModerationUnavailableInvocationError.__name__)
    assert isinstance(unavailable, ModerationUnavailableInvocationError)
    for value in ("", "ValueError", str(unavailable), "Model input was rejected by moderation."):
        assert workflow_moderation_error(value) is None


def test_unrelated_capabilities_cannot_be_marked_as_shared_platform_openai_checks() -> None:
    gateway = RecordingGateway()
    rule = ModerationRule(
        type="keywords", config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": True}}
    )
    with pytest.raises(ValueError, match="OpenAI rule"):
        build_llm_moderation_guard(
            AppRequestContext(tenant_id="tenant-1", app_id="app-1"),
            service=ModerationService(gateway=gateway),
            rule=rule,
            platform=True,
        )
    assert not gateway.calls


@pytest.mark.parametrize("phase", ["input", "output"])
@pytest.mark.parametrize("failure", ["missing_credentials", "runtime_failure"])
def test_admitted_app_model_checks_fail_closed_without_exposing_backend_errors(
    monkeypatch: pytest.MonkeyPatch, phase: ModerationPhase, failure: str
) -> None:
    client = RecordingHostedModerationClient()
    if failure == "runtime_failure":
        client.error = RuntimeError("Private plugin diagnostic")
    service = ModerationService(
        gateway=HostedOpenAIModerationGateway(
            client=client,
            credentials=None if failure == "missing_credentials" else {"openai_api_key": "platform-key"},
            plugin_unique_identifier="langgenius/openai:1.0.0@checksum",
        )
    )
    monkeypatch.setattr("extensions.application_services.moderation.build_platform_moderation_service", lambda: service)
    config = app_config()
    input_result = evaluate_app_input(config, {}, "input")
    assert input_result is not None
    assert not input_result.flagged
    result = evaluate_app_output(config, "output")
    assert result is not None
    assert not result.flagged
    assert not client.calls
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="tenant-1", app_id="app-1"),
        service=service,
        rule=ModerationRule(
            type="openai_moderation",
            config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": True}},
        ),
        platform=True,
    )
    with pytest.raises(ModerationUnavailableInvocationError) as unavailable:
        check_phase(guard, phase, phase)
    assert str(unavailable.value) == "This message can’t be processed right now. Please try again later."
    assert unavailable.value.status_code == 503
    assert unavailable.value.__cause__ is not None
    assert len(client.calls) == (0 if failure == "missing_credentials" else 1)


@pytest.mark.parametrize("phase", ["input", "output"])
@pytest.mark.parametrize("scenario", ["missing_rule", "disabled", "invalid_phase"])
def test_disabled_or_invalid_app_phases_do_not_resolve_a_backend(
    monkeypatch: pytest.MonkeyPatch, phase: ModerationPhase, scenario: str
) -> None:
    def unexpected_service() -> ModerationService:
        raise AssertionError("An unadmitted or disabled rule must not resolve a moderation backend")

    monkeypatch.setattr("extensions.application_services.app_moderation._app_service", unexpected_service)
    config = app_config("keywords")
    if scenario == "missing_rule":
        config.sensitive_word_avoidance = None
    else:
        rule = config.sensitive_word_avoidance
        assert rule is not None
        rule.config[f"{phase}s_config"]["enabled"] = False if scenario == "disabled" else "invalid"

    def evaluate() -> ModerationInputsResult | ModerationOutputsResult | None:
        return (
            evaluate_app_input(config, {"key": "value"}, "query")
            if phase == "input"
            else evaluate_app_output(config, "output")
        )

    if scenario == "invalid_phase":
        with pytest.raises(ValueError, match="enabled must be a bool"):
            evaluate()
    elif scenario == "disabled":
        result = evaluate()
        assert result is not None
        assert not result.flagged
    else:
        assert evaluate() is None


def test_app_input_evaluation_uses_the_shared_use_case(monkeypatch: pytest.MonkeyPatch) -> None:
    service = RecordingAppService()
    monkeypatch.setattr("extensions.application_services.app_moderation._app_service", lambda: service)
    config = app_config("keywords")
    result = evaluate_app_input(config, {"input_key": "value"}, "query")

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
    result = evaluate_app_output(config, "model output")

    assert result is not None
    assert result.flagged is True
    assert result.action == ModerationAction.OVERRIDDEN
    assert result.text == "rewritten output"
    assert len(service.calls) == 1
    assert service.calls[0][2].text == "model output"
    assert service.calls[0][3] == "output"


def test_input_moderation_delegates_to_the_shared_use_case(monkeypatch: pytest.MonkeyPatch) -> None:
    service = RecordingAppService()
    monkeypatch.setattr("extensions.application_services.app_moderation._app_service", lambda: service)
    config = app_config("keywords")
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
def test_app_output_never_schedules_another_model_check(stream: bool) -> None:
    gateway = RecordingGateway()
    service = ModerationService(gateway=gateway)
    rule = ModerationRule(
        type="openai_moderation", config={"inputs_config": {"enabled": False}, "outputs_config": {"enabled": True}}
    )

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
    for text in ["safe", "safe answer", "different answer"]:
        app_result = evaluate_app_output(app_config(), text)
        assert app_result is not None
        assert not app_result.flagged
        assert gateway.calls == [("safe answer", "output")]


@pytest.mark.parametrize("phase", ["input", "output"])
def test_platform_rejections_prefer_the_matching_app_preset_without_hiding_failures(phase: ModerationPhase) -> None:
    config = app_config()
    error = PlatformModerationRejectedInvocationError(phase, "Rejected")
    assert app_rejection_replacement(config, error) == (f"App {phase} replacement", phase)
    assert app_rejection_replacement(config, ModerationUnavailableInvocationError()) is None
    explicit_error = ModerationRejectedInvocationError(phase, "Explicit policy rejection")
    assert app_rejection_replacement(config, explicit_error) is None
    assert app_rejection_replacement(app_config("keywords"), error) == (DEFAULT_CHAT_MODERATION_REPLY, phase)
    assert config.sensitive_word_avoidance is not None
    config.sensitive_word_avoidance.config[f"{phase}s_config"]["enabled"] = False
    assert app_rejection_replacement(config, error) == (DEFAULT_CHAT_MODERATION_REPLY, phase)


@pytest.mark.parametrize("mode", list(AppMode))
@pytest.mark.parametrize("phase", ["input", "output"])
def test_only_chat_modes_get_a_default_platform_rejection_reply(mode: AppMode, phase: ModerationPhase) -> None:
    config = app_config().model_copy(update={"app_mode": mode, "sensitive_word_avoidance": None})
    rejected = PlatformModerationRejectedInvocationError(phase, "Rejected")
    expected = (
        (DEFAULT_CHAT_MODERATION_REPLY, phase)
        if mode
        in {
            AppMode.CHAT,
            AppMode.ADVANCED_CHAT,
            AppMode.AGENT_CHAT,
        }
        else None
    )
    assert app_rejection_replacement(config, rejected) == expected
    assert app_rejection_replacement(config, ModerationUnavailableInvocationError()) is None
    assert app_rejection_replacement(config, ModerationRejectedInvocationError(phase, "Explicit rejection")) is None


@pytest.mark.parametrize("phase", ["input", "output"])
@pytest.mark.parametrize("response", [None, "", " \t"])
def test_blank_app_presets_use_the_chat_default(phase: ModerationPhase, response: str | None) -> None:
    config = app_config()
    assert config.sensitive_word_avoidance is not None
    config.sensitive_word_avoidance.config[f"{phase}s_config"]["preset_response"] = response
    assert app_rejection_replacement(config, PlatformModerationRejectedInvocationError(phase, "Rejected")) == (
        "This message can’t be processed.",
        phase,
    )


@pytest.mark.parametrize("same_text", [False, True])
def test_independent_model_checks_do_not_serialize_or_deduplicate(same_text: bool) -> None:
    gateway = ParallelGateway()
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="tenant-1", app_id="app-1"),
        service=ModerationService(gateway=gateway),
        rule=ModerationRule(
            type="openai_moderation",
            config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": False}},
        ),
        platform=True,
    )
    texts = ["first", "first" if same_text else "second"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(guard.check_inputs, [UserPromptMessage(content=text)]) for text in texts]
        for future in futures:
            future.result(timeout=10)
    assert sorted(gateway.calls) == sorted((text, "input") for text in texts)


def test_app_model_rule_does_not_select_a_tenant_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    def tenant_factory(*_args: object, **_kwargs: object) -> ModelManager:
        raise AssertionError("App moderation must not resolve a tenant provider")

    monkeypatch.setattr(ModelManager, "for_tenant", tenant_factory)
    config = app_config()
    flagged, inputs, query = InputModeration().check(
        app_id="app-1",
        tenant_id="tenant-1",
        app_config=config,
        inputs={},
        query="safe input",
        message_id="message-1",
        trace_scope=None,
    )
    assert not flagged
    assert inputs == {}
    assert query == "safe input"
    assert app_output_evaluator(config) is None
    result = evaluate_app_output(config, "unrelated custom model output")
    assert result is not None
    assert not result.flagged
    assert result.text == "unrelated custom model output"
    assert result.preset_response == ""


@pytest.mark.parametrize("phase", ["input", "output"])
@pytest.mark.parametrize("previous_answer", ["", "safe prefix"])
def test_chat_pipeline_renders_platform_rejection_with_existing_app_reply_events(
    monkeypatch: pytest.MonkeyPatch, phase: ModerationPhase, previous_answer: str
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
    pipeline = EasyUIBasedGenerateTaskPipeline(
        application_generate_entity=entity,
        queue_manager=queue,
        conversation=Conversation(id="conversation-1", mode=AppMode.CHAT),
        message=message,
        stream=True,
    )
    pipeline._task_state.llm_result.message.content = previous_answer
    monkeypatch.setattr("core.app.task_pipeline.based_generate_task_pipeline.get_app_moderation", lambda: None)
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
    with flask_app.app_context():
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
            QueueTextChunkEvent(text="must not be delivered" * 30)
            if advanced
            else QueueLLMChunkEvent(
                chunk=LLMResultChunk(
                    model="test-model",
                    delta=LLMResultChunkDelta(
                        index=0, message=AssistantPromptMessage(content="must not be delivered" * 30)
                    ),
                )
            ),
            PublishFrom.TASK_PIPELINE,
        )
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


def test_final_output_does_not_retry_a_failed_sequential_segment() -> None:
    gateway = TransientOutputFailureGateway()
    flask_app = Flask(__name__)
    flask_app.extensions["application_services"] = ModerationServices(ModerationService(gateway=gateway))
    config = app_config("api")
    rule = config.sensitive_word_avoidance
    assert rule is not None
    handler = OutputModeration(
        tenant_id="tenant-1",
        app_id="app-1",
        rule=OutputModerationRule(type=rule.type, config=rule.config),
        output_evaluator=app_output_evaluator(config),
    )
    with flask_app.app_context():
        with pytest.raises(ModerationUnavailableInvocationError) as failure:
            handler.append_new_token("pending output" * 30)
        with pytest.raises(ModerationUnavailableInvocationError) as terminal:
            handler.moderation_completion("final output")
    assert failure.value is terminal.value
    assert gateway.calls == 1


@pytest.mark.parametrize("advanced", [False, True])
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize(
    ("action", "preset"), [("direct_output", "Refused"), ("direct_output", ""), ("overridden", "Unused preset")]
)
def test_sequential_app_replacements_are_delivered_and_persisted_without_final_recheck(
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    advanced: bool,
    stream: bool,
    action: Literal["direct_output", "overridden"],
    preset: str,
) -> None:
    config_overrides(MODERATION_BUFFER_SIZE=5)
    gateway = SegmentGateway(action, preset)
    pipeline: AdvancedChatAppGenerateTaskPipeline | EasyUIBasedGenerateTaskPipeline
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
        conversation_id=conversation.id,
        app_mode=mode,
        message_id=message.id,
    )
    with flask_app.app_context(), message_was_created.muted():
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
        else:
            chat_entity = ChatAppGenerateEntity(
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
                application_generate_entity=chat_entity,
                queue_manager=queue,
                conversation=conversation,
                message=message,
                stream=stream,
            )
        for text in ["safe ", "blocked", " tail"]:
            event = (
                QueueTextChunkEvent(text=text)
                if advanced
                else QueueLLMChunkEvent(
                    chunk=LLMResultChunk(
                        model="test-model",
                        delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=text)),
                    )
                )
            )
            queue.publish(event, PublishFrom.APPLICATION_MANAGER)
        terminal = (
            QueueAdvancedChatMessageEndEvent()
            if advanced
            else QueueMessageEndEvent(
                llm_result=LLMResult(
                    model="test-model",
                    message=AssistantPromptMessage(content="safe blocked tail"),
                    usage=LLMUsage.empty_usage(),
                )
            )
        )
        queue.publish(terminal, PublishFrom.APPLICATION_MANAGER)
        expected = preset if action == "direct_output" else "safe masked tail"
        responses = pipeline._process_stream_response(None)
        if stream:
            converter = AdvancedChatAppGenerateResponseConverter if advanced else ChatAppGenerateResponseConverter
            chunks = list(converter.convert_stream_full_response(pipeline._to_stream_response(responses)))
            public_chunks = [chunk for chunk in chunks if isinstance(chunk, dict)]
            assert public_chunks[-1]["event"] == "message_end"
            visible = ""
            for chunk in public_chunks:
                if chunk.get("event") == "message":
                    visible += chunk["answer"]
                elif chunk.get("event") == "message_replace":
                    visible = chunk["answer"]
            assert visible == expected
            assert not any("blocked" in str(chunk.get("answer", "")) for chunk in public_chunks)
        else:
            response = pipeline._to_blocking_response(responses)
            assert isinstance(response, ChatbotAppBlockingResponse)
            assert response.data.answer == expected
    with sqlite_session_factory() as database:
        saved = database.get(Message, "message-1")
        assert saved is not None
        assert saved.answer == expected
        assert saved.status == MessageStatus.NORMAL
    assert gateway.calls == (["safe ", "blocked"] if action == "direct_output" else ["safe ", "blocked", " tail"])


@pytest.mark.parametrize("advanced", [False, True])
@pytest.mark.parametrize("phase", ["input", "output"])
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("previous_answer", ["", "approved prefix"])
def test_default_chat_reply_finishes_and_persists_without_app_configuration(
    sqlite_session_factory: sessionmaker[Session],
    advanced: bool,
    phase: ModerationPhase,
    stream: bool,
    previous_answer: str,
) -> None:
    mode = AppMode.ADVANCED_CHAT if advanced else AppMode.CHAT
    config = app_config().model_copy(update={"app_mode": mode, "sensitive_word_avoidance": None})
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
    pipeline: AdvancedChatAppGenerateTaskPipeline | EasyUIBasedGenerateTaskPipeline
    flask_app = Flask(__name__)
    with flask_app.app_context(), message_was_created.muted():
        if advanced:
            advanced_entity = AdvancedChatAppGenerateEntity(
                task_id="task-1",
                app_config=WorkflowUIBasedAppConfig(**config.model_dump(), workflow_id="workflow-1"),
                query="query",
                inputs={},
                files=[],
                user_id="account-1",
                stream=stream,
                invoke_from=InvokeFrom.DEBUGGER,
            )
            pipeline = AdvancedChatAppGenerateTaskPipeline(
                application_generate_entity=advanced_entity,
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
            pipeline._task_state.answer = previous_answer
        else:
            chat_entity = ChatAppGenerateEntity(
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
                application_generate_entity=chat_entity,
                queue_manager=queue,
                conversation=conversation,
                message=message,
                stream=stream,
            )
            pipeline._task_state.llm_result.message.content = previous_answer
            if phase == "output":
                pipeline._task_state.llm_result.usage = LLMUsage.empty_usage().model_copy(
                    update={"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5}
                )
        queue.publish_error(
            PlatformModerationRejectedInvocationError(phase, "Platform rejected content"), PublishFrom.TASK_PIPELINE
        )
        responses = pipeline._process_stream_response(None)
        if stream:
            converter = AdvancedChatAppGenerateResponseConverter if advanced else ChatAppGenerateResponseConverter
            chunks = list(converter.convert_stream_full_response(pipeline._to_stream_response(responses)))
            assert len(chunks) == 2
            assert isinstance(chunks[0], dict)
            assert chunks[0]["event"] == ("message_replace" if previous_answer else "message")
            assert chunks[0]["answer"] == DEFAULT_CHAT_MODERATION_REPLY
            assert isinstance(chunks[-1], dict)
            assert chunks[-1]["event"] == "message_end"
        else:
            result = pipeline._to_blocking_response(responses)
            assert result.data.answer == DEFAULT_CHAT_MODERATION_REPLY
    with sqlite_session_factory() as database:
        saved = database.get(Message, "message-1")
        assert saved is not None
        assert saved.answer == DEFAULT_CHAT_MODERATION_REPLY
        assert saved.status == MessageStatus.NORMAL
        assert saved.error is None
        if not advanced and phase == "output":
            assert saved.message_tokens == 3
            assert saved.answer_tokens == 2
