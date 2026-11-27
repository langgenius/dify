import json
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Barrier
from time import perf_counter
from typing import Literal, override

import httpx
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
from core.app.apps.base_app_runner import AppRunner
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
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit
from core.helper import ssrf_proxy as ssrf_module
from core.model_manager import ModelInstance
from core.moderation.base import ModerationAction, ModerationInputsResult, ModerationOutputsResult
from core.moderation.factory import get_app_moderation
from core.moderation.input_moderation import InputModeration
from core.moderation.output_moderation import ModerationRule as OutputModerationRule
from core.moderation.output_moderation import OutputModeration
from enums import DeploymentEdition
from events.message_event import message_was_created
from extensions.application_services.app_moderation import (
    DEFAULT_CHAT_MODERATION_REPLY,
    AppModeration,
    app_output_evaluator,
    app_rejection_replacement,
    evaluate_app_input,
)
from extensions.application_services.moderation import build_llm_moderation_guard, build_moderation_service
from extensions.ext_code_based_extension import code_based_extension
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, UserPromptMessage
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.runtime import RuntimeState
from machinery.context import AppRequestContext
from models.enums import ConversationFromSource, MessageStatus
from models.model import AppMode, Conversation, Message
from models.provider import ProviderType
from services.moderation_adapters import LLMModerationGuard
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
from tests.helpers.unit.core.model_moderation_fixtures import RecordingLLM, make_tenant_moderation_provider
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


class TransientAppFailureGateway:
    def __init__(self) -> None:
        self.calls = 0

    def check(
        self, context: AppRequestContext, *, rule: ModerationRule, request: ModerationRequest, phase: ModerationPhase
    ) -> ModerationVerdict:
        assert context.tenant_id == "tenant-1"
        assert rule.type in {"keywords", "api"}
        assert isinstance(request.text, str)
        assert phase in {"input", "output"}
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


def test_model_owns_input_checks_and_app_only_renders_rejection(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, HOSTED_MODERATION_ENABLED=True)
    gateway = RecordingGateway()
    service = ModerationService(gateway=gateway)
    rule = ModerationRule(
        type="openai_moderation", config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": True}}
    )

    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="tenant-1", app_id="app-1"), service=service, rule=rule, platform=True
    )
    config = app_config()
    app_result = evaluate_app_input(config, {}, "safe", platform_owned=True)
    assert app_result is not None
    assert not app_result.flagged
    guard.check_inputs([UserPromptMessage(content="safe")])
    assert gateway.calls == [("safe", "input")]
    with pytest.raises(PlatformModerationRejectedInvocationError) as rejected:
        guard.check_inputs([UserPromptMessage(content="blocked")])
    assert app_rejection_replacement(config, rejected.value) == ("App input replacement", "input")
    app_result = evaluate_app_input(config, {}, "blocked", platform_owned=True)
    assert app_result is not None
    assert not app_result.flagged
    assert gateway.calls == [("safe", "input"), ("blocked", "input")]


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
        if phase == "input":
            return evaluate_app_input(config, {"key": "value"}, "query", platform_owned=False)
        evaluator = app_output_evaluator(config, platform_owned=False)
        return evaluator("output") if evaluator is not None else None

    if scenario == "invalid_phase":
        error_type = ValueError if phase == "input" else ModerationUnavailableInvocationError
        with pytest.raises(error_type):
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
    result = evaluate_app_input(config, {"input_key": "value"}, "query", platform_owned=False)

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
    evaluator = app_output_evaluator(config, platform_owned=False)
    assert evaluator is not None
    result = evaluator("model output")

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


@pytest.mark.parametrize("backend", ["keywords", "api"])
def test_app_input_backend_failure_exposes_only_the_safe_unavailable_error(
    monkeypatch: pytest.MonkeyPatch, backend: str
) -> None:
    gateway = TransientAppFailureGateway()
    service = ModerationService(gateway=gateway)
    monkeypatch.setattr("extensions.application_services.app_moderation._app_service", lambda: service)
    config = app_config(backend)
    with pytest.raises(ModerationUnavailableInvocationError) as failure:
        InputModeration().check(
            app_id=config.app_id,
            tenant_id=config.tenant_id,
            app_config=config,
            inputs={},
            query="query",
            message_id="message-1",
            trace_scope=None,
        )
    assert str(failure.value) == "This message can’t be processed right now. Please try again later."
    assert isinstance(failure.value.__cause__, ValueError)
    assert "private backend diagnostic" in str(failure.value.__cause__)
    assert app_rejection_replacement(config, failure.value) is None
    assert gateway.calls == 1


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
def test_only_direct_chat_modes_get_a_default_platform_rejection_reply(mode: AppMode, phase: ModerationPhase) -> None:
    config = app_config().model_copy(update={"app_mode": mode, "sensitive_word_avoidance": None})
    rejected = PlatformModerationRejectedInvocationError(phase, "Rejected")
    expected = (
        (DEFAULT_CHAT_MODERATION_REPLY, phase)
        if mode
        in {
            AppMode.CHAT,
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


@pytest.mark.parametrize(
    ("edition", "enabled", "provider_type", "quota_unit", "hosted"),
    [
        (DeploymentEdition.COMMUNITY, True, ProviderType.CUSTOM, QuotaUnit.CREDITS, False),
        (DeploymentEdition.ENTERPRISE, False, ProviderType.CUSTOM, QuotaUnit.CREDITS, False),
        (DeploymentEdition.CLOUD, False, ProviderType.SYSTEM, QuotaUnit.CREDITS, False),
        (DeploymentEdition.CLOUD, True, ProviderType.CUSTOM, QuotaUnit.CREDITS, False),
        (DeploymentEdition.CLOUD, True, ProviderType.SYSTEM, QuotaUnit.TOKENS, False),
        (DeploymentEdition.CLOUD, True, ProviderType.SYSTEM, QuotaUnit.CREDITS, True),
    ],
)
@pytest.mark.parametrize("registered", [False, True], ids=["standalone", "registered"])
def test_direct_app_routes_input_and_output_to_exactly_one_openai_backend(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    unbound_session_factory: sessionmaker[Session],
    edition: DeploymentEdition,
    enabled: bool,
    provider_type: ProviderType,
    quota_unit: QuotaUnit,
    hosted: bool,
    registered: bool,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=edition,
        HOSTED_MODERATION_ENABLED=enabled,
        HOSTED_OPENAI_API_KEY="platform-key",
        HOSTED_MODERATION_CACHE_TTL=0,
    )
    code_based_extension.init()
    tenant_provider, tenant_client = make_tenant_moderation_provider()
    monkeypatch.setattr("core.model_manager.create_plugin_provider_manager", lambda **_: tenant_provider)
    hosted_batches: list[list[str]] = []

    def moderate(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer platform-key"
        texts: list[str] = json.loads(request.content)["input"]
        hosted_batches.append(texts)
        return httpx.Response(200, json={"results": [{"flagged": "blocked" in text} for text in texts]})

    flask_app = Flask(__name__)
    monkeypatch.setattr("core.moderation.input_moderation.get_app_moderation", get_app_moderation)
    monkeypatch.setattr("core.app.task_pipeline.based_generate_task_pipeline.get_app_moderation", get_app_moderation)
    if registered:
        flask_app.extensions["app_moderation"] = AppModeration()
        flask_app.extensions["application_services"] = ModerationServices(
            build_moderation_service(database_client=unbound_session_factory)
        )

    model_conf = make_model_config(provider="test-provider", model="test-model", mode="chat")
    bundle = model_conf.provider_model_bundle
    template = bundle.model_type_instance
    assert isinstance(template, LargeLanguageModel)
    bundle.model_type_instance = RecordingLLM(template, ["blocked output"])
    bundle.configuration.using_provider_type = provider_type
    system = bundle.configuration.system_configuration
    system.current_quota_type = ProviderQuotaType.PAID
    system.quota_configurations = [
        QuotaConfiguration(
            quota_type=ProviderQuotaType.PAID, quota_unit=quota_unit, quota_limit=100, quota_used=0, is_valid=True
        )
    ]
    config = EasyUIBasedAppConfig(
        **app_config().model_copy(update={"tenant_id": bundle.configuration.tenant_id}).model_dump(),
        app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
        app_model_config_dict={},
        model=ModelConfigEntity(provider="test-provider", model="test-model"),
        prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
    )
    entity = ChatAppGenerateEntity(
        task_id="task-1",
        app_config=config,
        model_conf=model_conf,
        inputs={},
        files=[],
        user_id="account-1",
        stream=False,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    queue = MessageBasedAppQueueManager(
        task_id=entity.task_id,
        user_id=entity.user_id,
        invoke_from=entity.invoke_from,
        conversation_id="conversation-1",
        app_mode=AppMode.CHAT,
        message_id="message-1",
    )
    with httpx.Client(transport=httpx.MockTransport(moderate)) as transport, flask_app.app_context():
        monkeypatch.setattr(ssrf_module, "_get_ssrf_client", lambda _verify: transport)
        pipeline = BasedGenerateTaskPipeline(application_generate_entity=entity, queue_manager=queue, stream=False)
        assert AppRunner().moderation_for_inputs(
            app_id=config.app_id,
            tenant_id=config.tenant_id,
            app_generate_entity=entity,
            inputs={},
            query="safe input",
            message_id="message-1",
        ) == (False, {}, "safe input")
        model = ModelInstance(bundle, model_conf.model, credentials={})
        prompt: list[PromptMessage] = [UserPromptMessage(content="safe input")]
        if hosted:
            assert pipeline.output_moderation_handler is None
            with pytest.raises(PlatformModerationRejectedInvocationError) as rejection:
                model.invoke_llm(prompt, stream=False)
            replacement = ("App output replacement", "output") if registered else None
            assert pipeline.moderation_replacement(rejection.value) == replacement
        else:
            result = model.invoke_llm(prompt, stream=False)
            assert isinstance(result, LLMResult)
            assert pipeline.handle_output_moderation_when_task_finished(result.message.get_text_content()) == (
                "App output replacement"
            )

    if hosted:
        assert hosted_batches == [["safe input"], ["blocked output"]]
        assert not tenant_client.calls
    else:
        assert not hosted_batches
        assert [(credentials, text) for _, _, _, _, credentials, text, _ in tenant_client.calls] == [
            ({"openai_api_key": "tenant-key"}, "safe input"),
            ({"openai_api_key": "tenant-key"}, "blocked output"),
        ]


@pytest.mark.parametrize("phase", ["input", "output"])
@pytest.mark.parametrize("previous_answer", ["", "safe prefix"])
def test_chat_pipeline_renders_platform_rejection_with_existing_app_reply_events(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    phase: ModerationPhase,
    previous_answer: str,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, HOSTED_MODERATION_ENABLED=True)
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
    gateway = TransientAppFailureGateway()
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
    gateway = TransientAppFailureGateway()
    flask_app = Flask(__name__)
    flask_app.extensions["application_services"] = ModerationServices(ModerationService(gateway=gateway))
    config = app_config("api")
    rule = config.sensitive_word_avoidance
    assert rule is not None
    handler = OutputModeration(
        tenant_id="tenant-1",
        app_id="app-1",
        rule=OutputModerationRule(type=rule.type, config=rule.config),
        output_evaluator=app_output_evaluator(config, platform_owned=False),
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
    ("action", "preset", "prefix"),
    [
        ("direct_output", "Refused", "safe "),
        ("direct_output", "", "safe "),
        ("overridden", "Unused preset", "safe "),
        ("direct_output", "Refused", ""),
    ],
)
def test_sequential_app_replacements_are_delivered_and_persisted_without_final_recheck(
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    advanced: bool,
    stream: bool,
    action: Literal["direct_output", "overridden"],
    preset: str,
    prefix: str,
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
        for text in [prefix[:2], prefix[2:], "blo", "cked", " en", "d"]:
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
                    message=AssistantPromptMessage(content=prefix + "blocked end"),
                    usage=LLMUsage.empty_usage(),
                )
            )
        )
        queue.publish(terminal, PublishFrom.APPLICATION_MANAGER)
        expected = preset if action == "direct_output" else prefix + "masked end"
        responses = pipeline._process_stream_response(None)
        if stream:
            converter = AdvancedChatAppGenerateResponseConverter if advanced else ChatAppGenerateResponseConverter
            chunks = list(converter.convert_stream_full_response(pipeline._to_stream_response(responses)))
            public_chunks = [chunk for chunk in chunks if isinstance(chunk, dict)]
            assert public_chunks[-1]["event"] == "message_end"
            assert public_chunks[0]["event"] == "message"
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
    assert gateway.calls == ([prefix] if prefix else []) + ["blocked"] + ([" end"] if action == "overridden" else [])


@pytest.mark.parametrize("phase", ["input", "output"])
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("previous_answer", ["", "approved prefix"])
def test_default_chat_reply_finishes_and_persists_without_app_configuration(
    sqlite_session_factory: sessionmaker[Session],
    phase: ModerationPhase,
    stream: bool,
    previous_answer: str,
) -> None:
    mode = AppMode.CHAT
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
    flask_app = Flask(__name__)
    with flask_app.app_context(), message_was_created.muted():
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
            chunks = list(
                ChatAppGenerateResponseConverter.convert_stream_full_response(pipeline._to_stream_response(responses))
            )
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
        if phase == "output":
            assert saved.message_tokens == 3
            assert saved.answer_tokens == 2
