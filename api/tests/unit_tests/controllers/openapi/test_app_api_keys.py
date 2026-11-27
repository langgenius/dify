"""Unit tests for the app API-key handlers' service and error mapping."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from http import HTTPStatus

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.common.errors import ForbiddenError
from controllers.common.fields import SimpleResultResponse
from controllers.openapi import app_api_keys
from controllers.openapi._errors import ApiKeyLimitExceeded, AppApiKeyNotReady
from controllers.openapi._models import AppApiKeyListResponse, AppApiKeyRow
from controllers.openapi.app_api_keys import AppApiKeyApi, AppApiKeysApi
from extensions.ext_application_services import ApplicationServices
from machinery.context import RequestContext
from services.app.api_key_service import AppApiKeyNotReadyError
from services.auth.api_key_contracts import (
    ApiKeyLimitExceededError,
    ApiKeyNotFoundError,
    ApiKeyRecord,
    ApiKeyResourceNotFoundError,
)
from services.errors.base import NoPermissionError

_APP_ID = str(uuid.uuid4())
_KEY_ID = str(uuid.uuid4())


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-id",
        trace_id=None,
        account_id=str(uuid.uuid4()),
        active_workspace_id=str(uuid.uuid4()),
    )


def _record(key_id: str = _KEY_ID) -> ApiKeyRecord:
    return ApiKeyRecord(
        id=key_id,
        type="app",
        token="app-secret-token",
        created_at=datetime(2025, 1, 2, 3, 4, 5, tzinfo=UTC),
        last_used_at=None,
    )


def _handler(view: Callable[..., object]) -> Callable[..., object]:
    """Return the bare view ``@endpoint`` attaches as ``__handler__``."""
    handler = vars(view).get("__handler__")
    assert callable(handler)
    return handler


def _patch_service(
    monkeypatch: pytest.MonkeyPatch,
    services: ApplicationServices,
    *,
    list_keys: Callable[..., object] | None = None,
    create_key: Callable[..., object] | None = None,
    delete_key: Callable[..., object] | None = None,
) -> None:
    if list_keys is not None:
        monkeypatch.setattr(services.app_api_keys, "list_keys", list_keys)
    if create_key is not None:
        monkeypatch.setattr(services.app_api_keys, "create_key", create_key)
    if delete_key is not None:
        monkeypatch.setattr(services.app_api_keys, "delete_key", delete_key)
    monkeypatch.setattr(app_api_keys, "application_services", lambda: services)


def test_list_returns_every_key_with_its_full_token(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
) -> None:
    seen: list[tuple[RequestContext, str]] = []

    def list_keys(ctx: RequestContext, app_id: str) -> tuple[ApiKeyRecord, ...]:
        seen.append((ctx, app_id))
        return (_record("key-1"), _record("key-2"))

    _patch_service(monkeypatch, account_application_services, list_keys=list_keys)
    ctx = _request_context()
    api = AppApiKeysApi()
    with app.test_request_context(f"/openapi/v1/apps/{_APP_ID}/api-keys"):
        result = _handler(api.get)(api, ctx, _APP_ID)
        assert isinstance(result, AppApiKeyListResponse)

    assert seen == [(ctx, _APP_ID)]
    assert [row.id for row in result.data] == ["key-1", "key-2"]
    assert all(row.token == "app-secret-token" for row in result.data)
    assert result.data[0].created_at is not None


def test_create_returns_the_new_key_once_with_201(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
) -> None:
    seen: list[tuple[RequestContext, str]] = []

    def create_key(ctx: RequestContext, app_id: str) -> ApiKeyRecord:
        seen.append((ctx, app_id))
        return _record()

    _patch_service(monkeypatch, account_application_services, create_key=create_key)
    ctx = _request_context()
    api = AppApiKeysApi()
    with app.test_request_context(f"/openapi/v1/apps/{_APP_ID}/api-keys", method="POST"):
        response = _handler(api.post)(api, ctx, _APP_ID)
        assert isinstance(response, tuple)
        result, status = response
        assert isinstance(result, AppApiKeyRow)

    assert status == HTTPStatus.CREATED
    assert seen == [(ctx, _APP_ID)]
    assert result.id == _KEY_ID
    assert result.token == "app-secret-token"


def test_delete_removes_the_key(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
) -> None:
    seen: list[tuple[RequestContext, str, str]] = []

    def delete_key(ctx: RequestContext, app_id: str, key_id: str) -> None:
        seen.append((ctx, app_id, key_id))

    _patch_service(monkeypatch, account_application_services, delete_key=delete_key)
    ctx = _request_context()
    api = AppApiKeyApi()
    with app.test_request_context(f"/openapi/v1/apps/{_APP_ID}/api-keys/{_KEY_ID}", method="DELETE"):
        result = _handler(api.delete)(api, ctx, _APP_ID, _KEY_ID)

    assert result == SimpleResultResponse(result="success")
    assert seen == [(ctx, _APP_ID, _KEY_ID)]


def test_create_maps_the_key_limit_to_400(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
) -> None:
    def create_key(_ctx: RequestContext, _app_id: str) -> ApiKeyRecord:
        raise ApiKeyLimitExceededError(10)

    _patch_service(monkeypatch, account_application_services, create_key=create_key)
    api = AppApiKeysApi()
    with app.test_request_context(f"/openapi/v1/apps/{_APP_ID}/api-keys", method="POST"):
        with pytest.raises(ApiKeyLimitExceeded) as raised:
            _handler(api.post)(api, _request_context(), _APP_ID)

    assert raised.value.code == HTTPStatus.BAD_REQUEST


def test_create_maps_an_unpublished_agent_app_to_409(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
) -> None:
    def create_key(_ctx: RequestContext, _app_id: str) -> ApiKeyRecord:
        raise AppApiKeyNotReadyError

    _patch_service(monkeypatch, account_application_services, create_key=create_key)
    api = AppApiKeysApi()
    with app.test_request_context(f"/openapi/v1/apps/{_APP_ID}/api-keys", method="POST"):
        with pytest.raises(AppApiKeyNotReady) as raised:
            _handler(api.post)(api, _request_context(), _APP_ID)

    assert raised.value.code == HTTPStatus.CONFLICT


@pytest.mark.parametrize(
    "failure",
    [ApiKeyResourceNotFoundError("App not found."), ApiKeyNotFoundError()],
    ids=["app", "key"],
)
def test_missing_resources_map_to_404(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    failure: Exception,
) -> None:
    def list_keys(_ctx: RequestContext, _app_id: str) -> tuple[ApiKeyRecord, ...]:
        raise failure

    _patch_service(monkeypatch, account_application_services, list_keys=list_keys)
    api = AppApiKeysApi()
    with app.test_request_context(f"/openapi/v1/apps/{_APP_ID}/api-keys"):
        with pytest.raises(NotFound):
            _handler(api.get)(api, _request_context(), _APP_ID)


def test_a_malformed_key_id_is_404_not_500(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
) -> None:
    _patch_service(monkeypatch, account_application_services)
    api = AppApiKeyApi()
    with app.test_request_context(f"/openapi/v1/apps/{_APP_ID}/api-keys/not-a-uuid", method="DELETE"):
        with pytest.raises(NotFound, match="API key not found"):
            _handler(api.delete)(api, _request_context(), _APP_ID, "not-a-uuid")


def test_no_permission_maps_to_403(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
) -> None:
    def list_keys(_ctx: RequestContext, _app_id: str) -> tuple[ApiKeyRecord, ...]:
        raise NoPermissionError("nope")

    _patch_service(monkeypatch, account_application_services, list_keys=list_keys)
    api = AppApiKeysApi()
    with app.test_request_context(f"/openapi/v1/apps/{_APP_ID}/api-keys"):
        with pytest.raises(ForbiddenError):
            _handler(api.get)(api, _request_context(), _APP_ID)
