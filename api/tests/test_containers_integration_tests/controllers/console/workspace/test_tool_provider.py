"""Integration coverage for the console MCP provider HTTP endpoint."""

import json
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from core.tools.entities.api_entities import ToolProviderApiEntity
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


def _provider_entity() -> ToolProviderApiEntity:
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
            "tools": [_tool_payload()],
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
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)
    headers = authenticate_console_client(client, account)
    service = MagicMock()
    service.create_provider.return_value = MagicMock(id="provider-1")
    service.get_provider.return_value = MagicMock(id="provider-1", tenant_id="t1")

    with (
        patch("controllers.console.workspace.tool_providers.MCPToolManageService", return_value=service, autospec=True),
        patch(
            "services.tools.tools_transform_service.ToolTransformService.mcp_provider_to_user_provider",
            return_value=_provider_entity(),
            autospec=True,
        ),
    ):
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

    assert response.status_code == 200
    body = response.get_json()
    assert body["id"] == "provider-1"
    assert body["team_credentials"] == {"api_key": "[__HIDDEN__]"}
    assert "masked_credentials" not in body
    assert "original_credentials" not in body
    assert body["tools"]
