"""Unit tests for load balancing credential validation APIs."""

from __future__ import annotations

import builtins
import importlib
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.exceptions import Forbidden

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]

from models.account import TenantAccountRole


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def load_balancing_module(monkeypatch: pytest.MonkeyPatch):
    """Reload controller module with lightweight decorators for testing."""

    from controllers.console import console_ns, wraps
    from libs import login

    def _noop(func):
        return func

    monkeypatch.setattr(login, "login_required", _noop)
    monkeypatch.setattr(wraps, "setup_required", _noop)
    monkeypatch.setattr(wraps, "account_initialization_required", _noop)

    def _noop_route(*args, **kwargs):  # type: ignore[override]
        def _decorator(cls):
            return cls

        return _decorator

    monkeypatch.setattr(console_ns, "route", _noop_route)

    module_name = "controllers.console.workspace.load_balancing_config"
    sys.modules.pop(module_name, None)
    module = importlib.import_module(module_name)
    return module


def _mock_user(role: TenantAccountRole) -> SimpleNamespace:
    return SimpleNamespace(current_role=role)


def _prepare_context(module, monkeypatch: pytest.MonkeyPatch, role=TenantAccountRole.OWNER):
    user = _mock_user(role)
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (user, "tenant-123"))
    mock_service = MagicMock()
    monkeypatch.setattr(module, "ModelLoadBalancingService", lambda: mock_service)
    return mock_service


def _request_payload():
    return {"model": "gpt-4o", "model_type": ModelType.LLM, "credentials": {"api_key": "sk-***"}}


def test_validate_credentials_success(app: Flask, load_balancing_module, monkeypatch: pytest.MonkeyPatch):
    service = _prepare_context(load_balancing_module, monkeypatch)

    with app.test_request_context(
        "/workspaces/current/model-providers/openai/models/load-balancing-configs/credentials-validate",
        method="POST",
        json=_request_payload(),
    ):
        response = load_balancing_module.LoadBalancingCredentialsValidateApi().post(provider="openai")

    assert response == {"result": "success"}
    service.validate_load_balancing_credentials.assert_called_once_with(
        tenant_id="tenant-123",
        provider="openai",
        model="gpt-4o",
        model_type=ModelType.LLM,
        credentials={"api_key": "sk-***"},
    )


def test_validate_credentials_returns_error_message(app: Flask, load_balancing_module, monkeypatch: pytest.MonkeyPatch):
    service = _prepare_context(load_balancing_module, monkeypatch)
    service.validate_load_balancing_credentials.side_effect = CredentialsValidateFailedError("invalid credentials")

    with app.test_request_context(
        "/workspaces/current/model-providers/openai/models/load-balancing-configs/credentials-validate",
        method="POST",
        json=_request_payload(),
    ):
        response = load_balancing_module.LoadBalancingCredentialsValidateApi().post(provider="openai")

    assert response == {"result": "error", "error": "invalid credentials"}


def test_validate_credentials_requires_privileged_role(
    app: Flask, load_balancing_module, monkeypatch: pytest.MonkeyPatch
):
    _prepare_context(load_balancing_module, monkeypatch, role=TenantAccountRole.NORMAL)

    with app.test_request_context(
        "/workspaces/current/model-providers/openai/models/load-balancing-configs/credentials-validate",
        method="POST",
        json=_request_payload(),
    ):
        api = load_balancing_module.LoadBalancingCredentialsValidateApi()
        with pytest.raises(Forbidden):
            api.post(provider="openai")


def test_validate_credentials_with_config_id(app: Flask, load_balancing_module, monkeypatch: pytest.MonkeyPatch):
    service = _prepare_context(load_balancing_module, monkeypatch)

    with app.test_request_context(
        "/workspaces/current/model-providers/openai/models/load-balancing-configs/cfg-1/credentials-validate",
        method="POST",
        json=_request_payload(),
    ):
        response = load_balancing_module.LoadBalancingConfigCredentialsValidateApi().post(
            provider="openai", config_id="cfg-1"
        )

    assert response == {"result": "success"}
    service.validate_load_balancing_credentials.assert_called_once_with(
        tenant_id="tenant-123",
        provider="openai",
        model="gpt-4o",
        model_type=ModelType.LLM,
        credentials={"api_key": "sk-***"},
        config_id="cfg-1",
    )
