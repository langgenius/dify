from __future__ import annotations

import importlib
import json
import os
from copy import deepcopy
from dataclasses import dataclass
from inspect import unwrap
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import DEFAULT, MagicMock
from uuid import uuid4

import pytest
import yaml
from flask import Flask
from flask.testing import FlaskClient
from flask_restx import Resource
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, object_session, sessionmaker

from controllers.common import session as controller_session
from controllers.console.app import model_config as model_config_module
from core.app.app_config.easy_ui_based_app.model_config import manager as model_config_manager_module
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfigManager
from core.app.apps.chat.app_config_manager import ChatAppConfigManager
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from libs.external_api import ExternalApi
from models.model import App, AppMode, AppModelConfig
from models.provider_ids import ModelProviderID

app_wraps_module = importlib.import_module("controllers.console.app.wraps")


def _model_config_payload(**fields: object) -> dict[str, object]:
    return {
        "model": {
            "provider": "langgenius/openai/openai",
            "name": "gpt-4o-mini",
            "completion_params": {},
        },
        **fields,
    }


def _existing_publish_configs() -> list[tuple[str, AppMode, dict[str, object]]]:
    recommended_apps_path = Path(__file__).resolve().parents[5] / "constants" / "recommended_apps.json"
    recommended_apps = json.loads(recommended_apps_path.read_text())["app_details"]
    cases = []
    for app_detail in recommended_apps.values():
        payload = yaml.safe_load(app_detail["export_data"]).get("model_config")
        if payload is not None:
            cases.append((app_detail["name"], AppMode.value_of(app_detail["mode"]), payload))

    # Mirrors the publish body's advanced-prompt, dataset-selection, and feature fields.
    cases.append(
        (
            "configuration-editor-publish",
            AppMode.CHAT,
            _model_config_payload(
                model={
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-4o",
                    "mode": "chat",
                    "completion_params": {"temperature": 0.7},
                },
                pre_prompt="",
                prompt_type="advanced",
                chat_prompt_config={"prompt": [{"role": "system", "text": "hi"}]},
                completion_prompt_config={
                    "prompt": {"text": "completion"},
                    "conversation_histories_role": {"assistant_prefix": "assistant", "user_prefix": "user"},
                },
                user_input_form=[{"text-input": {"label": "Name", "variable": "name", "required": True}}],
                dataset_query_variable="context",
                dataset_configs={
                    "retrieval_model": "multiple",
                    "datasets": {"datasets": [{"dataset": {"enabled": True, "id": "dataset-1"}}]},
                },
                agent_mode={"enabled": True, "max_iteration": 3, "strategy": "function_call", "tools": []},
                external_data_tools=[],
                more_like_this={"enabled": True},
                opening_statement="hello",
                suggested_questions=["how are you?"],
                suggested_questions_after_answer={"enabled": False},
                speech_to_text={"enabled": False},
                text_to_speech={"enabled": False, "voice": "", "language": ""},
                retriever_resource={"enabled": True},
                sensitive_word_avoidance={"enabled": False},
                file_upload={
                    "enabled": True,
                    "image": {
                        "enabled": True,
                        "detail": "high",
                        "number_limits": 2,
                        "transfer_methods": ["local_file"],
                    },
                },
                system_parameters={
                    "audio_file_size_limit": 1,
                    "file_size_limit": 1,
                    "image_file_size_limit": 1,
                    "video_file_size_limit": 1,
                    "workflow_file_upload_limit": 1,
                },
            ),
        )
    )
    return cases


@dataclass
class _ModelConfigHttp:
    client: FlaskClient
    app_model: App
    session: Session
    validate_configuration: MagicMock
    signal: MagicMock


@pytest.fixture
def model_config_http(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> _ModelConfigHttp:
    app_model = App(
        id="app-1",
        mode=AppMode.CHAT,
        app_model_config_id="config-0",
        updated_by=None,
        updated_at=None,
    )
    original_config = AppModelConfig(app_id=app_model.id, created_by="u1", updated_by="u1")
    original_config.id = "config-0"
    sqlite_session.add(original_config)
    sqlite_session.commit()
    validate_configuration = MagicMock(
        wraps=model_config_module.AppModelConfigService.validate_configuration,
        return_value={"pre_prompt": "Validated prompt"},
    )
    monkeypatch.setattr(model_config_module.AppModelConfigService, "validate_configuration", validate_configuration)
    signal = MagicMock()
    monkeypatch.setattr(model_config_module.app_model_config_was_updated, "send", signal)

    class ModelConfigHttpResource(Resource):
        def post(self):
            # Admission is supplied by this harness; parsing and HTTP errors use the real controller and API.
            return unwrap(model_config_module.ModelConfigResource.post)(
                model_config_module.ModelConfigResource(), sqlite_session, "t1", "u1", app_model=app_model
            )

    http_app = Flask(__name__)
    http_app.config.update(TESTING=True)
    ExternalApi(http_app).add_resource(ModelConfigHttpResource, "/apps/app-1/model-config")
    return _ModelConfigHttp(http_app.test_client(), app_model, sqlite_session, validate_configuration, signal)


def test_post_preserves_configuration_wire_for_business_validation(model_config_http: _ModelConfigHttp) -> None:
    payload = _model_config_payload(
        model={
            "provider": "langgenius/openai/openai",
            "name": "gpt-4o-mini",
            "mode": "chat",
            "completion_params": {
                "temperature": 0,
                "stop": [],
                "provider_options": {"cache": False, "routing": {"fallback": None}},
            },
        },
        pre_prompt="Answer {{topic}}",
        prompt_type="advanced",
        chat_prompt_config={"prompt": [{"role": "system", "text": "Answer {{topic}}"}]},
        completion_prompt_config={
            "prompt": {"text": "{{topic}}"},
            "conversation_histories_role": {"user_prefix": "Human", "assistant_prefix": "Assistant"},
        },
        user_input_form=[
            {"text-input": {"label": "Topic", "variable": "topic", "required": False, "default": ""}},
            {"select": {"label": "Style", "variable": "style", "options": ["brief", "detailed"], "required": True}},
        ],
        dataset_query_variable="topic",
        dataset_configs={
            "retrieval_model": "multiple",
            "top_k": 3,
            "score_threshold": 0,
            "score_threshold_enabled": False,
            "datasets": {"datasets": [{"dataset": {"id": "dataset-1", "enabled": True}}]},
            "weights": {"vector_setting": {"vector_weight": 0.7}, "keyword_setting": {"keyword_weight": 0.3}},
        },
        agent_mode={
            "enabled": True,
            "strategy": "function_call",
            "max_iteration": 5,
            "tools": [
                {
                    "provider_id": "provider",
                    "provider_type": "builtin",
                    "tool_name": "search",
                    "tool_parameters": {
                        "query": "{{topic}}",
                        "limit": 0,
                        "filters": {"archived": False, "tags": ["docs", None, {"score": 0.5}]},
                    },
                }
            ],
        },
        file_upload={
            "enabled": True,
            "number_limits": 3,
            "allowed_file_types": ["image", "document"],
            "allowed_file_extensions": [".pdf"],
            "allowed_file_upload_methods": ["local_file", "remote_url"],
            "image": {"enabled": True, "number_limits": 3, "transfer_methods": ["remote_url"]},
        },
        external_data_tools=[
            {
                "enabled": True,
                "type": "api",
                "label": "Context",
                "variable": "context",
                "config": {"api_based_extension_id": "extension-1", "options": {"limit": 0, "enabled": False}},
            }
        ],
        opening_statement="Hello",
        suggested_questions=["What can you do?"],
        suggested_questions_after_answer={"enabled": True},
        more_like_this={"enabled": False},
        speech_to_text={"enabled": True},
        text_to_speech={"enabled": True, "voice": "alloy", "language": "en-US"},
        retriever_resource={"enabled": True},
        sensitive_word_avoidance={
            "enabled": True,
            "type": "keywords",
            "config": {"keywords": "blocked", "inputs_config": {"enabled": True, "preset_response": ""}},
        },
    )

    response = model_config_http.client.post("/apps/app-1/model-config", json=payload)

    assert response.status_code == 200, response.get_json()
    assert response.get_json() == {"result": "success"}
    model_config_http.validate_configuration.assert_called_once_with(
        tenant_id="t1", config=payload, app_mode=AppMode.CHAT, session=model_config_http.session
    )
    stored_config = model_config_http.session.get(AppModelConfig, model_config_http.app_model.app_model_config_id)
    assert stored_config is not None
    assert stored_config.pre_prompt == "Validated prompt"
    assert model_config_http.signal.call_args.kwargs["session"] is model_config_http.session


@pytest.mark.parametrize(
    "optional_fields",
    [
        {},
        {
            "pre_prompt": "",
            "opening_statement": "",
            "suggested_questions": [],
            "chat_prompt_config": None,
            "completion_prompt_config": None,
            "file_upload": None,
            "dataset_configs": {"score_threshold": 0, "score_threshold_enabled": False},
            "agent_mode": {"enabled": False, "tools": []},
            "speech_to_text": {"enabled": False},
            "text_to_speech": {"enabled": False, "voice": ""},
            "external_data_tools": [],
        },
    ],
    ids=["omitted", "explicit-empty-disabled-and-null"],
)
def test_post_keeps_optional_values_for_domain_defaults(
    model_config_http: _ModelConfigHttp, optional_fields: dict[str, object]
) -> None:
    payload = _model_config_payload(**optional_fields)

    response = model_config_http.client.post("/apps/app-1/model-config", json=payload)

    assert response.status_code == 200, response.get_json()
    assert model_config_http.validate_configuration.call_args.kwargs["config"] == payload


@pytest.mark.parametrize(("case_name", "app_mode", "payload"), _existing_publish_configs())
def test_post_preserves_existing_publish_results(
    model_config_http: _ModelConfigHttp,
    monkeypatch: pytest.MonkeyPatch,
    case_name: str,
    app_mode: AppMode,
    payload: dict[str, object],
) -> None:
    selected_model = payload["model"]
    assert isinstance(selected_model, dict)
    assembly = MagicMock()
    assembly.model_provider_factory.get_providers.return_value = [
        SimpleNamespace(provider=str(ModelProviderID(selected_model["provider"])))
    ]
    assembly.provider_manager.get_configurations.return_value.get_models.return_value = [
        SimpleNamespace(model=selected_model["name"], model_properties={"mode": selected_model.get("mode", "chat")})
    ]
    monkeypatch.setattr(model_config_manager_module, "create_plugin_model_assembly", lambda **_kwargs: assembly)
    monkeypatch.setattr(
        model_config_module.ToolManager,
        "get_agent_tool_runtime",
        MagicMock(side_effect=ValueError("Tool provider is unavailable in this test")),
    )
    config_manager = {
        AppMode.CHAT: ChatAppConfigManager,
        AppMode.COMPLETION: CompletionAppConfigManager,
        AppMode.AGENT_CHAT: AgentChatAppConfigManager,
    }[app_mode]
    expected_config = config_manager.config_validate("t1", deepcopy(payload), model_config_http.session)
    expected_record = AppModelConfig(app_id="app-1", created_by="u1", updated_by="u1").from_model_config_dict(
        expected_config
    )
    assert "system_parameters" not in expected_config
    assert "annotation_reply" not in expected_config
    model_config_http.app_model.mode = app_mode
    model_config_http.validate_configuration.return_value = DEFAULT

    response = model_config_http.client.post("/apps/app-1/model-config", json=payload)

    assert response.status_code == 200, (case_name, response.get_json())
    assert response.get_json() == {"result": "success"}
    stored_config = model_config_http.session.get(AppModelConfig, model_config_http.app_model.app_model_config_id)
    assert stored_config is not None
    assert stored_config.to_dict(annotation_reply={"enabled": False}) == expected_record.to_dict(
        annotation_reply={"enabled": False}
    ), case_name
    assert model_config_http.signal.call_args.kwargs["session"] is model_config_http.session


@pytest.mark.parametrize(
    "invalid_fields",
    [
        {"model": "gpt-4o-mini"},
        {"model": {"provider": "langgenius/openai/openai", "name": "gpt-4o-mini", "completion_params": []}},
        {"user_input_form": {"text-input": {"variable": "topic"}}},
        {"file_upload": []},
        {"chat_prompt_config": {"prompt": [{"role": "system", "text": {"invalid": "prompt"}}]}},
        {"completion_prompt_config": {"conversation_histories_role": {"user_prefix": []}}},
        {"user_input_form": [{"select": {"label": "Style", "variable": "style", "options": {"brief": True}}}]},
        {"dataset_configs": {"weights": {"vector_setting": {"vector_weight": {"invalid": 0.7}}}}},
        {
            "agent_mode": {
                "tools": [
                    {
                        "provider_id": "provider",
                        "provider_type": "builtin",
                        "tool_name": "search",
                        "tool_parameters": [],
                    }
                ]
            }
        },
        {"file_upload": {"image": {"transfer_methods": "remote_url"}}},
        {"speech_to_text": {"enabled": {"invalid": True}}},
        {"external_data_tools": [{"enabled": True, "type": "api", "config": []}]},
    ],
    ids=[
        "model-string",
        "completion-params-list",
        "form-object",
        "file-upload-list",
        "chat-prompt-text-object",
        "completion-prefix-list",
        "form-options-object",
        "dataset-weight-object",
        "agent-tool-parameters-list",
        "image-transfer-methods-string",
        "feature-enabled-object",
        "external-tool-config-list",
    ],
)
def test_post_rejects_invalid_wire_before_business_validation(
    model_config_http: _ModelConfigHttp, invalid_fields: dict[str, object]
) -> None:
    response = model_config_http.client.post("/apps/app-1/model-config", json=_model_config_payload(**invalid_fields))

    assert response.status_code == 400, response.get_json()
    assert response.get_json()["code"] == "invalid_param"
    model_config_http.validate_configuration.assert_not_called()
    model_config_http.signal.assert_not_called()
    assert model_config_http.app_model.app_model_config_id == "config-0"
    assert model_config_http.session.scalar(select(func.count()).select_from(AppModelConfig)) == 1


def test_post_keeps_business_validation_as_the_configuration_policy_owner(model_config_http: _ModelConfigHttp) -> None:
    model_config_http.validate_configuration.side_effect = ValueError("model.name must be in the specified model list")

    response = model_config_http.client.post("/apps/app-1/model-config", json=_model_config_payload())

    assert response.status_code == 400, response.get_json()
    assert response.get_json()["message"] == "model.name must be in the specified model list"
    model_config_http.signal.assert_not_called()
    assert model_config_http.app_model.app_model_config_id == "config-0"
    assert model_config_http.session.scalar(select(func.count()).select_from(AppModelConfig)) == 1


def _assert_no_implicit_app_config_properties() -> None:
    # `App.is_agent` and `App.app_model_config` used to be poisoned here with a
    # raising property. Neither exists as an implicit accessor any more, so their
    # absence enforces the same thing outright — assert it instead of
    # monkeypatching an attribute that is gone.
    assert not hasattr(App, "is_agent")
    assert not hasattr(App, "app_model_config")


@pytest.mark.parametrize("app_mode", [AppMode.CHAT, AppMode.COMPLETION])
@pytest.mark.parametrize("sqlite_session", [(AppModelConfig,)], indirect=True)
def test_post_updates_non_agent_model_config_without_implicit_properties(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    app_mode: AppMode,
    sqlite_session: Session,
) -> None:
    """Flush a non-agent config through the injected session without legacy model properties."""
    api = model_config_module.ModelConfigResource()
    method = unwrap(api.post)

    app_model = App(
        id="app-1",
        mode=app_mode,
        app_model_config_id="config-0",
        updated_by=None,
        updated_at=None,
    )
    original_config = AppModelConfig(app_id="app-1", created_by="u1", updated_by="u1")
    original_config.id = "config-0"
    original_config.agent_mode = None
    sqlite_session.add(original_config)
    sqlite_session.commit()
    _assert_no_implicit_app_config_properties()
    monkeypatch.setattr(
        model_config_module.AppModelConfigService,
        "validate_configuration",
        lambda **_kwargs: {"pre_prompt": "hi"},
    )

    def _from_model_config_dict(self, model_config):
        self.pre_prompt = model_config["pre_prompt"]
        self.id = "config-1"
        return self

    monkeypatch.setattr(AppModelConfig, "from_model_config_dict", _from_model_config_dict)
    send_mock = MagicMock()
    monkeypatch.setattr(model_config_module.app_model_config_was_updated, "send", send_mock)

    with app.test_request_context(
        "/console/api/apps/app-1/model-config", method="POST", json=_model_config_payload(pre_prompt="hi")
    ):
        response = method(api, sqlite_session, "t1", "u1", app_model=app_model)

    assert send_mock.call_args.kwargs["session"] is sqlite_session
    assert app_model.app_model_config_id == "config-1"
    assert app_model.mode == app_mode
    persisted_config = sqlite_session.get(AppModelConfig, "config-1")
    assert persisted_config is not None
    assert persisted_config.pre_prompt == "hi"
    assert response["result"] == "success"


def test_post_uses_one_session_and_rolls_back_when_signal_fails(
    app: Flask,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    App.metadata.create_all(sqlite_engine, tables=[App.__table__, AppModelConfig.__table__])
    make_session = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    app_id = str(uuid4())
    tenant_id = str(uuid4())
    user_id = str(uuid4())

    with make_session.begin() as setup_session:
        original_config = AppModelConfig(app_id=app_id, created_by=user_id, updated_by=user_id)
        original_config.agent_mode = json.dumps({"tools": []})
        setup_session.add(original_config)
        setup_session.flush()
        original_config_id = original_config.id
        setup_session.add(
            App(
                id=app_id,
                tenant_id=tenant_id,
                name="Atomic app",
                description="",
                mode=AppMode.AGENT_CHAT,
                icon_type=None,
                icon=None,
                icon_background=None,
                app_model_config_id=original_config_id,
                enable_site=True,
                enable_api=True,
                max_active_requests=None,
                created_by=user_id,
            )
        )

    monkeypatch.setattr(controller_session.session_factory, "create_session", make_session)
    monkeypatch.setattr(
        model_config_module.AppModelConfigService,
        "validate_configuration",
        lambda **_kwargs: {"agent_mode": {"tools": []}},
    )

    captured: dict[str, object] = {}

    def load_app_model(session, requested_app_id: str):
        loaded_app = session.get(App, requested_app_id)
        captured["load_session"] = session
        return loaded_app

    def fail_signal(sender: App, **kwargs: object) -> None:
        signal_session = kwargs["session"]
        assert object_session(sender) is signal_session
        assert signal_session is captured["load_session"]
        raise RuntimeError("signal failed")

    monkeypatch.setattr(app_wraps_module, "_load_app_model", load_app_model)
    monkeypatch.setattr(model_config_module.app_model_config_was_updated, "send", fail_signal)

    method = model_config_module.ModelConfigResource.post
    while not os.path.normpath(method.__code__.co_filename).endswith(
        os.path.join("controllers", "common", "session.py")
    ):
        method = method.__wrapped__
    assert os.path.normpath(method.__wrapped__.__code__.co_filename).endswith(
        os.path.join("controllers", "console", "app", "wraps.py")
    )

    api = model_config_module.ModelConfigResource()
    with (
        app.test_request_context(
            f"/console/api/apps/{app_id}/model-config", method="POST", json=_model_config_payload()
        ),
        pytest.raises(RuntimeError, match="signal failed"),
    ):
        method(
            api,
            current_tenant_id=tenant_id,
            current_user_id=user_id,
            app_id=app_id,
        )

    with make_session() as verification_session:
        persisted_app = verification_session.get(App, app_id)
        assert persisted_app is not None
        assert persisted_app.app_model_config_id == original_config_id
        config_count = verification_session.scalar(select(func.count()).select_from(AppModelConfig))
        assert config_count == 1


@pytest.mark.parametrize("sqlite_session", [(AppModelConfig,)], indirect=True)
def test_post_encrypts_agent_tool_parameters(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Agent parameter encryption reads and writes persisted model configurations."""
    api = model_config_module.ModelConfigResource()
    method = unwrap(api.post)

    app_model = App(
        id="app-1",
        mode=AppMode.AGENT_CHAT,
        app_model_config_id="config-0",
        updated_by=None,
        updated_at=None,
    )
    _assert_no_implicit_app_config_properties()

    original_config = AppModelConfig(app_id="app-1", created_by="u1", updated_by="u1")
    original_config.id = "config-0"
    original_config.agent_mode = json.dumps(
        {
            "enabled": True,
            "strategy": "function-calling",
            "tools": [
                {
                    "provider_id": "provider",
                    "provider_type": "builtin",
                    "tool_name": "tool",
                    "tool_parameters": {"secret": "masked"},
                }
            ],
            "prompt": None,
        }
    )

    sqlite_session.add(original_config)
    sqlite_session.commit()

    monkeypatch.setattr(
        model_config_module.AppModelConfigService,
        "validate_configuration",
        lambda **_kwargs: {
            "pre_prompt": "hi",
            "agent_mode": {
                "enabled": True,
                "strategy": "function-calling",
                "tools": [
                    {
                        "provider_id": "provider",
                        "provider_type": "builtin",
                        "tool_name": "tool",
                        "tool_parameters": {"secret": "masked"},
                    }
                ],
                "prompt": None,
            },
        },
    )
    monkeypatch.setattr(model_config_module.ToolManager, "get_agent_tool_runtime", lambda **_kwargs: object())

    class _ParamManager:
        def __init__(self, **_kwargs):
            self.delete_called = False

        def decrypt_tool_parameters(self, _value):
            return {"secret": "decrypted"}

        def mask_tool_parameters(self, _value):
            return {"secret": "masked"}

        def encrypt_tool_parameters(self, _value):
            return {"secret": "encrypted"}

        def delete_tool_parameters_cache(self):
            self.delete_called = True

    monkeypatch.setattr(model_config_module, "ToolParameterConfigurationManager", _ParamManager)
    send_mock = MagicMock()
    monkeypatch.setattr(model_config_module.app_model_config_was_updated, "send", send_mock)

    with app.test_request_context(
        "/console/api/apps/app-1/model-config", method="POST", json=_model_config_payload(pre_prompt="hi")
    ):
        response = method(api, sqlite_session, "t1", "u1", app_model=app_model)

    stored_config = sqlite_session.get(AppModelConfig, app_model.app_model_config_id)
    assert stored_config is not None
    stored_agent_mode = json.loads(stored_config.agent_mode)
    assert app_model.mode == AppMode.AGENT_CHAT
    assert stored_agent_mode["tools"][0]["tool_parameters"]["secret"] == "encrypted"
    assert response["result"] == "success"
