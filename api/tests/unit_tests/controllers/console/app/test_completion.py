from __future__ import annotations

from collections.abc import Callable
from inspect import unwrap
from uuid import uuid4

import pytest
from flask import Flask
from flask.typing import ResponseReturnValue
from flask_restx import Resource
from sqlalchemy.orm import Session

from controllers.console.app import completion as completion_module
from core.app.app_config.easy_ui_based_app.model_config import manager as model_config_manager_module
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from core.entities.provider_configuration import ProviderConfigurations
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from enums import DeploymentEdition
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from libs.external_api import ExternalApi
from models.model import AppMode, AppModelConfig
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


class _PreviewGatePassedError(Exception):
    pass


def _post_agent_chat_message(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, draft_type: str
) -> tuple[int, dict[str, object] | None, bool]:
    account = make_account(account_id=str(uuid4()))
    app_model = make_app(app_id=str(uuid4()), tenant_id=_TENANT_ID, mode=AppMode.AGENT, created_by=account.id)
    sqlite_session.add(app_model)
    sqlite_session.commit()
    reached_conversation = False

    def resolve_conversation(**_: object) -> str:
        nonlocal reached_conversation
        reached_conversation = True
        raise _PreviewGatePassedError

    monkeypatch.setattr(completion_module, "_resolve_current_user_agent_debug_conversation_id", resolve_conversation)

    class ChatMessageHttpResource(Resource):
        def post(self) -> ResponseReturnValue:
            try:
                return unwrap(completion_module.ChatMessageApi.post)(
                    completion_module.ChatMessageApi(), sqlite_session, _TENANT_ID, account, app_model
                )
            except _PreviewGatePassedError:
                return {"result": "gate passed"}, 200

    http_app = Flask(__name__)
    http_app.config.update(TESTING=True)
    ExternalApi(http_app).add_resource(ChatMessageHttpResource, "/chat-messages")

    response = http_app.test_client().post(
        "/chat-messages",
        json={"inputs": {}, "query": "hello", "response_mode": "streaming", "draft_type": draft_type},
    )
    return response.status_code, response.get_json(), reached_conversation


def test_agent_preview_chat_is_rejected_when_preview_is_unavailable(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

    status, body, reached_conversation = _post_agent_chat_message(sqlite_session, monkeypatch, "draft")

    assert status == 403
    assert body is not None
    assert body["code"] == "agent_preview_unavailable"
    assert not reached_conversation


@pytest.mark.parametrize(
    ("edition", "draft_type"),
    [
        (DeploymentEdition.COMMUNITY, "debug_build"),
        (DeploymentEdition.CLOUD, "draft"),
        (DeploymentEdition.ENTERPRISE, "draft"),
    ],
)
def test_agent_chat_passes_preview_gate(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    draft_type: str,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)

    status, _, reached_conversation = _post_agent_chat_message(sqlite_session, monkeypatch, draft_type)

    assert status == 200
    assert reached_conversation
