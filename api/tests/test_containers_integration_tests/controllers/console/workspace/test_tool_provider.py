"""Testcontainers integration tests for controllers.console.workspace.tool_providers endpoints."""

from __future__ import annotations

import json
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.console.workspace.tool_providers import (
    ToolApiListApi,
    ToolApiProviderAddApi,
    ToolApiProviderDeleteApi,
    ToolApiProviderGetApi,
    ToolApiProviderGetRemoteSchemaApi,
    ToolApiProviderListToolsApi,
    ToolApiProviderUpdateApi,
    ToolBuiltinListApi,
    ToolBuiltinProviderAddApi,
    ToolBuiltinProviderCredentialsSchemaApi,
    ToolBuiltinProviderDeleteApi,
    ToolBuiltinProviderGetCredentialInfoApi,
    ToolBuiltinProviderGetCredentialsApi,
    ToolBuiltinProviderGetOauthClientSchemaApi,
    ToolBuiltinProviderIconApi,
    ToolBuiltinProviderInfoApi,
    ToolBuiltinProviderListToolsApi,
    ToolBuiltinProviderSetDefaultApi,
    ToolBuiltinProviderUpdateApi,
    ToolLabelsApi,
    ToolOAuthCallback,
    ToolOAuthCustomClient,
    ToolPluginOAuthApi,
    ToolProviderListApi,
    ToolWorkflowListApi,
    ToolWorkflowProviderCreateApi,
    ToolWorkflowProviderDeleteApi,
    ToolWorkflowProviderGetApi,
    ToolWorkflowProviderUpdateApi,
    is_valid_url,
)
from core.tools.entities.api_entities import ToolProviderApiEntity as CoreToolProviderApiEntity
from models.account import Account, TenantAccountRole
from services.tools.mcp_tools_manage_service import ReconnectResult
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def empty_mapping() -> dict[str, object]:
    return {}


def empty_list() -> list[object]:
    return []


def emoji_icon() -> dict[str, str]:
    return {"content": "tool", "background": "#252525"}


def i18n(text: str) -> dict[str, str]:
    return {"en_US": text}


def tool_payload(name: str = "ping") -> dict[str, object]:
    return {
        "author": "langgenius",
        "name": name,
        "label": i18n(name.title()),
        "description": i18n(f"{name} description"),
        "parameters": [],
        "labels": ["utilities"],
        "output_schema": {},
    }


def provider_payload(
    *,
    provider_id: str = "provider-1",
    name: str = "provider",
    provider_type: str = "builtin",
    tools: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "id": provider_id,
        "author": "langgenius",
        "name": name,
        "description": i18n(f"{name} description"),
        "icon": emoji_icon(),
        "icon_dark": emoji_icon(),
        "label": i18n(name.title()),
        "type": provider_type,
        "masked_credentials": {"api_key": "[__HIDDEN__]"},
        "original_credentials": {"api_key": "sk-secret"},
        "is_team_authorization": False,
        "allow_delete": True,
        "plugin_id": "langgenius/provider",
        "plugin_unique_identifier": "langgenius/provider:1.0.0",
        "tools": tools or [tool_payload()],
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


def provider_entity(
    *,
    provider_id: str = "provider-1",
    name: str = "provider",
    provider_type: str = "builtin",
    tools: list[dict[str, object]] | None = None,
) -> CoreToolProviderApiEntity:
    return CoreToolProviderApiEntity.model_validate(
        provider_payload(provider_id=provider_id, name=name, provider_type=provider_type, tools=tools)
    )


def credential_payload() -> dict[str, object]:
    return {
        "id": "credential-1",
        "name": "Default credential",
        "provider": "provider",
        "credential_type": "api-key",
        "is_default": True,
        "credentials": {"api_key": "masked"},
        "visibility": "all_team_members",
        "created_by": "user-1",
        "partial_member_list": [],
        "from_other_member": False,
    }


def provider_config_payload() -> dict[str, object]:
    return {"type": "secret-input", "name": "api_key", "required": True}


def api_tool_bundle_payload() -> dict[str, object]:
    return {
        "server_url": "https://api.example.com",
        "method": "get",
        "summary": "Ping",
        "operation_id": "ping",
        "parameters": [],
        "author": "langgenius",
        "icon": None,
        "openapi": {"operationId": "ping"},
        "output_schema": {},
    }


def api_provider_detail_payload() -> dict[str, object]:
    return {
        "schema_type": "openapi",
        "schema": "{}",
        "tools": [api_tool_bundle_payload()],
        "icon": emoji_icon(),
        "description": "API provider",
        "credentials": {},
        "privacy_policy": "",
        "custom_disclaimer": "",
        "labels": ["utilities"],
    }


def credential_info_payload() -> dict[str, object]:
    return {
        "supported_credential_types": ["api-key", "oauth2"],
        "is_oauth_custom_client_enabled": False,
        "credentials": [credential_payload()],
    }


def oauth_client_schema_payload() -> dict[str, object]:
    return {
        "schema": [provider_config_payload()],
        "is_oauth_custom_client_enabled": False,
        "is_system_oauth_params_exists": True,
        "client_params": {"client_id": "masked"},
        "redirect_uri": "https://console.example.com/oauth/callback",
    }


def tool_label_payload() -> dict[str, object]:
    return {
        "name": "utilities",
        "label": i18n("Utilities"),
        "icon": "wrench",
    }


@pytest.fixture
def _mock_cache() -> None:
    return


@pytest.fixture
def _mock_user_tenant() -> None:
    return


@pytest.fixture
def client(flask_app_with_containers: Flask) -> FlaskClient:
    return flask_app_with_containers.test_client()


def make_account(*, id: str = "u", role: TenantAccountRole = TenantAccountRole.EDITOR) -> Account:
    account = Account(name="Alice", email=f"{id}@example.com")
    account.id = id
    account.role = role
    return account


@patch("controllers.console.workspace.tool_providers.sessionmaker", autospec=True)
@patch("controllers.console.workspace.tool_providers.MCPToolManageService._reconnect_with_url", autospec=True)
@pytest.mark.usefixtures("_mock_cache", "_mock_user_tenant")
def test_create_mcp_provider_populates_tools(
    mock_reconnect: MagicMock,
    mock_session: MagicMock,
    client: FlaskClient,
    db_session_with_containers: Session,
) -> None:
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)
    headers = authenticate_console_client(client, account)

    # Arrange: reconnect returns tools immediately
    mock_reconnect.return_value = ReconnectResult(
        authed=True,
        tools=json.dumps(
            [{"name": "ping", "description": "ok", "inputSchema": {"type": "object"}, "outputSchema": {}}]
        ),
        encrypted_credentials="{}",
    )

    # Fake service.create_provider -> returns object with id for reload
    svc = MagicMock()
    create_result = MagicMock()
    create_result.id = "provider-1"
    svc.create_provider.return_value = create_result
    svc.get_provider.return_value = MagicMock(id="provider-1", tenant_id="t1")  # used by reload path
    mock_session.return_value.begin.return_value.__enter__.return_value = MagicMock()
    # Patch MCPToolManageService constructed inside controller
    with patch("controllers.console.workspace.tool_providers.MCPToolManageService", return_value=svc, autospec=True):
        payload = {
            "server_url": "http://example.com/mcp",
            "name": "demo",
            "icon": "😀",
            "icon_type": "emoji",
            "icon_background": "#000",
            "server_identifier": "demo-sid",
            "configuration": {"timeout": 5, "sse_read_timeout": 30},
            "headers": empty_mapping(),
            "authentication": empty_mapping(),
        }
        # Act
        with (
            patch(
                "services.tools.tools_transform_service.ToolTransformService.mcp_provider_to_user_provider",
                return_value=provider_entity(provider_id="provider-1", provider_type="mcp", tools=[tool_payload()]),
                autospec=True,
            ),
        ):
            resp = client.post(
                "/console/api/workspaces/current/tool-provider/mcp",
                data=json.dumps(payload),
                headers=headers,
                content_type="application/json",
            )

        # Assert
        assert resp.status_code == 200
        body = resp.get_json()
        assert body.get("id") == "provider-1"
        assert body["team_credentials"] == {"api_key": "[__HIDDEN__]"}
        assert "masked_credentials" not in body
        assert "original_credentials" not in body
        assert isinstance(body.get("tools"), list)
        assert body["tools"]


class TestUtils:
    def test_is_valid_url(self) -> None:
        assert is_valid_url("https://example.com")
        assert is_valid_url("http://example.com")
        assert not is_valid_url("")
        assert not is_valid_url("ftp://example.com")
        assert not is_valid_url("not-a-url")
        assert not is_valid_url(None)  # type: ignore[arg-type]


class TestToolProviderListApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_get_success(self, app: Flask) -> None:
        api = ToolProviderListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.ToolCommonService.list_tool_providers",
                return_value=[provider_entity(provider_id="p1").to_dict()],
            ),
        ):
            result = method(api, "t1", make_account(id="u1"))

        assert result[0]["id"] == "p1"
        assert result[0]["team_credentials"] == {"api_key": "[__HIDDEN__]"}
        assert "masked_credentials" not in result[0]
        assert "original_credentials" not in result[0]
        assert result[0]["tools"][0]["name"] == "ping"


class TestBuiltinProviderApis:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_list_tools(self, app: Flask) -> None:
        api = ToolBuiltinProviderListToolsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.list_builtin_tool_provider_tools",
                return_value=[tool_payload()],
            ),
        ):
            assert method(api, "t1", "provider")[0]["name"] == "ping"

    def test_info(self, app: Flask) -> None:
        api = ToolBuiltinProviderInfoApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_info",
                return_value=provider_entity(),
            ),
        ):
            result = method(api, "t1", "provider")

        assert result["id"] == "provider-1"
        assert result["team_credentials"] == {"api_key": "[__HIDDEN__]"}
        assert "masked_credentials" not in result
        assert "original_credentials" not in result

    def test_delete(self, app: Flask) -> None:
        api = ToolBuiltinProviderDeleteApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credential_id": "cid"}),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.delete_builtin_tool_provider",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "t1", "provider")["result"] == "success"

    def test_add_invalid_type(self, app: Flask) -> None:
        api = ToolBuiltinProviderAddApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": empty_mapping(), "type": "invalid"}),
        ):
            with pytest.raises(ValueError):
                method(api, "t", make_account(), "provider")

    def test_add_success(self, app: Flask) -> None:
        api = ToolBuiltinProviderAddApi()
        method = unwrap(api.post)

        payload = {"credentials": empty_mapping(), "type": "oauth2", "name": "n"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.add_builtin_tool_provider",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "t", make_account(), "provider")["result"] == "success"

    def test_update(self, app: Flask) -> None:
        api = ToolBuiltinProviderUpdateApi()
        method = unwrap(api.post)

        payload = {"credential_id": "c1", "credentials": empty_mapping(), "name": "n"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.update_builtin_tool_provider",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "t", make_account(), "provider")["result"] == "success"

    def test_get_credentials(self, app: Flask) -> None:
        api = ToolBuiltinProviderGetCredentialsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_credentials",
                return_value=[credential_payload()],
            ),
        ):
            assert method(api, "t", make_account(id="user-1"), "provider")[0]["id"] == "credential-1"

    def test_icon(self, app: Flask) -> None:
        api = ToolBuiltinProviderIconApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_icon",
                return_value=(b"x", "image/png"),
            ),
        ):
            response = method(api, "provider")
            assert response.mimetype == "image/png"

    def test_credentials_schema(self, app: Flask) -> None:
        api = ToolBuiltinProviderCredentialsSchemaApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.list_builtin_provider_credentials_schema",
                return_value=[provider_config_payload()],
            ),
        ):
            assert method(api, "t", "provider", "oauth2")[0]["name"] == "api_key"

    def test_set_default_credential(self, app: Flask) -> None:
        api = ToolBuiltinProviderSetDefaultApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"id": "c1"}),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.set_default_provider",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "t", "provider")["result"] == "success"

    def test_get_credential_info(self, app: Flask) -> None:
        api = ToolBuiltinProviderGetCredentialInfoApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_credential_info",
                return_value=credential_info_payload(),
            ),
        ):
            assert method(api, "t", make_account(), "provider")["credentials"][0]["id"] == "credential-1"

    def test_get_oauth_client_schema(self, app: Flask) -> None:
        api = ToolBuiltinProviderGetOauthClientSchemaApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_oauth_client_schema",
                return_value=oauth_client_schema_payload(),
            ),
        ):
            assert method(api, "t", "provider")["schema"][0]["name"] == "api_key"


class TestApiProviderApis:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_add(self, app: Flask) -> None:
        api = ToolApiProviderAddApi()
        method = unwrap(api.post)

        payload = {
            "credentials": empty_mapping(),
            "schema_type": "openapi",
            "schema": "{}",
            "provider": "p",
            "icon": emoji_icon(),
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.create_api_tool_provider",
                return_value={"result": "success"},
            ) as create_api_tool_provider,
        ):
            assert method(api, "t", make_account()) == {"result": "success"}

        create_api_tool_provider.assert_called_once()
        assert create_api_tool_provider.call_args.args[3] == emoji_icon()

    def test_remote_schema(self, app: Flask) -> None:
        api = ToolApiProviderGetRemoteSchemaApi()
        method = unwrap(api.get)
        openapi_schema = '{"openapi":"3.0.0","info":{"title":"Demo API","version":"1.0.0"},"paths":{}}'

        with (
            app.test_request_context("/?url=http://x.com"),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.get_api_tool_provider_remote_schema",
                return_value={"schema": openapi_schema},
            ),
        ):
            assert method(api, "t", make_account()) == {"schema": openapi_schema}

    def test_list_tools(self, app: Flask) -> None:
        api = ToolApiProviderListToolsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?provider=p"),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.list_api_tool_provider_tools",
                return_value=[tool_payload("api_ping")],
            ),
        ):
            assert method(api, "t", make_account())[0]["name"] == "api_ping"

    def test_update(self, app: Flask) -> None:
        api = ToolApiProviderUpdateApi()
        method = unwrap(api.post)

        payload = {
            "credentials": empty_mapping(),
            "schema_type": "openapi",
            "schema": "{}",
            "provider": "p",
            "original_provider": "o",
            "icon": emoji_icon(),
            "privacy_policy": "",
            "custom_disclaimer": "",
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.update_api_tool_provider",
                return_value={"result": "success"},
            ) as update_api_tool_provider,
        ):
            assert method(api, "t", make_account()) == {"result": "success"}

        update_api_tool_provider.assert_called_once()
        assert update_api_tool_provider.call_args.args[4] == emoji_icon()

    def test_delete(self, app: Flask) -> None:
        api = ToolApiProviderDeleteApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"provider": "p"}),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.delete_api_tool_provider",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "t", make_account())["result"] == "success"

    def test_get(self, app: Flask) -> None:
        api = ToolApiProviderGetApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?provider=p"),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.get_api_tool_provider",
                return_value=api_provider_detail_payload(),
            ),
        ):
            assert method(api, "t", make_account())["schema"] == "{}"


class TestWorkflowApis:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_create(self, app: Flask) -> None:
        api = ToolWorkflowProviderCreateApi()
        method = unwrap(api.post)

        payload = {
            "workflow_app_id": "123e4567-e89b-12d3-a456-426614174000",
            "name": "n",
            "label": "l",
            "description": "d",
            "icon": emoji_icon(),
            "parameters": empty_list(),
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.WorkflowToolManageService.create_workflow_tool",
                return_value={"result": "success"},
            ) as create_workflow_tool,
        ):
            assert method(api, "t", make_account()) == {"result": "success"}

        create_workflow_tool.assert_called_once()
        assert create_workflow_tool.call_args.kwargs["icon"] == emoji_icon()

    def test_update_invalid(self, app: Flask) -> None:
        api = ToolWorkflowProviderUpdateApi()
        method = unwrap(api.post)

        payload = {
            "workflow_tool_id": "123e4567-e89b-12d3-a456-426614174000",
            "name": "Tool",
            "label": "Tool Label",
            "description": "A tool",
            "icon": emoji_icon(),
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.WorkflowToolManageService.update_workflow_tool",
                return_value={"result": "success"},
            ) as update_workflow_tool,
        ):
            result = method(api, "t", make_account())
            assert result == {"result": "success"}

        update_workflow_tool.assert_called_once()
        assert update_workflow_tool.call_args.args[5] == emoji_icon()

    def test_delete(self, app: Flask) -> None:
        api = ToolWorkflowProviderDeleteApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"workflow_tool_id": "123e4567-e89b-12d3-a456-426614174000"}),
            patch(
                "controllers.console.workspace.tool_providers.WorkflowToolManageService.delete_workflow_tool",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "t", make_account())["result"] == "success"

    def test_get_error(self, app: Flask) -> None:
        api = ToolWorkflowProviderGetApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
        ):
            with pytest.raises(ValueError):
                method(api, "t", make_account())


class TestLists:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_builtin_list(self, app: Flask) -> None:
        api = ToolBuiltinListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.list_builtin_tools",
                return_value=[provider_entity(provider_id="builtin-1")],
            ),
        ):
            assert method(api, "t", make_account())[0]["id"] == "builtin-1"

    def test_api_list(self, app: Flask) -> None:
        api = ToolApiListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.list_api_tools",
                return_value=[provider_entity(provider_id="api-1", provider_type="api")],
            ),
        ):
            assert method(api, "t")[0]["id"] == "api-1"

    def test_workflow_list(self, app: Flask) -> None:
        api = ToolWorkflowListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.WorkflowToolManageService.list_tenant_workflow_tools",
                return_value=[provider_entity(provider_id="workflow-1", provider_type="workflow")],
            ),
        ):
            assert method(api, "t", make_account())[0]["id"] == "workflow-1"


class TestLabels:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_labels(self, app: Flask) -> None:
        api = ToolLabelsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.ToolLabelsService.list_tool_labels",
                return_value=[tool_label_payload()],
            ),
        ):
            assert method(api)[0]["name"] == "utilities"


class TestOAuth:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_oauth_no_client(self, app: Flask) -> None:
        api = ToolPluginOAuthApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_oauth_client",
                return_value=None,
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "t", make_account(), "provider")

    def test_oauth_callback_no_cookie(self, app: Flask) -> None:
        api = ToolOAuthCallback()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "provider")


class TestOAuthCustomClient:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask) -> Flask:
        return flask_app_with_containers

    def test_save_custom_client(self, app: Flask) -> None:
        api = ToolOAuthCustomClient()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"client_params": {"a": 1}}),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.save_custom_oauth_client_params",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "t", "provider") == {"result": "success"}

    def test_get_custom_client(self, app: Flask) -> None:
        api = ToolOAuthCustomClient()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_custom_oauth_client_params",
                return_value={"client_id": "x"},
            ),
        ):
            assert method(api, "t", "provider") == {"client_id": "x"}

    def test_delete_custom_client(self, app: Flask) -> None:
        api = ToolOAuthCustomClient()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.delete_custom_oauth_client_params",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "t", "provider") == {"result": "success"}
