from __future__ import annotations

import json
from collections.abc import Callable, Generator, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import wraps
from inspect import unwrap
from typing import cast, override
from uuid import UUID, uuid4

import httpx
import pytest
from dify_agent.protocol import RunFailureType
from flask import Flask
from flask.typing import ResponseReturnValue
from flask_restx import Resource
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from clients.agent_backend import AgentBackendRunEventAdapter, AgentBackendRunFailedInternalEvent
from clients.agent_backend.errors import AgentBackendHTTPError, AgentBackendRunFailedError, AgentBackendTransportError
from controllers.console.app import completion as completion_module
from controllers.inner_api import bp as inner_api_bp
from core.app.app_config.easy_ui_based_app.model_config import manager as model_config_manager_module
from core.app.app_config.entities import (
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.agent_app.app_generator import AgentAppGenerator
from core.app.apps.agent_app.app_runner import _agent_backend_failure_to_exception
from core.app.apps.agent_app.generate_response_converter import AgentAppGenerateResponseConverter
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import QueueErrorEvent
from core.app.entities.task_entities import (
    AppStreamResponse,
    ChatbotAppStreamResponse,
    MessageEndStreamResponse,
    MessageStreamResponse,
    PingStreamResponse,
)
from core.app.features.rate_limiting.rate_limit import RateLimitGenerator
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from core.entities.provider_configuration import ProviderConfigurations
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.logging.context import clear_request_context, get_trace_id, init_request_context
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from core.plugin.impl import base as plugin_base
from core.plugin.impl.exc import (
    PluginDaemonClientSideError,
    PluginDaemonError,
    PluginDaemonInternalError,
    PluginDaemonInternalServerError,
    PluginDaemonNotFoundError,
    PluginDaemonUnauthorizedError,
    PluginInvokeError,
    PluginRuntimeError,
)
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from enums import DeploymentEdition
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError, InvokeRateLimitError
from libs.external_api import ExternalApi
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.model import AppMode, AppModelConfig
from models.provider import Provider, ProviderCredential
from services.agent_llm_inner_service import AgentLLMInnerService, PreparedAgentLLMInvocation
from services.entities.agent_llm_inner import AgentLLMInvokeRequest
from tests.helpers.unit.controllers.agent_llm_gateway import gateway_failure_event
from tests.helpers.unit.core.model_fixtures import make_model_instance
from tests.helpers.unit.model_factories import make_account, make_app

_TENANT_ID = "tenant-1"
_PROVIDER_ID = "langgenius/openai/openai"
_MODEL_ID = "gpt-4o-mini"


def _install_model_discovery(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace plugin-daemon I/O while retaining the production model validation objects."""
    provider = ProviderEntity(
        provider=_PROVIDER_ID,
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[],
    )
    model = ModelWithProviderEntity(
        model=_MODEL_ID,
        label=I18nObject(en_US="GPT-4o mini"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.MODE: "chat"},
        status=ModelStatus.ACTIVE,
        provider=SimpleModelProviderEntity(provider),
    )
    assembly = PluginModelAssembly(tenant_id=_TENANT_ID)
    configurations = ProviderConfigurations(tenant_id=_TENANT_ID)

    def get_providers() -> list[ProviderEntity]:
        return [provider]

    def get_configurations(tenant_id: str) -> ProviderConfigurations:
        assert tenant_id == _TENANT_ID
        return configurations

    def get_models(
        self: ProviderConfigurations, *, provider: str, model_type: ModelType
    ) -> list[ModelWithProviderEntity]:
        assert self is configurations
        assert provider == _PROVIDER_ID
        assert model_type == ModelType.LLM
        return [model]

    def create_assembly(*, tenant_id: str) -> PluginModelAssembly:
        assert tenant_id == _TENANT_ID
        return assembly

    monkeypatch.setattr(assembly.model_provider_factory, "get_providers", get_providers)
    monkeypatch.setattr(assembly.provider_manager, "get_configurations", get_configurations)
    monkeypatch.setattr(ProviderConfigurations, "get_models", get_models)
    monkeypatch.setattr(model_config_manager_module, "create_plugin_model_assembly", create_assembly)


def test_chat_message_rejects_empty_agent_tool_as_invalid_param(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    """The debugger HTTP path rejects malformed tools before generation starts."""
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        APP_DEFAULT_ACTIVE_REQUESTS=0,
        APP_MAX_ACTIVE_REQUESTS=0,
    )
    _install_model_discovery(monkeypatch)

    account = make_account(account_id=str(uuid4()))
    app_id = str(uuid4())
    stored_config = AppModelConfig(app_id=app_id, created_by=account.id, updated_by=account.id)
    app_model = make_app(
        app_id=app_id,
        tenant_id=_TENANT_ID,
        mode=AppMode.AGENT_CHAT,
        app_model_config_id=stored_config.id,
        max_active_requests=0,
        created_by=account.id,
    )
    sqlite_session.add_all([stored_config, app_model])
    sqlite_session.commit()

    class ChatMessageHttpResource(Resource):
        def post(self) -> ResponseReturnValue:
            # Admission is supplied by this harness; parsing, generation validation,
            # and HTTP error translation remain the real production path.
            return unwrap(completion_module.ChatMessageApi.post)(
                completion_module.ChatMessageApi(), sqlite_session, _TENANT_ID, account, app_model
            )

    http_app = Flask(__name__)
    http_app.config.update(TESTING=True)
    ExternalApi(http_app).add_resource(ChatMessageHttpResource, "/chat-messages")

    response = http_app.test_client().post(
        "/chat-messages",
        json={
            "inputs": {},
            "query": "hello",
            "response_mode": "streaming",
            "model_config": {
                "model": {
                    "provider": _PROVIDER_ID,
                    "name": _MODEL_ID,
                    "completion_params": {},
                },
                "agent_mode": {
                    "enabled": True,
                    "strategy": "router",
                    "tools": [{}],
                },
            },
        },
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "code": "invalid_param",
        "message": "Each item in agent_mode.tools must be a non-empty object",
        "status": 400,
    }


@dataclass
class _GenerationObservation:
    """Keep the HTTP stream alive so only explicit close/exhaustion can satisfy cleanup checks."""

    calls: list[dict[str, object]] = field(default_factory=list)
    consumed_events: list[str] = field(default_factory=list)
    stream: Generator[str] | None = None
    closed: bool = False


def _post_agent_stream_outcome(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    *,
    route: str,
    error: Exception | None,
    incomplete: bool = False,
    emit_partial_message: bool = False,
    external_trace: bool = True,
    wire_chunks: tuple[str, ...] | None = None,
) -> tuple[TestResponse, _GenerationObservation]:
    """Supply runtime outcomes while exercising real routing, roster lookup, pipeline and SSE/HTTP conversion."""
    account = make_account(account_id=str(uuid4()))
    app_model = make_app(app_id=str(uuid4()), tenant_id=_TENANT_ID, mode=AppMode.AGENT, max_active_requests=0)
    agent = Agent(
        id=str(uuid4()),
        tenant_id=_TENANT_ID,
        app_id=app_model.id,
        name="Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        created_by=account.id,
        updated_by=account.id,
    )
    session.add_all([app_model, agent])
    session.commit()
    observation = _GenerationObservation()

    def generate(
        _self: AgentAppGenerator, *, args: Mapping[str, object], **_kwargs: object
    ) -> Generator[Mapping[str, object] | str]:
        conversation_id = str(args["conversation_id"])
        observation.calls.append(dict(args))
        observation.calls[-1]["fallback_trace_id"] = get_trace_id()
        entity = AppGenerateEntity(
            task_id="task-1",
            inputs={},
            files=[],
            user_id=account.id,
            stream=True,
            invoke_from=InvokeFrom.DEBUGGER,
            app_config=EasyUIBasedAppConfig(
                tenant_id=_TENANT_ID,
                app_id=app_model.id,
                app_mode=AppMode.AGENT,
                app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
                app_model_config_dict={},
                model=ModelConfigEntity(provider="openai", model="gpt-test", mode="chat"),
                prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
            ),
        )
        queue = MessageBasedAppQueueManager(
            task_id=entity.task_id,
            user_id=account.id,
            invoke_from=InvokeFrom.DEBUGGER,
            conversation_id=conversation_id,
            app_mode=AppMode.AGENT,
            message_id="message-1",
        )
        pipeline = BasedGenerateTaskPipeline(entity, queue, stream=True)

        def stream() -> Generator[AppStreamResponse]:
            observation.consumed_events.append("ping")
            yield ChatbotAppStreamResponse(
                conversation_id=conversation_id,
                message_id="message-1",
                created_at=1,
                stream_response=PingStreamResponse(task_id=entity.task_id),
            )
            if emit_partial_message or incomplete:
                observation.consumed_events.append("message")
                yield ChatbotAppStreamResponse(
                    conversation_id=conversation_id,
                    message_id="message-1",
                    created_at=1,
                    stream_response=MessageStreamResponse(task_id=entity.task_id, id="message-1", answer="working"),
                )
            if error is not None:
                observation.consumed_events.append("error")
                failure = pipeline.handle_error(event=QueueErrorEvent(error=error))
                yield ChatbotAppStreamResponse(
                    conversation_id=conversation_id,
                    message_id="message-1",
                    created_at=1,
                    stream_response=pipeline.error_to_stream_response(failure),
                )
            elif not incomplete:
                observation.consumed_events.append("message_end")
                yield ChatbotAppStreamResponse(
                    conversation_id=conversation_id,
                    message_id="message-1",
                    created_at=1,
                    stream_response=MessageEndStreamResponse(task_id=entity.task_id, id="message-1", metadata={}),
                )

        return AgentAppGenerateResponseConverter.convert_stream_full_response(stream())

    monkeypatch.setattr(AgentAppGenerator, "generate", generate)
    original_generate = cast(Callable[..., RateLimitGenerator], completion_module.AppGenerateService.generate)

    def generate_response(**kwargs: object) -> Generator[str]:
        source = iter(wire_chunks) if wire_chunks is not None else original_generate(**kwargs)

        def observed_stream() -> Generator[str]:
            try:
                yield from source
            finally:
                observation.closed = True

        observation.stream = observed_stream()
        return observation.stream

    monkeypatch.setattr(completion_module.AppGenerateService, "generate", generate_response)
    resource_type = {
        "finalize": completion_module.AgentBuildChatFinalizeApi,
        "agent_chat": completion_module.AgentChatMessageApi,
        "app_chat": completion_module.ChatMessageApi,
    }[route]

    handler = cast(Callable[..., ResponseReturnValue], resource_type.post)

    class AgentHttpResource(Resource):
        @wraps(handler)
        def post(self) -> ResponseReturnValue:
            # Authentication/admission are supplied; the production handler and
            # its OpenAPI error declarations are retained on this real HTTP route.
            view = unwrap(handler)
            if route == "app_chat":
                return view(resource_type(), session, _TENANT_ID, account, app_model)
            return view(resource_type(), session, _TENANT_ID, account, UUID(agent.id))

    http_app = Flask(__name__)
    http_app.config.update(TESTING=True)
    http_app.before_request(init_request_context)
    http_app.teardown_request(lambda _error: clear_request_context())
    ExternalApi(http_app).add_resource(AgentHttpResource, "/agent-stream")
    response = http_app.test_client().post(
        "/agent-stream",
        json={"query": "hello", "inputs": {}, "draft_type": "debug_build", "response_mode": "streaming"},
        headers={"X-Trace-Id": "external-trace-1"} if external_trace else {},
    )
    return response, observation


@pytest.mark.parametrize("route", ["finalize", "agent_chat", "app_chat"])
@pytest.mark.parametrize(
    ("error", "status", "code", "source"),
    [
        (InvokeRateLimitError("provider busy"), 429, "rate_limit_error", "model_provider"),
        (
            ProviderTokenNotInitError("Configure provider credentials."),
            400,
            "provider_not_initialize",
            "model_provider",
        ),
        (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support", "model_provider"),
        (InvokeAuthorizationError("private credential detail"), 400, "completion_request_error", "model_provider"),
        (PluginRuntimeError("plugin unavailable"), 502, "plugin_runtime_error", "plugin_daemon"),
        (
            AgentBackendHTTPError(
                "backend busy", status_code=503, detail={}, error_code="backend_busy", run_id="run-1"
            ),
            503,
            "backend_busy",
            "agent_backend",
        ),
        (
            AgentBackendTransportError("connection refused", run_id="run-1"),
            502,
            "agent_backend_unreachable",
            "agent_backend",
        ),
        (
            AgentBackendRunFailedError(
                "run-1", {}, message="run limit reached", error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED
            ),
            400,
            "agent_run_limit_exceeded",
            "agent_backend",
        ),
        (RuntimeError("private worker detail"), 500, "internal_server_error", "internal"),
        (
            _agent_backend_failure_to_exception(
                AgentBackendRunFailedInternalEvent(
                    run_id="run-1", error="private internal reason", reason="AgentLLMInternalError"
                )
            ),
            500,
            "internal_server_error",
            "internal",
        ),
    ],
)
def test_agent_http_errors_keep_status_code_and_diagnostics(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    route: str,
    error: Exception,
    status: int,
    code: str,
    source: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, APP_DEFAULT_ACTIVE_REQUESTS=0, APP_MAX_ACTIVE_REQUESTS=0
    )
    response, observation = _post_agent_stream_outcome(sqlite_session, monkeypatch, route=route, error=error)

    assert response.status_code == status
    body = response.get_json()
    assert body["status"] == status
    assert body["code"] == code
    assert body["details"]["error_source"] == source
    assert body["details"]["trace_id"] == "external-trace-1"
    assert body["details"]["request_id"]
    assert body["details"]["conversation_id"] == observation.calls[0]["conversation_id"]
    assert body["details"]["message_id"] == "message-1"
    assert body["details"]["task_id"] == "task-1"
    assert all(value is not None and value != "" for value in body["details"].values())
    assert len(response.data) < 1000
    assert observation.calls[0]["external_trace_id"] == "external-trace-1"
    assert observation.closed
    assert f"status={status} code={code}" in caplog.text
    if status == 500:
        assert body["message"] == "Internal Server Error, please contact support."
        assert "RuntimeError" not in str(body)
        assert "private worker detail" not in str(body)
        assert "private internal reason" not in str(body)
        assert "reason" not in body["details"]
        assert "error_type" not in body["details"]
        if isinstance(error, RuntimeError):
            assert "private worker detail" in caplog.text
        else:
            assert body["details"]["agent_run_id"] == "run-1"
    if isinstance(error, InvokeAuthorizationError):
        assert body["message"] == "Incorrect API key provided"
    if isinstance(error, AgentBackendRunFailedError | AgentBackendTransportError | AgentBackendHTTPError):
        assert body["details"]["agent_run_id"] == "run-1"


def test_finalize_waits_for_terminal_event_after_partial_output(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, APP_DEFAULT_ACTIVE_REQUESTS=0, APP_MAX_ACTIVE_REQUESTS=0
    )
    response, observation = _post_agent_stream_outcome(
        sqlite_session, monkeypatch, route="finalize", error=None, emit_partial_message=True
    )
    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}
    assert observation.consumed_events == ["ping", "message", "message_end"]
    query = str(observation.calls[0]["query"])
    assert "Only update the build-draft config note" in query
    assert "respond FINISHED" in query
    assert observation.calls[0]["draft_type"] == "debug_build"
    assert observation.closed


def test_finalize_reports_error_after_partial_output(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, APP_DEFAULT_ACTIVE_REQUESTS=0, APP_MAX_ACTIVE_REQUESTS=0
    )
    response, observation = _post_agent_stream_outcome(
        sqlite_session, monkeypatch, route="finalize", error=InvokeRateLimitError("busy"), emit_partial_message=True
    )
    assert response.status_code == 429
    assert response.get_json()["code"] == "rate_limit_error"
    assert "last_event" not in response.get_json()["details"]
    assert observation.consumed_events == ["ping", "message", "error"]
    assert observation.closed


def test_finalize_incomplete_stream_retains_last_ids_and_fallback_trace(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, APP_DEFAULT_ACTIVE_REQUESTS=0, APP_MAX_ACTIVE_REQUESTS=0
    )
    response, observation = _post_agent_stream_outcome(
        sqlite_session, monkeypatch, route="finalize", error=None, incomplete=True, external_trace=False
    )
    assert response.status_code == 502
    body = response.get_json()
    assert body["code"] == "agent_stream_incomplete"
    assert body["message"] == "Build chat finalization did not complete."
    assert body["details"]["last_event"] == "message"
    assert body["details"]["task_id"] == "task-1"
    assert body["details"]["message_id"] == "message-1"
    assert body["details"]["error_source"] == "console_stream"
    assert body["details"]["reason"] == "missing_terminal_event"
    assert body["details"]["trace_id"] == observation.calls[0]["fallback_trace_id"]
    assert observation.closed


def test_chat_keeps_successful_stream_chunks_in_order(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, APP_DEFAULT_ACTIVE_REQUESTS=0, APP_MAX_ACTIVE_REQUESTS=0
    )
    response, observation = _post_agent_stream_outcome(
        sqlite_session, monkeypatch, route="agent_chat", error=None, emit_partial_message=True
    )
    assert response.status_code == 200
    frames = response.get_data(as_text=True).strip().split("\n\n")
    assert frames[0] == "event: ping"
    messages = [json.loads(frame.removeprefix("data: ")) for frame in frames[1:]]
    assert [message["event"] for message in messages] == ["message", "message_end"]
    assert messages[0]["answer"] == "working"
    assert observation.closed


@pytest.mark.parametrize(
    ("chunk", "status", "code"),
    [
        (
            'event: error\r\ndata: {"status": 429,\r\ndata: "code": "rate_limit_error"}\r\n\r\n',
            429,
            "rate_limit_error",
        ),
        (
            'event: ping\n\ndata: []\n\ndata: broken-json\n\ndata: {"event": "error", "message": "failed"}\n\n',
            400,
            "completion_request_error",
        ),
        (
            'data: null\n\ndata: {"event": "message", "answer": "done"}\n\ndata: {"event":"message_end"}\n\n',
            200,
            None,
        ),
    ],
)
@pytest.mark.parametrize("route", ["finalize", "agent_chat"])
def test_http_stream_handles_named_multiline_and_non_object_frames(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    route: str,
    chunk: str,
    status: int,
    code: str | None,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, APP_DEFAULT_ACTIVE_REQUESTS=0, APP_MAX_ACTIVE_REQUESTS=0
    )
    response, observation = _post_agent_stream_outcome(
        sqlite_session,
        monkeypatch,
        route=route,
        error=None,
        wire_chunks=("event: ping\n\n", chunk),
    )
    assert response.status_code == status
    if code is not None:
        assert response.get_json()["code"] == code
        assert response.get_json()["status"] == status
        assert observation.closed
    elif route == "finalize":
        assert response.get_json() == {"result": "success"}
        assert observation.closed
    else:
        assert response.get_data(as_text=True) == "event: ping\n\n" + chunk
        assert observation.closed


@pytest.mark.parametrize(
    ("route", "fallback"), [("finalize", "Build chat finalization failed."), ("agent_chat", "Agent App chat failed.")]
)
def test_http_legacy_error_uses_fallback_omits_empty_details_and_closes_retained_stream(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    route: str,
    fallback: str,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, APP_DEFAULT_ACTIVE_REQUESTS=0, APP_MAX_ACTIVE_REQUESTS=0
    )
    response, observation = _post_agent_stream_outcome(
        sqlite_session,
        monkeypatch,
        route=route,
        error=None,
        wire_chunks=('data: {"event":"error","details":{"agent_run_id":null,"reason":""}}\n\n',),
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body["code"] == "completion_request_error"
    assert body["status"] == 400
    assert body["message"] == fallback
    assert "agent_run_id" not in body["details"]
    assert "reason" not in body["details"]
    assert observation.stream is not None
    assert observation.closed


@pytest.mark.parametrize("route", ["finalize", "agent_chat"])
@pytest.mark.parametrize(
    ("preflight", "emit_partial_chunk"),
    [(True, False), (False, False), (False, True)],
    ids=["preflight", "invoke-establishment", "stream-after-chunk"],
)
@pytest.mark.parametrize(
    ("source_error", "status", "code", "origin"),
    [
        (PluginRuntimeError("plugin unavailable"), 502, "plugin_runtime_error", "plugin_daemon"),
        (PluginDaemonInternalError("daemon failed"), 502, "plugin_runtime_error", "plugin_daemon"),
        (PluginDaemonInternalServerError("daemon failed"), 502, "plugin_runtime_error", "plugin_daemon"),
        (PluginDaemonUnauthorizedError("daemon unauthorized"), 502, "plugin_runtime_error", "plugin_daemon"),
        (PluginDaemonNotFoundError("daemon missing"), 502, "plugin_runtime_error", "plugin_daemon"),
        (
            PluginDaemonClientSideError("invalid plugin request"),
            400,
            "completion_request_error",
            "plugin_daemon",
        ),
        (PluginInvokeError("invalid plugin invocation"), 400, "completion_request_error", "plugin_daemon"),
        (
            PluginInvokeError('{"error_type":"InvokeRateLimitError","message":"provider busy"}'),
            429,
            "rate_limit_error",
            "model_provider",
        ),
        (InvokeError("explicit invocation failure"), 400, "completion_request_error", "model_provider"),
        (InvokeRateLimitError("provider busy"), 429, "rate_limit_error", "model_provider"),
        (
            ProviderTokenNotInitError("Configure provider credentials."),
            400,
            "provider_not_initialize",
            "model_provider",
        ),
        (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support", "model_provider"),
        (QuotaExceededError("credits exhausted"), 400, "provider_quota_exceeded", "model_provider"),
        (ProviderTokenNotInitError(), 400, "provider_not_initialize", "model_provider"),
        (RuntimeError("private gateway detail"), 500, "internal_server_error", "internal"),
    ],
)
def test_gateway_failure_survives_real_sdk_and_run_failed_to_console_http(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    source_error: Exception,
    preflight: bool,
    emit_partial_chunk: bool,
    status: int,
    code: str,
    origin: str,
    route: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        APP_DEFAULT_ACTIVE_REQUESTS=0,
        APP_MAX_ACTIVE_REQUESTS=0,
        PLUGIN_DAEMON_KEY="daemon-key",
        INNER_API_KEY_FOR_PLUGIN="inner-key",
    )
    model_instance = make_model_instance(provider="openai", model="gpt-test")
    runtime_events: list[str] = []

    def prepare(_self: AgentLLMInnerService, payload: AgentLLMInvokeRequest) -> PreparedAgentLLMInvocation:
        if preflight:
            raise source_error
        return PreparedAgentLLMInvocation(request=payload, model_instance=model_instance)

    def provider_invoke(**_kwargs: object) -> Generator[LLMResultChunk]:
        runtime_events.append("invoke")
        if not emit_partial_chunk:
            raise source_error

        def stream() -> Generator[LLMResultChunk]:
            runtime_events.append("chunk")
            yield LLMResultChunk(
                model="gpt-test",
                delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="partial answer")),
            )
            runtime_events.append("failure")
            raise source_error

        return stream()

    # Resolve a real model locally; retain service.invoke, ModelInstance and both Graphon wrappers.
    monkeypatch.setattr(AgentLLMInnerService, "prepare", prepare)
    monkeypatch.setattr(model_instance.model_type_instance.model_runtime, "invoke_llm", provider_invoke)
    gateway_app = Flask(__name__)
    gateway_app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    gateway_app.register_blueprint(inner_api_bp)
    terminal = gateway_failure_event(gateway_app)
    assert runtime_events == ([] if preflight else ["invoke", "chunk", "failure"] if emit_partial_chunk else ["invoke"])
    internal_events = AgentBackendRunEventAdapter().adapt(terminal)
    assert len(internal_events) == 1
    internal_event = internal_events[0]
    assert isinstance(internal_event, AgentBackendRunFailedInternalEvent)
    error = _agent_backend_failure_to_exception(internal_event)
    assert isinstance(error.__cause__, AgentBackendRunFailedError)
    response, observation = _post_agent_stream_outcome(sqlite_session, monkeypatch, route=route, error=error)
    if preflight and isinstance(source_error, QuotaExceededError):
        # Preflight HTTP 429 has the SDK's rate-limit reason; streaming quota has its own type.
        status, code = 429, "rate_limit_error"
    assert response.status_code == status
    body = response.get_json()
    assert body["code"] == code
    assert body["details"]["error_source"] == origin
    assert body["details"]["agent_run_id"] == "run-1"
    if origin != "internal" and internal_event.reason:
        assert body["details"]["reason"] == internal_event.reason
    assert observation.closed
    if origin == "internal":
        assert body["message"] == "Internal Server Error, please contact support."
        assert "RuntimeError" not in str(body)
        assert "private gateway detail" not in str(body)
        assert "reason" not in body["details"]
        assert "error_type" not in body["details"]
        assert "private gateway detail" in caplog.text
    elif isinstance(source_error, PluginInvokeError) and "InvokeRateLimitError" in source_error.description:
        assert body["message"] == "provider busy"
    elif origin == "plugin_daemon":
        assert isinstance(source_error, PluginDaemonError)
        assert body["message"] == source_error.description
    elif isinstance(source_error, QuotaExceededError) and not preflight:
        assert body["message"] == (
            "Your quota for Dify Hosted Model Provider has been exhausted. "
            "Please go to Settings -> Model Provider to complete your own provider credentials."
        )
    elif isinstance(source_error, InvokeError | QuotaExceededError):
        assert body["message"] == str(source_error)
    elif isinstance(source_error, ProviderTokenNotInitError | ModelCurrentlyNotSupportError):
        assert body["message"] == source_error.description


@pytest.mark.parametrize("route", ["finalize", "agent_chat"])
@pytest.mark.parametrize(
    "failure_stage", ["preflight", "preflight-invalid-json", "preflight-daemon-error", "invoke", "stream-after-chunk"]
)
def test_plugin_http_failure_survives_real_clients_graphon_sdk_and_console(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    route: str,
    failure_stage: str,
) -> None:
    """Inject only daemon HTTP failures; all preparation, runtime and error adapters execute normally."""
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        APP_DEFAULT_ACTIVE_REQUESTS=0,
        APP_MAX_ACTIVE_REQUESTS=0,
        PLUGIN_DAEMON_KEY="daemon-key",
        INNER_API_KEY_FOR_PLUGIN="inner-key",
        PLUGIN_MODEL_PROVIDERS_CACHE_ENABLED=False,
        PLUGIN_BASED_TOKEN_COUNTING_ENABLED=False,
    )
    schema = AIModelEntity(
        model="gpt-test",
        label=I18nObject(en_US="Test"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
    )
    provider = PluginModelProviderEntity(
        id=str(uuid4()),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        provider="openai",
        tenant_id="tenant-1",
        plugin_id="langgenius/openai",
        plugin_unique_identifier="langgenius/openai:1.0.0@" + "0" * 64,
        installation_source=PluginInstallationSource.Remote,
        declaration=ProviderEntity(
            provider="openai",
            label=I18nObject(en_US="Test"),
            supported_model_types=[ModelType.LLM],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
            models=[schema],
        ),
    )
    credential = ProviderCredential(
        tenant_id="tenant-1",
        provider_name=_PROVIDER_ID,
        credential_name="test",
        # The legacy provider token format needs no encryption service in this local test.
        encrypted_config="unused-test-key",
    )
    sqlite_session.add_all(
        [
            make_app(app_id="app-1", tenant_id="tenant-1", mode=AppMode.AGENT),
            credential,
            Provider(tenant_id="tenant-1", provider_name=_PROVIDER_ID, is_valid=True, credential_id=credential.id),
        ]
    )
    sqlite_session.commit()
    requests: list[httpx.Request] = []
    delivered_chunks: list[str] = []

    class InterruptedPluginStream(httpx.SyncByteStream):
        """Deliver a valid daemon frame before an HTTP transport read failure."""

        @override
        def __iter__(self) -> Iterator[bytes]:
            chunk = LLMResultChunk(
                model="gpt-test",
                delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="partial answer")),
            )
            delivered_chunks.append("partial answer")
            yield (
                "data: " + json.dumps({"code": 0, "message": "", "data": chunk.model_dump(mode="json")}) + "\n\n"
            ).encode()
            raise httpx.ReadTimeout("private transport detail")

    def daemon_http(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if failure_stage == "preflight":
            raise httpx.ConnectError("private transport detail", request=request)
        if failure_stage == "preflight-invalid-json":
            return httpx.Response(200, text="invalid daemon response")
        if failure_stage == "preflight-daemon-error":
            message = json.dumps({"error_type": "PluginDaemonInnerError", "message": "daemon unavailable"})
            return httpx.Response(200, json={"code": -500, "message": message, "data": None})
        if request.url.path.endswith("/management/models"):
            return httpx.Response(200, json={"code": 0, "message": "", "data": [provider.model_dump(mode="json")]})
        if request.url.path.endswith("/dispatch/model/schema"):
            envelope = {"code": 0, "message": "", "data": {"model_schema": schema.model_dump(mode="json")}}
            return httpx.Response(200, text="data: " + json.dumps(envelope) + "\n\n")
        assert request.url.path.endswith("/dispatch/llm/invoke")
        if failure_stage == "invoke":
            raise httpx.ConnectError("private transport detail", request=request)
        return httpx.Response(200, stream=InterruptedPluginStream())

    gateway_app = Flask(__name__)
    gateway_app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    gateway_app.register_blueprint(inner_api_bp)
    with httpx.Client(transport=httpx.MockTransport(daemon_http)) as daemon_client:
        monkeypatch.setattr(plugin_base, "_httpx_client", daemon_client)
        terminal = gateway_failure_event(gateway_app)
    internal_events = AgentBackendRunEventAdapter().adapt(terminal)
    assert len(internal_events) == 1
    internal_event = internal_events[0]
    assert isinstance(internal_event, AgentBackendRunFailedInternalEvent)
    error = _agent_backend_failure_to_exception(internal_event)
    assert isinstance(error, PluginDaemonInternalError)
    assert isinstance(error.__cause__, AgentBackendRunFailedError)
    response, observation = _post_agent_stream_outcome(sqlite_session, monkeypatch, route=route, error=error)
    body = response.get_json()
    assert response.status_code == body["status"] == 502
    assert body["code"] == "plugin_runtime_error"
    if failure_stage == "preflight-invalid-json":
        assert body["message"].startswith("Failed to parse response from plugin daemon")
    elif failure_stage == "preflight-daemon-error":
        assert body["message"] == "daemon unavailable"
    else:
        assert body["message"] == "Request to Plugin Daemon Service failed"
    assert body["details"]["error_source"] == "plugin_daemon"
    assert body["details"]["agent_run_id"] == "run-1"
    assert "-500" not in body["message"]
    assert "private transport detail" not in str(body)
    assert observation.closed
    assert requests
    assert delivered_chunks == (["partial answer"] if failure_stage == "stream-after-chunk" else [])
