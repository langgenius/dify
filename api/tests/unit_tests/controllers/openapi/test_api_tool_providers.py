import uuid
from collections.abc import Callable

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session

from constants.oauth_bearer import TokenType
from controllers.common.fields import SimpleResultResponse
from controllers.openapi._errors import ProviderNotFound
from controllers.openapi._models import (
    ApiToolProviderListQuery,
    ApiToolProviderListResponse,
    ApiToolProviderPayload,
    ApiToolProviderResponse,
)
from controllers.openapi.api_tool_providers import ApiToolProviderApi, ApiToolProvidersApi
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.errors import ApiToolProviderNotFoundError
from libs.oauth_bearer import AuthContext
from services.tools.api_tools_manage_service import ApiToolManageService
from tests.helpers.unit.model_factories import make_account, make_tenant

_NAME = "weather"
_ICON = {"background": "#252525", "content": "\U0001f324"}


def _handler(view: Callable[..., object]) -> Callable[..., object]:
    handler = vars(view).get("__handler__")
    assert callable(handler)
    return handler


def _context(session: Session) -> Context:
    subject = AccountSubject(
        AuthContext(
            subject_email="caller@example.com",
            subject_issuer="dify:account",
            account_id=uuid.uuid4(),
            client_id="difyctl",
            token_id=uuid.uuid4(),
            token_type=TokenType.OAUTH_ACCOUNT,
            expires_at=None,
        )
    )
    ctx = Context(subject, session, {"workspace_id": "ws"})
    ctx._workspace = make_tenant(tenant_id="ws")
    ctx._caller = make_account(interface_language="en-US")
    return ctx


def _payload(name: str = _NAME) -> ApiToolProviderPayload:
    return ApiToolProviderPayload.model_validate(
        {
            "name": name,
            "icon": _ICON,
            "credentials": {"auth_type": "none"},
            "schema_type": "openapi",
            "schema": '{"openapi": "3.0.0"}',
        }
    )


def _provider_dict(credentials: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "schema_type": "openapi",
        "schema": '{"openapi": "3.0.0"}',
        "tools": [{"operation_id": "forecast"}, {"operation_id": "current"}, {"operation_id": None}],
        "icon": dict(_ICON),
        "description": "Weather tools",
        "credentials": credentials if credentials is not None else {"auth_type": "none"},
        "privacy_policy": "https://example.com/privacy",
        "custom_disclaimer": "",
        "labels": ["utilities"],
    }


def _entity(name: str = _NAME) -> ToolProviderApiEntity:
    return ToolProviderApiEntity(
        id="provider-id",
        author="caller",
        name=name,
        description=I18nObject(en_US="Weather tools"),
        icon=dict(_ICON),
        label=I18nObject(en_US=name),
        type=ToolProviderType.API,
        tools=[],
        labels=["utilities"],
    )


def test_list_returns_typed_summaries(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    entity = _entity()
    entity.tools = [
        ToolApiEntity(
            author="caller",
            name="forecast",
            label=I18nObject(en_US="forecast"),
            description=I18nObject(en_US="Forecast"),
        )
    ]
    monkeypatch.setattr(ApiToolManageService, "list_api_tools", lambda *_a: [entity])

    api = ApiToolProvidersApi()
    with app.test_request_context("/openapi/v1/workspaces/ws/api-tool-providers"):
        response = _handler(api.get)(api, _context(sqlite_session), "ws", query=ApiToolProviderListQuery())

    assert isinstance(response, ApiToolProviderListResponse)
    assert (response.page, response.limit, response.total, response.has_more) == (1, 20, 1, False)
    [row] = response.data
    assert (row.name, row.tools, row.labels) == (_NAME, ["forecast"], ["utilities"])


def test_describe_masks_credentials(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    monkeypatch.setattr(ApiToolManageService, "list_api_tools", lambda *_a: [_entity()])
    monkeypatch.setattr(
        ApiToolManageService,
        "get_api_tool_provider",
        lambda *_a, **_k: _provider_dict(credentials={"auth_type": "api_key_header", "api_key_value": "****abc"}),
    )

    api = ApiToolProviderApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/api-tool-providers/{_NAME}"):
        response = _handler(api.get)(api, _context(sqlite_session), "ws", _NAME)

    assert isinstance(response, ApiToolProviderResponse)
    assert response.credentials["api_key_value"] == "****abc"
    assert "s3cr3t" not in str(response.model_dump(mode="json"))
    assert (response.tools, response.name) == (["forecast", "current", "default_tool"], _NAME)


def test_describe_answers_404_for_an_unknown_provider(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(ApiToolManageService, "list_api_tools", lambda *_a: [])

    api = ApiToolProviderApi()
    with (
        app.test_request_context(f"/openapi/v1/workspaces/ws/api-tool-providers/{_NAME}"),
        pytest.raises(ProviderNotFound),
    ):
        _handler(api.get)(api, _context(sqlite_session), "ws", _NAME)


def test_create_calls_the_service_and_answers_201(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    created: list[tuple[object, ...]] = []
    monkeypatch.setattr(ApiToolManageService, "list_api_tools", lambda *_a: [_entity()])
    monkeypatch.setattr(ApiToolManageService, "create_api_tool_provider", lambda *a: created.append(a))
    monkeypatch.setattr(ApiToolManageService, "get_api_tool_provider", lambda *_a, **_k: _provider_dict())

    api = ApiToolProvidersApi()
    with app.test_request_context("/openapi/v1/workspaces/ws/api-tool-providers", method="POST"):
        created_result = _handler(api.post)(api, _context(sqlite_session), "ws", body=_payload())

    assert isinstance(created_result, tuple)
    response, status = created_result

    assert status == 201
    (_user_id, tenant_id, name, *_rest) = created[0]
    assert (tenant_id, name) == ("ws", _NAME)
    assert isinstance(response, ApiToolProviderResponse)


def test_set_renames_through_the_path_name(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    updated: list[tuple[object, ...]] = []
    monkeypatch.setattr(ApiToolManageService, "list_api_tools", lambda *_a: [_entity(name="weather-v2")])
    monkeypatch.setattr(ApiToolManageService, "update_api_tool_provider", lambda *a: updated.append(a))
    monkeypatch.setattr(ApiToolManageService, "get_api_tool_provider", lambda *_a, **_k: _provider_dict())

    api = ApiToolProviderApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/api-tool-providers/{_NAME}", method="PUT"):
        response = _handler(api.put)(api, _context(sqlite_session), "ws", _NAME, body=_payload("weather-v2"))

    (_user_id, tenant_id, new_name, original, *_rest) = updated[0]
    assert (tenant_id, new_name, original) == ("ws", "weather-v2", _NAME)
    assert isinstance(response, ApiToolProviderResponse)
    assert response.name == "weather-v2"


def test_delete_calls_the_service(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    deleted: list[tuple[object, ...]] = []
    monkeypatch.setattr(ApiToolManageService, "list_api_tools", lambda *_a: [_entity()])
    monkeypatch.setattr(ApiToolManageService, "delete_api_tool_provider", lambda *a: deleted.append(a))

    api = ApiToolProviderApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/api-tool-providers/{_NAME}", method="DELETE"):
        result = _handler(api.delete)(api, _context(sqlite_session), "ws", _NAME)

    assert result == SimpleResultResponse(result="success")
    (_user_id, tenant_id, name) = deleted[0]
    assert (tenant_id, name) == ("ws", _NAME)


def test_set_answers_404_for_an_unknown_provider(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    def missing(*_a: object) -> None:
        raise ApiToolProviderNotFoundError(provider_name=_NAME, tenant_id="ws")

    monkeypatch.setattr(ApiToolManageService, "update_api_tool_provider", missing)

    api = ApiToolProviderApi()
    with (
        app.test_request_context(f"/openapi/v1/workspaces/ws/api-tool-providers/{_NAME}", method="PUT"),
        pytest.raises(ProviderNotFound),
    ):
        _handler(api.put)(api, _context(sqlite_session), "ws", _NAME, body=_payload())


def test_a_payload_rejects_extra_fields_and_a_bad_schema_type() -> None:
    with pytest.raises(ValidationError):
        _payload().model_validate({**_payload().model_dump(by_alias=True), "surprise": 1})
    with pytest.raises(ValidationError):
        ApiToolProviderPayload.model_validate(
            {"name": "x", "icon": _ICON, "credentials": {}, "schema_type": "graphql", "schema": "{}"}
        )
