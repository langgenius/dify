from __future__ import annotations

import builtins
import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from flask import Flask
from flask.views import MethodView as FlaskMethodView

_NEEDS_METHOD_VIEW_CLEANUP = False
if not hasattr(builtins, "MethodView"):
    builtins.MethodView = FlaskMethodView
    _NEEDS_METHOD_VIEW_CLEANUP = True

from constants import HIDDEN_VALUE
from controllers.console.extension import (
    APIBasedExtensionAPI,
    APIBasedExtensionDetailAPI,
    CodeBasedExtensionAPI,
)

if _NEEDS_METHOD_VIEW_CLEANUP:
    delattr(builtins, "MethodView")
from models.account import AccountStatus
from models.api_based_extension import APIBasedExtension


def _make_extension(
    *,
    name: str = "Sample Extension",
    api_endpoint: str = "https://example.com/api",
    api_key: str = "super-secret-key",
) -> APIBasedExtension:
    extension = APIBasedExtension(
        tenant_id="tenant-123",
        name=name,
        api_endpoint=api_endpoint,
        api_key=api_key,
    )
    extension.id = f"{uuid.uuid4()}"
    extension.created_at = datetime.now(tz=UTC)
    return extension


@pytest.fixture(autouse=True)
def _mock_console_guards(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Bypass console decorators so handlers can run in isolation."""

    import controllers.console.extension as extension_module
    from controllers.console import wraps as wraps_module

    account = MagicMock()
    account.status = AccountStatus.ACTIVE
    account.current_tenant_id = "tenant-123"
    account.id = "account-123"
    account.is_authenticated = True

    monkeypatch.setattr(wraps_module.dify_config, "EDITION", "CLOUD")
    monkeypatch.setattr("libs.login.dify_config.LOGIN_DISABLED", True)
    monkeypatch.delenv("INIT_PASSWORD", raising=False)
    monkeypatch.setattr(extension_module, "current_account_with_tenant", lambda: (account, "tenant-123"))
    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (account, "tenant-123"))

    # The login_required decorator consults the shared LocalProxy in libs.login.
    monkeypatch.setattr("libs.login.current_user", account)
    monkeypatch.setattr("libs.login.check_csrf_token", lambda *_, **__: None)

    return account


@pytest.fixture(autouse=True)
def _restx_mask_defaults(app: Flask):
    app.config.setdefault("RESTX_MASK_HEADER", "X-Fields")
    app.config.setdefault("RESTX_MASK_SWAGGER", False)


def test_code_based_extension_get_returns_service_data(app: Flask, monkeypatch: pytest.MonkeyPatch):
    service_result = {"entrypoint": "main:agent"}
    service_mock = MagicMock(return_value=service_result)
    monkeypatch.setattr(
        "controllers.console.extension.CodeBasedExtensionService.get_code_based_extension",
        service_mock,
    )

    with app.test_request_context(
        "/console/api/code-based-extension",
        method="GET",
        query_string={"module": "workflow.tools"},
    ):
        response = CodeBasedExtensionAPI().get()

    assert response == {"module": "workflow.tools", "data": service_result}
    service_mock.assert_called_once_with("workflow.tools")


def test_api_based_extension_get_returns_tenant_extensions(app: Flask, monkeypatch: pytest.MonkeyPatch):
    extension = _make_extension(name="Weather API", api_key="abcdefghi123")
    service_mock = MagicMock(return_value=[extension])
    monkeypatch.setattr(
        "controllers.console.extension.APIBasedExtensionService.get_all_by_tenant_id",
        service_mock,
    )

    with app.test_request_context("/console/api/api-based-extension", method="GET"):
        response = APIBasedExtensionAPI().get()

    assert response[0]["id"] == extension.id
    assert response[0]["name"] == "Weather API"
    assert response[0]["api_endpoint"] == extension.api_endpoint
    assert response[0]["api_key"].startswith(extension.api_key[:3])
    service_mock.assert_called_once_with("tenant-123")


def test_api_based_extension_post_creates_extension(app: Flask, monkeypatch: pytest.MonkeyPatch):
    saved_extension = _make_extension(name="Docs API", api_key="saved-secret")
    save_mock = MagicMock(return_value=saved_extension)
    monkeypatch.setattr("controllers.console.extension.APIBasedExtensionService.save", save_mock)

    payload = {
        "name": "Docs API",
        "api_endpoint": "https://docs.example.com/hook",
        "api_key": "plain-secret",
    }

    with app.test_request_context("/console/api/api-based-extension", method="POST", json=payload):
        response = APIBasedExtensionAPI().post()

    args, _ = save_mock.call_args
    created_extension: APIBasedExtension = args[0]
    assert created_extension.tenant_id == "tenant-123"
    assert created_extension.name == payload["name"]
    assert created_extension.api_endpoint == payload["api_endpoint"]
    assert created_extension.api_key == payload["api_key"]
    assert response["name"] == saved_extension.name
    save_mock.assert_called_once()


def test_api_based_extension_detail_get_fetches_extension(app: Flask, monkeypatch: pytest.MonkeyPatch):
    extension = _make_extension(name="Docs API", api_key="abcdefg12345")
    service_mock = MagicMock(return_value=extension)
    monkeypatch.setattr(
        "controllers.console.extension.APIBasedExtensionService.get_with_tenant_id",
        service_mock,
    )

    extension_id = uuid.uuid4()
    with app.test_request_context(f"/console/api/api-based-extension/{extension_id}", method="GET"):
        response = APIBasedExtensionDetailAPI().get(extension_id)

    assert response["id"] == extension.id
    assert response["name"] == extension.name
    service_mock.assert_called_once_with("tenant-123", str(extension_id))


def test_api_based_extension_detail_post_keeps_hidden_api_key(app: Flask, monkeypatch: pytest.MonkeyPatch):
    existing_extension = _make_extension(name="Docs API", api_key="keep-me")
    get_mock = MagicMock(return_value=existing_extension)
    save_mock = MagicMock(return_value=existing_extension)
    monkeypatch.setattr(
        "controllers.console.extension.APIBasedExtensionService.get_with_tenant_id",
        get_mock,
    )
    monkeypatch.setattr("controllers.console.extension.APIBasedExtensionService.save", save_mock)

    payload = {
        "name": "Docs API Updated",
        "api_endpoint": "https://docs.example.com/v2",
        "api_key": HIDDEN_VALUE,
    }

    extension_id = uuid.uuid4()
    with app.test_request_context(
        f"/console/api/api-based-extension/{extension_id}",
        method="POST",
        json=payload,
    ):
        response = APIBasedExtensionDetailAPI().post(extension_id)

    assert existing_extension.name == payload["name"]
    assert existing_extension.api_endpoint == payload["api_endpoint"]
    assert existing_extension.api_key == "keep-me"
    save_mock.assert_called_once_with(existing_extension)
    assert response["name"] == payload["name"]


def test_api_based_extension_detail_post_updates_api_key_when_provided(app: Flask, monkeypatch: pytest.MonkeyPatch):
    existing_extension = _make_extension(name="Docs API", api_key="old-secret")
    get_mock = MagicMock(return_value=existing_extension)
    save_mock = MagicMock(return_value=existing_extension)
    monkeypatch.setattr(
        "controllers.console.extension.APIBasedExtensionService.get_with_tenant_id",
        get_mock,
    )
    monkeypatch.setattr("controllers.console.extension.APIBasedExtensionService.save", save_mock)

    payload = {
        "name": "Docs API Updated",
        "api_endpoint": "https://docs.example.com/v2",
        "api_key": "new-secret",
    }

    extension_id = uuid.uuid4()
    with app.test_request_context(
        f"/console/api/api-based-extension/{extension_id}",
        method="POST",
        json=payload,
    ):
        response = APIBasedExtensionDetailAPI().post(extension_id)

    assert existing_extension.api_key == "new-secret"
    save_mock.assert_called_once_with(existing_extension)
    assert response["name"] == payload["name"]


def test_api_based_extension_detail_delete_removes_extension(app: Flask, monkeypatch: pytest.MonkeyPatch):
    existing_extension = _make_extension()
    get_mock = MagicMock(return_value=existing_extension)
    delete_mock = MagicMock()
    monkeypatch.setattr(
        "controllers.console.extension.APIBasedExtensionService.get_with_tenant_id",
        get_mock,
    )
    monkeypatch.setattr("controllers.console.extension.APIBasedExtensionService.delete", delete_mock)

    extension_id = uuid.uuid4()
    with app.test_request_context(
        f"/console/api/api-based-extension/{extension_id}",
        method="DELETE",
    ):
        response, status = APIBasedExtensionDetailAPI().delete(extension_id)

    delete_mock.assert_called_once_with(existing_extension)
    assert response == {"result": "success"}
    assert status == 204
