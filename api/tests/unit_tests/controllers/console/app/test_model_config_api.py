from __future__ import annotations

import json
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from controllers.console.app import model_config as model_config_module
from models.model import AppMode, AppModelConfig


def test_post_updates_app_model_config_for_chat(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = model_config_module.ModelConfigResource()
    method = unwrap(api.post)

    app_model = SimpleNamespace(
        id="app-1",
        mode=AppMode.CHAT.value,
        is_agent=False,
        app_model_config_id=None,
        updated_by=None,
        updated_at=None,
    )
    monkeypatch.setattr(
        model_config_module.AppModelConfigService,
        "validate_configuration",
        lambda **_kwargs: {"pre_prompt": "hi"},
    )
    session = MagicMock()
    monkeypatch.setattr(model_config_module.db, "session", session)

    def _from_model_config_dict(self, model_config):
        self.pre_prompt = model_config["pre_prompt"]
        self.id = "config-1"
        return self

    monkeypatch.setattr(AppModelConfig, "from_model_config_dict", _from_model_config_dict)
    send_mock = MagicMock()
    monkeypatch.setattr(model_config_module.app_model_config_was_updated, "send", send_mock)

    with app.test_request_context("/console/api/apps/app-1/model-config", method="POST", json={"pre_prompt": "hi"}):
        response = method(api, "t1", "u1", app_model=app_model)

    session.add.assert_called_once()
    session.flush.assert_called_once()
    session.commit.assert_called_once()
    send_mock.assert_called_once()
    assert app_model.app_model_config_id == "config-1"
    assert response["result"] == "success"


def test_post_encrypts_agent_tool_parameters(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = model_config_module.ModelConfigResource()
    method = unwrap(api.post)

    app_model = SimpleNamespace(
        id="app-1",
        mode=AppMode.AGENT_CHAT.value,
        is_agent=True,
        app_model_config_id="config-0",
        updated_by=None,
        updated_at=None,
    )

    original_config = AppModelConfig(app_id="app-1", created_by="u1", updated_by="u1")
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

    session = MagicMock()
    session.get.return_value = original_config
    monkeypatch.setattr(model_config_module.db, "session", session)

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

    with app.test_request_context("/console/api/apps/app-1/model-config", method="POST", json={"pre_prompt": "hi"}):
        response = method(api, "t1", "u1", app_model=app_model)

    stored_config = session.add.call_args[0][0]
    stored_agent_mode = json.loads(stored_config.agent_mode)
    assert stored_agent_mode["tools"][0]["tool_parameters"]["secret"] == "encrypted"
    assert response["result"] == "success"
