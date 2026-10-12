from __future__ import annotations

import builtins
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask.views import MethodView as FlaskMethodView
from werkzeug.exceptions import UnprocessableEntity

from tests.unit_tests.config_override import apply_config_overrides

_NEEDS_METHOD_VIEW_CLEANUP = False
if not hasattr(builtins, "MethodView"):
    builtins.__dict__["MethodView"] = FlaskMethodView
    _NEEDS_METHOD_VIEW_CLEANUP = True

import controllers.console.extension as module
from constants import HIDDEN_VALUE
from controllers.console.extension import (
    APIBasedExtensionAPI,
    APIBasedExtensionDetailAPI,
    APIBasedExtensionPayload,
    CodeBasedExtensionAPI,
)
from enums import DeploymentEdition

if _NEEDS_METHOD_VIEW_CLEANUP:
    del builtins.__dict__["MethodView"]
from machinery.context import RequestContext
from models.account import Account, AccountStatus, Tenant
from services.api_based_extension_application_service import (
    APIBasedExtensionInput,
    APIBasedExtensionNameConflictError,
    APIBasedExtensionNotFoundError,
    APIBasedExtensionRecord,
    APIBasedExtensionUpdate,
)


def unwrap(func: Callable[..., object]) -> Callable[..., object]:
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def _record(
    *,
    name: str = "Sample Extension",
    api_endpoint: str = "https://example.com/api",
    api_key: str = "super-secret-key",
) -> APIBasedExtensionRecord:
    return APIBasedExtensionRecord(
        id=str(uuid.uuid4()),
        name=name,
        api_endpoint=api_endpoint,
        api_key=api_key,
        created_at=datetime(2024, 1, 1, 12, 0, tzinfo=UTC),
    )


def _masked_api_key(api_key: str) -> str:
    if len(api_key) <= 8:
        return api_key[0] + "******" + api_key[-1]
    return api_key[:3] + "******" + api_key[-3:]


@pytest.fixture(autouse=True)
def _mock_console_guards(monkeypatch: pytest.MonkeyPatch) -> Account:
    """Bypass console decorators so the code-based handler can run in isolation."""

    from controllers.console import wraps as wraps_module

    tenant = Tenant(name="Test Workspace")
    tenant.id = "tenant-123"
    account = Account(name="Test User", email="user@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-123"
    account._current_tenant = tenant

    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        INIT_PASSWORD="",
        LOGIN_DISABLED=True,
    )
    monkeypatch.setattr(wraps_module, "current_account_with_tenant", lambda: (account, "tenant-123"))

    # The login_required decorator consults the shared LocalProxy in libs.login.
    monkeypatch.setattr("libs.login.current_user", account)
    monkeypatch.setattr("libs.login.check_csrf_token", lambda *_, **__: None)

    return account


@pytest.fixture(autouse=True)
def _restx_mask_defaults(app: Flask) -> None:
    app.config.setdefault("RESTX_MASK_HEADER", "X-Fields")
    app.config.setdefault("RESTX_MASK_SWAGGER", False)


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="account-123",
        active_workspace_id="tenant-123",
    )


@pytest.fixture
def extensions_service() -> Iterator[MagicMock]:
    service = MagicMock()
    with patch.object(module, "application_services", return_value=SimpleNamespace(api_based_extensions=service)):
        yield service


def test_code_based_extension_get_returns_service_data(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service_result = [{"entrypoint": "main:agent"}]
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


def test_code_based_extension_get_rejects_a_missing_module(app: Flask) -> None:
    """`module` is required, so this is what covers the decorator's rejection path."""
    with app.test_request_context("/console/api/code-based-extension", method="GET"):
        with pytest.raises(UnprocessableEntity):
            CodeBasedExtensionAPI().get()


class TestAPIBasedExtensionAPI:
    def test_get_lists_workspace_extensions_with_masked_keys(
        self, app: Flask, request_context: RequestContext, extensions_service: MagicMock
    ) -> None:
        extension = _record(name="Weather API", api_key="abcdefghi123")
        extensions_service.list_extensions.return_value = (extension,)

        with app.test_request_context("/console/api/api-based-extension", method="GET"):
            response = unwrap(APIBasedExtensionAPI().get)(APIBasedExtensionAPI(), request_context)

        extensions_service.list_extensions.assert_called_once_with(request_context)
        assert response == [
            {
                "id": extension.id,
                "name": "Weather API",
                "api_endpoint": extension.api_endpoint,
                "api_key": _masked_api_key("abcdefghi123"),
                "created_at": int(extension.created_at.timestamp()),
            }
        ]

    def test_post_creates_extension_and_masks_the_submitted_key(
        self, app: Flask, request_context: RequestContext, extensions_service: MagicMock
    ) -> None:
        created = _record(name="Docs API", api_endpoint="https://docs.example.com/hook", api_key="plain-secret")
        extensions_service.create_extension.return_value = created
        payload = APIBasedExtensionPayload(
            name="Docs API", api_endpoint="https://docs.example.com/hook", api_key="plain-secret"
        )

        with app.test_request_context("/console/api/api-based-extension", method="POST"):
            response, status = unwrap(APIBasedExtensionAPI().post)(APIBasedExtensionAPI(), payload, request_context)

        extensions_service.create_extension.assert_called_once_with(
            request_context,
            APIBasedExtensionInput(
                name="Docs API", api_endpoint="https://docs.example.com/hook", api_key="plain-secret"
            ),
        )
        assert status == 201
        assert response["id"] == created.id
        assert response["name"] == "Docs API"
        assert response["api_key"] == _masked_api_key("plain-secret")

    def test_post_maps_domain_errors_to_legacy_value_error(
        self, app: Flask, request_context: RequestContext, extensions_service: MagicMock
    ) -> None:
        extensions_service.create_extension.side_effect = APIBasedExtensionNameConflictError()
        payload = APIBasedExtensionPayload(name="Docs API", api_endpoint="https://docs.example.com", api_key="secret")

        with app.test_request_context("/console/api/api-based-extension", method="POST"):
            with pytest.raises(ValueError, match="name must be unique"):
                unwrap(APIBasedExtensionAPI().post)(APIBasedExtensionAPI(), payload, request_context)


class TestAPIBasedExtensionDetailAPI:
    def test_get_fetches_extension(
        self, app: Flask, request_context: RequestContext, extensions_service: MagicMock
    ) -> None:
        extension = _record(name="Docs API", api_key="abcdefg12345")
        extensions_service.get_extension.return_value = extension
        extension_id = uuid.uuid4()

        with app.test_request_context(f"/console/api/api-based-extension/{extension_id}", method="GET"):
            response = unwrap(APIBasedExtensionDetailAPI().get)(
                APIBasedExtensionDetailAPI(), request_context, extension_id
            )

        extensions_service.get_extension.assert_called_once_with(request_context, str(extension_id))
        assert response["id"] == extension.id
        assert response["name"] == "Docs API"
        assert response["api_key"] == _masked_api_key("abcdefg12345")

    def test_get_maps_missing_extension_to_legacy_value_error(
        self, app: Flask, request_context: RequestContext, extensions_service: MagicMock
    ) -> None:
        extensions_service.get_extension.side_effect = APIBasedExtensionNotFoundError()
        extension_id = uuid.uuid4()

        with app.test_request_context(f"/console/api/api-based-extension/{extension_id}", method="GET"):
            with pytest.raises(ValueError, match="not found"):
                unwrap(APIBasedExtensionDetailAPI().get)(APIBasedExtensionDetailAPI(), request_context, extension_id)

    def test_post_keeps_hidden_api_key(
        self, app: Flask, request_context: RequestContext, extensions_service: MagicMock
    ) -> None:
        updated = _record(name="Docs API Updated", api_endpoint="https://docs.example.com/v2", api_key="keep-me")
        extensions_service.update_extension.return_value = updated
        payload = APIBasedExtensionPayload(
            name="Docs API Updated", api_endpoint="https://docs.example.com/v2", api_key=HIDDEN_VALUE
        )
        extension_id = uuid.uuid4()

        with app.test_request_context(f"/console/api/api-based-extension/{extension_id}", method="POST"):
            response = unwrap(APIBasedExtensionDetailAPI().post)(
                APIBasedExtensionDetailAPI(), payload, request_context, extension_id
            )

        extensions_service.update_extension.assert_called_once_with(
            request_context,
            str(extension_id),
            APIBasedExtensionUpdate(name="Docs API Updated", api_endpoint="https://docs.example.com/v2", api_key=None),
        )
        assert response["name"] == "Docs API Updated"
        assert response["api_key"] == _masked_api_key("keep-me")

    def test_post_forwards_a_new_api_key(
        self, app: Flask, request_context: RequestContext, extensions_service: MagicMock
    ) -> None:
        updated = _record(name="Docs API Updated", api_endpoint="https://docs.example.com/v2", api_key="new-secret")
        extensions_service.update_extension.return_value = updated
        payload = APIBasedExtensionPayload(
            name="Docs API Updated", api_endpoint="https://docs.example.com/v2", api_key="new-secret"
        )
        extension_id = uuid.uuid4()

        with app.test_request_context(f"/console/api/api-based-extension/{extension_id}", method="POST"):
            response = unwrap(APIBasedExtensionDetailAPI().post)(
                APIBasedExtensionDetailAPI(), payload, request_context, extension_id
            )

        update = extensions_service.update_extension.call_args.args[2]
        assert update.api_key == "new-secret"
        assert response["api_key"] == _masked_api_key("new-secret")

    def test_delete_removes_extension(
        self, app: Flask, request_context: RequestContext, extensions_service: MagicMock
    ) -> None:
        extension_id = uuid.uuid4()

        with app.test_request_context(f"/console/api/api-based-extension/{extension_id}", method="DELETE"):
            response, status = unwrap(APIBasedExtensionDetailAPI().delete)(
                APIBasedExtensionDetailAPI(), request_context, extension_id
            )

        extensions_service.delete_extension.assert_called_once_with(request_context, str(extension_id))
        assert status == 204
        assert response == ""

    def test_delete_maps_missing_extension_to_legacy_value_error(
        self, app: Flask, request_context: RequestContext, extensions_service: MagicMock
    ) -> None:
        extensions_service.delete_extension.side_effect = APIBasedExtensionNotFoundError()
        extension_id = uuid.uuid4()

        with app.test_request_context(f"/console/api/api-based-extension/{extension_id}", method="DELETE"):
            with pytest.raises(ValueError, match="not found"):
                unwrap(APIBasedExtensionDetailAPI().delete)(APIBasedExtensionDetailAPI(), request_context, extension_id)
