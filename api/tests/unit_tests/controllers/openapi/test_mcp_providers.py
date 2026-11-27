import uuid
from collections.abc import Callable

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session

from constants.oauth_bearer import TokenType
from controllers.openapi import mcp_providers
from controllers.openapi._errors import ProviderNotFound
from controllers.openapi._models import McpProviderPayload, McpProviderResponse
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.mcp_providers import McpProviderApi, McpProviderRefreshApi, McpProvidersApi
from core.entities.mcp_provider import IdentityMode, MCPConfiguration
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from libs.oauth_bearer import AuthContext
from models.tools import MCPToolProvider
from services.tools.mcp_tools_manage_service import MCPToolManageService, ReconnectResult
from tests.helpers.unit.model_factories import make_account, make_tenant

_PROVIDER_ID = "3f9a0b1e-1234-4a67-9abc-def012345678"


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


def _payload() -> McpProviderPayload:
    return McpProviderPayload.model_validate(
        {
            "server_url": "https://mcp.example.com/sse",
            "name": "fetch",
            "icon": "\U0001f310",
            "icon_type": "emoji",
            "server_identifier": "fetch",
        }
    )


def _entity() -> ToolProviderApiEntity:
    return ToolProviderApiEntity(
        id=_PROVIDER_ID,
        author="caller",
        name="fetch",
        description=I18nObject(en_US="Fetch tools"),
        icon="\U0001f310",
        label=I18nObject(en_US="fetch"),
        type=ToolProviderType.MCP,
        tools=[
            ToolApiEntity(
                author="caller",
                name="fetch_url",
                label=I18nObject(en_US="fetch_url"),
                description=I18nObject(en_US="Fetch a URL"),
            )
        ],
        labels=[],
        server_url="https://mcp.example.com/*****",
        server_identifier="fetch",
        masked_headers={"Authorization": "****"},
        authentication=None,
        is_team_authorization=False,
        is_dynamic_registration=True,
        configuration=MCPConfiguration(),
        identity_mode="off",
        updated_at=1_700_000_000,
    )


def _provider() -> MCPToolProvider:
    return MCPToolProvider(
        name="fetch",
        server_identifier="fetch",
        server_url="https://mcp.example.com/sse",
        server_url_hash="hash",
        icon="\U0001f310",
        tenant_id="ws",
        user_id="caller",
        identity_mode="off",
    )


def _service(
    session: Session, monkeypatch: pytest.MonkeyPatch, **methods: Callable[..., object]
) -> MCPToolManageService:
    """A real MCPToolManageService with the named methods replaced, wired as the controller's service."""
    service = MCPToolManageService(session=session)
    for name, replacement in methods.items():
        monkeypatch.setattr(service, name, replacement)
    monkeypatch.setattr(mcp_providers, "_service", lambda _session: service)
    return service


def _patch_describe(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        mcp_providers,
        "_describe",
        lambda *_a, **_k: McpProviderResponse.model_validate(
            {
                "id": _PROVIDER_ID,
                "name": "fetch",
                "icon": "\U0001f310",
                "server_url": "https://mcp.example.com/*****",
                "server_identifier": "fetch",
                "masked_headers": {"Authorization": "****"},
                "authentication": None,
                "is_team_authorization": False,
                "is_dynamic_registration": True,
                "configuration": MCPConfiguration(),
                "identity_mode": "off",
                "updated_at": 1_700_000_000,
                "tools": ["fetch_url"],
            }
        ),
    )


def test_describe_masks_secrets(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    _service(
        sqlite_session,
        monkeypatch,
        list_providers=lambda **_k: [_entity()],
        get_provider_by_id=lambda **_k: _provider(),
    )
    monkeypatch.setattr(mcp_providers.ToolTransformService, "mcp_provider_to_user_provider", lambda _p: _entity())
    monkeypatch.setattr(mcp_providers, "_session", lambda: _NullSession(sqlite_session))

    api = McpProviderApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/mcp-providers/{_PROVIDER_ID}"):
        response = _handler(api.get)(api, _context(sqlite_session), "ws", _PROVIDER_ID)

    assert isinstance(response, McpProviderResponse)
    dumped = str(response.model_dump(mode="json"))
    assert "****" in dumped
    assert "s3cr3t" not in dumped
    assert response.tools == ["fetch_url"]


def test_describe_answers_404_for_an_unknown_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _service(sqlite_session, monkeypatch, list_providers=lambda **_k: [])
    monkeypatch.setattr(mcp_providers, "_session", lambda: _NullSession(sqlite_session))

    api = McpProviderApi()
    with (
        app.test_request_context(f"/openapi/v1/workspaces/ws/mcp-providers/{_PROVIDER_ID}"),
        pytest.raises(ProviderNotFound),
    ):
        _handler(api.get)(api, _context(sqlite_session), "ws", _PROVIDER_ID)


def test_create_runs_the_short_transaction_then_reconnects(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    created: dict[str, object] = {}
    _service(
        sqlite_session,
        monkeypatch,
        create_provider=lambda **kwargs: created.update(kwargs) or _entity(),
        get_provider_by_id=lambda **_k: _provider(),
    )
    reconnect = ReconnectResult(authed=True, tools='[{"name": "fetch_url"}]', encrypted_credentials="")
    monkeypatch.setattr(mcp_providers, "_session", lambda: _NullSession(sqlite_session))
    monkeypatch.setattr(MCPToolManageService, "reconnect_with_url", staticmethod(lambda **_k: reconnect))
    _patch_describe(monkeypatch)

    api = McpProvidersApi()
    with app.test_request_context("/openapi/v1/workspaces/ws/mcp-providers", method="POST"):
        created_result = _handler(api.post)(api, _context(sqlite_session), "ws", body=_payload())

    assert isinstance(created_result, tuple)
    response, status = created_result

    assert status == 201
    assert created["tenant_id"] == "ws"
    assert created["identity_mode"] == IdentityMode.OFF
    assert isinstance(response, McpProviderResponse)


def test_set_validates_the_url_outside_the_transaction(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    order: list[str] = []
    _service(
        sqlite_session,
        monkeypatch,
        get_provider_for_url_validation=lambda **_k: order.append("validation_data") or "data",
        get_provider_by_id=lambda **_k: _provider(),
        update_provider=lambda **_k: order.append("update"),
        list_providers=lambda **_k: [_entity()],
    )

    class _OrderedSession:
        def __enter__(self) -> "_OrderedSession":
            order.append("session")
            return self

        def __exit__(self, *_a: object) -> None:
            return None

        def commit(self) -> None:
            return None

    monkeypatch.setattr(mcp_providers, "_session", _OrderedSession)
    monkeypatch.setattr(
        MCPToolManageService,
        "validate_server_url_standalone",
        staticmethod(lambda **_k: order.append("validate") or "result"),
    )
    _patch_describe(monkeypatch)

    api = McpProviderApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/mcp-providers/{_PROVIDER_ID}", method="PUT"):
        response = _handler(api.put)(api, _context(sqlite_session), "ws", _PROVIDER_ID, body=_payload())

    assert isinstance(response, McpProviderResponse)
    # The URL validation ran between the two sessions, after the first one
    # fetched the stored provider and before the second wrote the update.
    assert order[:2] == ["session", "validate"] or order.index("session", 1) > order.index("validate") > -1
    assert order.index("update") > order.index("validate")


def test_delete_answers_404_for_an_unknown_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _service(sqlite_session, monkeypatch, list_providers=lambda **_k: [])
    monkeypatch.setattr(mcp_providers, "_session", lambda: _NullSession(sqlite_session))

    api = McpProviderApi()
    with (
        app.test_request_context(f"/openapi/v1/workspaces/ws/mcp-providers/{_PROVIDER_ID}", method="DELETE"),
        pytest.raises(ProviderNotFound),
    ):
        _handler(api.delete)(api, _context(sqlite_session), "ws", _PROVIDER_ID)


def test_refresh_refetches_tools(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    called: list[dict[str, object]] = []
    _service(
        sqlite_session,
        monkeypatch,
        list_providers=lambda **_k: [_entity()],
        list_provider_tools=lambda **kwargs: called.append(kwargs),
    )
    monkeypatch.setattr(mcp_providers, "_session", lambda: _NullSession(sqlite_session))
    _patch_describe(monkeypatch)

    api = McpProviderRefreshApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/mcp-providers/{_PROVIDER_ID}:refresh", method="POST"):
        response = _handler(api.post)(api, _context(sqlite_session), "ws", _PROVIDER_ID)

    assert called == [{"tenant_id": "ws", "provider_id": _PROVIDER_ID}]
    assert isinstance(response, McpProviderResponse)


def test_a_payload_rejects_extra_fields() -> None:
    with pytest.raises(ValidationError):
        McpProviderPayload.model_validate(
            {
                "server_url": "https://mcp.example.com/sse",
                "name": "fetch",
                "icon": "\U0001f310",
                "icon_type": "emoji",
                "server_identifier": "fetch",
                "identity_mode": "idp_token",
            }
        )


class _NullSession:
    def __init__(self, session: Session) -> None:
        self._session = session

    def __enter__(self) -> Session:
        return self._session

    def __exit__(self, *_a: object) -> None:
        return None
