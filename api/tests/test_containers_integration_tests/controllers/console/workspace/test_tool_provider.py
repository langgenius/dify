"""Integration coverage for the console MCP provider HTTP endpoint."""

import json
from types import SimpleNamespace
from unittest.mock import ANY, call, patch

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from core.tools.entities.api_entities import ToolProviderApiEntity
from services.tools.mcp_tools_manage_service import ReconnectResult
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def _i18n(text: str) -> dict[str, str]:
    return {"en_US": text}


def _tool_payload() -> dict[str, object]:
    return {
        "author": "langgenius",
        "name": "ping",
        "label": _i18n("Ping"),
        "description": _i18n("Ping description"),
        "parameters": [],
        "labels": ["utilities"],
        "output_schema": {},
    }


def _provider_entity(*, tools: list[dict[str, object]] | None = None) -> ToolProviderApiEntity:
    return ToolProviderApiEntity.model_validate(
        {
            "id": "provider-1",
            "author": "langgenius",
            "name": "provider",
            "description": _i18n("Provider description"),
            "icon": {"content": "tool", "background": "#252525"},
            "icon_dark": {"content": "tool", "background": "#252525"},
            "label": _i18n("Provider"),
            "type": "mcp",
            "masked_credentials": {"api_key": "[__HIDDEN__]"},
            "original_credentials": {"api_key": "sk-secret"},
            "is_team_authorization": False,
            "allow_delete": True,
            "plugin_id": "langgenius/provider",
            "plugin_unique_identifier": "langgenius/provider:1.0.0",
            "tools": tools or [],
            "labels": ["utilities"],
            "server_url": "",
            "updated_at": 1710000000,
            "server_identifier": "",
            "masked_headers": None,
            "original_headers": None,
            "authentication": None,
            "is_dynamic_registration": True,
            "configuration": None,
            "identity_mode": "off",
            "workflow_app_id": None,
        }
    )


@pytest.fixture
def client(flask_app_with_containers: Flask) -> FlaskClient:
    return flask_app_with_containers.test_client()


def test_create_mcp_provider_populates_tools(
    client: FlaskClient,
    db_session_with_containers: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    headers = authenticate_console_client(client, account)
    created_provider = _provider_entity()
    connected_provider = _provider_entity(tools=[_tool_payload()])
    reconnect = ReconnectResult(authed=True, tools=json.dumps([_tool_payload()]), encrypted_credentials="{}")
    db_provider = SimpleNamespace(authed=False, tools="[]")

    with patch("controllers.console.workspace.tool_providers.MCPToolManageService", autospec=True) as service_cls:
        service = service_cls.return_value
        service.create_provider.return_value = "provider-1"
        service.get_provider_by_id.return_value = db_provider
        service_cls.provider_response.side_effect = [created_provider, connected_provider]
        service_cls.reconnect_with_url.return_value = reconnect
        response = client.post(
            "/console/api/workspaces/current/tool-provider/mcp",
            data=json.dumps(
                {
                    "server_url": "http://example.com/mcp",
                    "name": "demo",
                    "icon": "😀",
                    "icon_type": "emoji",
                    "icon_background": "#000",
                    "server_identifier": "demo-sid",
                    "configuration": {"timeout": 5, "sse_read_timeout": 30},
                    "headers": {},
                    "authentication": {},
                }
            ),
            headers=headers,
            content_type="application/json",
        )

    create_kwargs = service.create_provider.call_args.kwargs
    assert create_kwargs["tenant_id"] == tenant.id
    assert create_kwargs["user_id"] == account.id
    assert create_kwargs["server_url"] == "http://example.com/mcp"
    service_cls.provider_response.assert_has_calls(
        [
            call(tenant_id=tenant.id, provider_id="provider-1", tool_providers=ANY),
            call(tenant_id=tenant.id, provider_id="provider-1", tool_providers=ANY),
        ]
    )
    service_cls.reconnect_with_url.assert_called_once_with(
        server_url="http://example.com/mcp", headers={}, timeout=5.0, sse_read_timeout=30.0
    )
    service.get_provider_by_id.assert_called_once_with(provider_id="provider-1", tenant_id=tenant.id)
    assert db_provider.authed is True
    assert db_provider.tools == reconnect.tools
    assert response.status_code == 200
    body = response.get_json()
    assert body["id"] == "provider-1"
    assert body["team_credentials"] == {"api_key": "[__HIDDEN__]"}
    assert "masked_credentials" not in body
    assert "original_credentials" not in body
    assert body["tools"]
