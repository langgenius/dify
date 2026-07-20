from __future__ import annotations

import importlib
import json
from inspect import unwrap
from typing import Never
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import object_session, sessionmaker

from controllers.common import session as controller_session
from controllers.console.app import model_config as model_config_module
from models.model import App, AppMode, AppModelConfig

app_wraps_module = importlib.import_module("controllers.console.app.wraps")


def _poison_implicit_app_config_properties(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(_app: App) -> Never:
        raise AssertionError("implicit App model-config property was accessed")

    monkeypatch.setattr(App, "app_model_config", property(fail))
    monkeypatch.setattr(App, "is_agent", property(fail))


@pytest.mark.parametrize("app_mode", [AppMode.CHAT, AppMode.COMPLETION])
def test_post_updates_non_agent_model_config_without_implicit_properties(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    app_mode: AppMode,
) -> None:
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
    original_config.agent_mode = None
    _poison_implicit_app_config_properties(monkeypatch)
    monkeypatch.setattr(
        model_config_module.AppModelConfigService,
        "validate_configuration",
        lambda **_kwargs: {"pre_prompt": "hi"},
    )
    session = MagicMock()

    def _from_model_config_dict(self, model_config):
        self.pre_prompt = model_config["pre_prompt"]
        self.id = "config-1"
        return self

    monkeypatch.setattr(AppModelConfig, "from_model_config_dict", _from_model_config_dict)
    send_mock = MagicMock()
    monkeypatch.setattr(model_config_module.app_model_config_was_updated, "send", send_mock)
    session.get.return_value = original_config

    with app.test_request_context("/console/api/apps/app-1/model-config", method="POST", json={"pre_prompt": "hi"}):
        response = method(api, session, "t1", "u1", app_model=app_model)

    session.get.assert_called_once_with(AppModelConfig, "config-0")
    session.add.assert_called_once()
    session.flush.assert_called_once()
    session.commit.assert_not_called()
    assert send_mock.call_args.kwargs["session"] is session
    assert app_model.app_model_config_id == "config-1"
    assert app_model.mode == app_mode
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
    while not method.__code__.co_filename.endswith("controllers/common/session.py"):
        method = method.__wrapped__
    assert method.__wrapped__.__code__.co_filename.endswith("controllers/console/app/wraps.py")

    api = model_config_module.ModelConfigResource()
    with (
        app.test_request_context(f"/console/api/apps/{app_id}/model-config", method="POST", json={}),
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


def test_post_encrypts_agent_tool_parameters(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = model_config_module.ModelConfigResource()
    method = unwrap(api.post)

    app_model = App(
        id="app-1",
        mode=AppMode.AGENT_CHAT,
        app_model_config_id="config-0",
        updated_by=None,
        updated_at=None,
    )
    _poison_implicit_app_config_properties(monkeypatch)

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
    session.scalar.return_value = original_config

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
        response = method(api, session, "t1", "u1", app_model=app_model)

    stored_config = session.add.call_args[0][0]
    stored_agent_mode = json.loads(stored_config.agent_mode)
    session.scalar.assert_called_once()
    assert app_model.mode == AppMode.AGENT_CHAT
    assert stored_agent_mode["tools"][0]["tool_parameters"]["secret"] == "encrypted"
    assert response["result"] == "success"
