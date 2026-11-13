from __future__ import annotations

from collections.abc import Callable
from inspect import unwrap
from uuid import uuid4

import pytest
from flask import Flask
from flask.typing import ResponseReturnValue
from flask_restx import Resource
from sqlalchemy.orm import Session
from werkzeug.exceptions import HTTPException, InternalServerError, NotFound

from clients.agent_backend import AgentBackendError
from controllers.console.app import completion as completion_module
from controllers.console.app import error as console_errors
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.app_config.easy_ui_based_app.model_config import manager as model_config_manager_module
from core.app.apps.agent_app.errors import AgentAppGeneratorError
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeRequestBuildError
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from core.entities.provider_configuration import ProviderConfigurations
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from enums import DeploymentEdition
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeBadRequestError
from libs.external_api import ExternalApi
from models.model import AppMode, AppModelConfig
from services.agent.workspace_service import AgentWorkspaceError
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.conversation import ConversationCompletedError, ConversationNotExistsError
from services.errors.llm import InvokeRateLimitError
from tests.helpers.unit.model_factories import make_account, make_app

_TENANT_ID = "tenant-1"
_PROVIDER_ID = "langgenius/openai/openai"
_MODEL_ID = "gpt-4o-mini"


@pytest.mark.parametrize("finalization", [True, False])
@pytest.mark.parametrize(
    ("error", "expected_type", "description"),
    [
        (ConversationNotExistsError(), NotFound, "Conversation Not Exists."),
        (ConversationCompletedError(), console_errors.ConversationCompletedError, None),
        (AppModelConfigBrokenError(), console_errors.AppUnavailableError, None),
        (
            ProviderTokenNotInitError("missing credentials"),
            console_errors.ProviderNotInitializeError,
            "missing credentials",
        ),
        (QuotaExceededError(), console_errors.ProviderQuotaExceededError, None),
        (ModelCurrentlyNotSupportError(), console_errors.ProviderModelCurrentlyNotSupportError, None),
        (InvokeRateLimitError("too many requests"), InvokeRateLimitHttpError, "too many requests"),
        (
            InvokeAuthorizationError("secret provider detail"),
            console_errors.CompletionRequestError,
            "Incorrect API key provided",
        ),
        (InvokeBadRequestError("invalid model"), console_errors.CompletionRequestError, "invalid model"),
        (AgentBackendError("backend failed"), console_errors.CompletionRequestError, "backend failed"),
        (AgentWorkspaceError("binding unavailable"), console_errors.CompletionRequestError, "binding unavailable"),
        (AgentBackendError(""), console_errors.CompletionRequestError, "Build chat finalization failed."),
        (
            console_errors.CompletionRequestError("existing error"),
            console_errors.CompletionRequestError,
            "existing error",
        ),
        (AgentAppGeneratorError("missing draft"), AgentAppGeneratorError, None),
        (
            AgentAppRuntimeRequestBuildError("invalid_runtime", "invalid runtime"),
            AgentAppRuntimeRequestBuildError,
            None,
        ),
        (ValueError("invalid args"), ValueError, None),
        (RuntimeError("unexpected"), InternalServerError, None),
    ],
)
def test_chat_and_finalization_share_console_error_mapping(
    finalization: bool,
    error: Exception,
    expected_type: type[Exception],
    description: str | None,
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    unbound_session: Session,
) -> None:
    def fail(**_kwargs: object) -> None:
        raise error

    monkeypatch.setattr(completion_module.AppGenerateService, "generate", fail)
    monkeypatch.setattr(completion_module.AppGenerateService, "finalize_agent_build_chat", fail)
    monkeypatch.setattr(
        completion_module, "_resolve_current_user_agent_debug_conversation_id", lambda **_kwargs: "conv"
    )

    def invoke() -> object:
        if finalization:
            return completion_module._create_build_chat_finalization_message(
                session=unbound_session,
                current_user=make_account(),
                app_model=make_app(mode=AppMode.AGENT),
                current_tenant_id=_TENANT_ID,
                agent_id="agent-1",
            )
        return completion_module._generate_chat_message(
            session=unbound_session,
            current_user=make_account(),
            app_model=make_app(mode=AppMode.AGENT),
            args={"query": "hello", "inputs": {}},
            streaming=True,
        )

    with app.test_request_context(), pytest.raises(expected_type) as caught:
        invoke()
    if expected_type in (AgentAppGeneratorError, AgentAppRuntimeRequestBuildError, ValueError):
        assert caught.value is error
    elif not isinstance(error, console_errors.CompletionRequestError):
        assert caught.value.__cause__ is error
    if description is not None:
        assert isinstance(caught.value, HTTPException)
        assert caught.value.description == description


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
