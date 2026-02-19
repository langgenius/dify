import json
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask_restx import Api
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
    ToolProviderMCPApi,
    ToolWorkflowListApi,
    ToolWorkflowProviderCreateApi,
    ToolWorkflowProviderDeleteApi,
    ToolWorkflowProviderGetApi,
    ToolWorkflowProviderUpdateApi,
    is_valid_url,
)
from core.db.session_factory import configure_session_factory
from extensions.ext_database import db
from services.tools.mcp_tools_manage_service import ReconnectResult


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def _mock_cache():
    return


@pytest.fixture
def _mock_user_tenant():
    return


@pytest.fixture
def client():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    api = Api(app)
    api.add_resource(ToolProviderMCPApi, "/console/api/workspaces/current/tool-provider/mcp")
    db.init_app(app)
    # Configure session factory used by controller code
    with app.app_context():
        configure_session_factory(db.engine)
    return app.test_client()


@patch(
    "controllers.console.workspace.tool_providers.current_account_with_tenant", return_value=(MagicMock(id="u1"), "t1")
)
@patch("controllers.console.workspace.tool_providers.Session")
@patch("controllers.console.workspace.tool_providers.MCPToolManageService._reconnect_with_url")
@pytest.mark.usefixtures("_mock_cache", "_mock_user_tenant")
def test_create_mcp_provider_populates_tools(mock_reconnect, mock_session, mock_current_account_with_tenant, client):
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
    mock_session.return_value.__enter__.return_value = MagicMock()
    # Patch MCPToolManageService constructed inside controller
    with patch("controllers.console.workspace.tool_providers.MCPToolManageService", return_value=svc):
        payload = {
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
        # Act
        with (
            patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"),  # bypass setup_required DB check
            patch("controllers.console.wraps.current_account_with_tenant", return_value=(MagicMock(id="u1"), "t1")),
            patch("libs.login.check_csrf_token", return_value=None),  # bypass CSRF in login_required
            patch("libs.login._get_user", return_value=MagicMock(id="u1", is_authenticated=True)),  # login
            patch(
                "services.tools.tools_transform_service.ToolTransformService.mcp_provider_to_user_provider",
                return_value={"id": "provider-1", "tools": [{"name": "ping"}]},
            ),
        ):
            resp = client.post(
                "/console/api/workspaces/current/tool-provider/mcp",
                data=json.dumps(payload),
                content_type="application/json",
            )

    # Assert
    assert resp.status_code == 200
    body = resp.get_json()
    assert body.get("id") == "provider-1"
    # 若 transform 后包含 tools 字段，确保非空
    assert isinstance(body.get("tools"), list)
    assert body["tools"]


class TestUtils:
    def test_is_valid_url(self):
        assert is_valid_url("https://example.com")
        assert is_valid_url("http://example.com")
        assert not is_valid_url("")
        assert not is_valid_url("ftp://example.com")
        assert not is_valid_url("not-a-url")
        assert not is_valid_url(None)


class TestToolProviderListApi:
    def test_get_success(self, app):
        api = ToolProviderListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u1"), "t1"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.ToolCommonService.list_tool_providers",
                return_value=["p1"],
            ),
        ):
            assert method(api) == ["p1"]


class TestBuiltinProviderApis:
    def test_list_tools(self, app):
        api = ToolBuiltinProviderListToolsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(None, "t1"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.list_builtin_tool_provider_tools",
                return_value=[{"a": 1}],
            ),
        ):
            assert method(api, "provider") == [{"a": 1}]

    def test_info(self, app):
        api = ToolBuiltinProviderInfoApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(None, "t1"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_info",
                return_value={"x": 1},
            ),
        ):
            assert method(api, "provider") == {"x": 1}

    def test_delete(self, app):
        api = ToolBuiltinProviderDeleteApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credential_id": "cid"}),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(None, "t1"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.delete_builtin_tool_provider",
                return_value={"result": "success"},
            ),
        ):
            assert method(api, "provider")["result"] == "success"

    def test_add_invalid_type(self, app):
        api = ToolBuiltinProviderAddApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {}, "type": "invalid"}),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "provider")

    def test_add_success(self, app):
        api = ToolBuiltinProviderAddApi()
        method = unwrap(api.post)

        payload = {"credentials": {}, "type": "oauth2", "name": "n"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.add_builtin_tool_provider",
                return_value={"id": 1},
            ),
        ):
            assert method(api, "provider")["id"] == 1

    def test_update(self, app):
        api = ToolBuiltinProviderUpdateApi()
        method = unwrap(api.post)

        payload = {"credential_id": "c1", "credentials": {}, "name": "n"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.update_builtin_tool_provider",
                return_value={"ok": True},
            ),
        ):
            assert method(api, "provider")["ok"]

    def test_get_credentials(self, app):
        api = ToolBuiltinProviderGetCredentialsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(None, "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_credentials",
                return_value={"k": "v"},
            ),
        ):
            assert method(api, "provider") == {"k": "v"}

    def test_icon(self, app):
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

    def test_credentials_schema(self, app):
        api = ToolBuiltinProviderCredentialsSchemaApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.list_builtin_provider_credentials_schema",
                return_value={"schema": {}},
            ),
        ):
            assert method(api, "provider", "oauth2") == {"schema": {}}

    def test_set_default_credential(self, app):
        api = ToolBuiltinProviderSetDefaultApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"id": "c1"}),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.set_default_provider",
                return_value={"ok": True},
            ),
        ):
            assert method(api, "provider")["ok"]

    def test_get_credential_info(self, app):
        api = ToolBuiltinProviderGetCredentialInfoApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_credential_info",
                return_value={"info": "x"},
            ),
        ):
            assert method(api, "provider") == {"info": "x"}

    def test_get_oauth_client_schema(self, app):
        api = ToolBuiltinProviderGetOauthClientSchemaApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_builtin_tool_provider_oauth_client_schema",
                return_value={"schema": {}},
            ),
        ):
            assert method(api, "provider") == {"schema": {}}


class TestApiProviderApis:
    def test_add(self, app):
        api = ToolApiProviderAddApi()
        method = unwrap(api.post)

        payload = {
            "credentials": {},
            "schema_type": "openapi",
            "schema": "{}",
            "provider": "p",
            "icon": {},
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.create_api_tool_provider",
                return_value={"id": 1},
            ),
        ):
            assert method(api)["id"] == 1

    def test_remote_schema(self, app):
        api = ToolApiProviderGetRemoteSchemaApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?url=http://x.com"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.get_api_tool_provider_remote_schema",
                return_value={"schema": "x"},
            ),
        ):
            assert method(api)["schema"] == "x"

    def test_list_tools(self, app):
        api = ToolApiProviderListToolsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?provider=p"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.list_api_tool_provider_tools",
                return_value=[{"tool": 1}],
            ),
        ):
            assert method(api) == [{"tool": 1}]

    def test_update(self, app):
        api = ToolApiProviderUpdateApi()
        method = unwrap(api.post)

        payload = {
            "credentials": {},
            "schema_type": "openapi",
            "schema": "{}",
            "provider": "p",
            "original_provider": "o",
            "icon": {},
            "privacy_policy": "",
            "custom_disclaimer": "",
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.update_api_tool_provider",
                return_value={"ok": True},
            ),
        ):
            assert method(api)["ok"]

    def test_delete(self, app):
        api = ToolApiProviderDeleteApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"provider": "p"}),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.delete_api_tool_provider",
                return_value={"result": "success"},
            ),
        ):
            assert method(api)["result"] == "success"

    def test_get(self, app):
        api = ToolApiProviderGetApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?provider=p"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.get_api_tool_provider",
                return_value={"x": 1},
            ),
        ):
            assert method(api) == {"x": 1}


class TestWorkflowApis:
    def test_create(self, app):
        api = ToolWorkflowProviderCreateApi()
        method = unwrap(api.post)

        payload = {
            "workflow_app_id": "123e4567-e89b-12d3-a456-426614174000",
            "name": "n",
            "label": "l",
            "description": "d",
            "icon": {},
            "parameters": [],
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.WorkflowToolManageService.create_workflow_tool",
                return_value={"id": 1},
            ),
        ):
            assert method(api)["id"] == 1

    def test_update_invalid(self, app):
        api = ToolWorkflowProviderUpdateApi()
        method = unwrap(api.post)

        payload = {
            "workflow_tool_id": "123e4567-e89b-12d3-a456-426614174000",
            "name": "Tool",
            "label": "Tool Label",
            "description": "A tool",
            "icon": {},
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.WorkflowToolManageService.update_workflow_tool",
                return_value={"ok": True},
            ),
        ):
            result = method(api)
            assert result["ok"]

    def test_delete(self, app):
        api = ToolWorkflowProviderDeleteApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"workflow_tool_id": "123e4567-e89b-12d3-a456-426614174000"}),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.WorkflowToolManageService.delete_workflow_tool",
                return_value={"ok": True},
            ),
        ):
            assert method(api)["ok"]

    def test_get_error(self, app):
        api = ToolWorkflowProviderGetApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestLists:
    def test_builtin_list(self, app):
        api = ToolBuiltinListApi()
        method = unwrap(api.get)

        m = MagicMock()
        m.to_dict.return_value = {"x": 1}

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.list_builtin_tools",
                return_value=[m],
            ),
        ):
            assert method(api) == [{"x": 1}]

    def test_api_list(self, app):
        api = ToolApiListApi()
        method = unwrap(api.get)

        m = MagicMock()
        m.to_dict.return_value = {"x": 1}

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(None, "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.ApiToolManageService.list_api_tools",
                return_value=[m],
            ),
        ):
            assert method(api) == [{"x": 1}]

    def test_workflow_list(self, app):
        api = ToolWorkflowListApi()
        method = unwrap(api.get)

        m = MagicMock()
        m.to_dict.return_value = {"x": 1}

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.WorkflowToolManageService.list_tenant_workflow_tools",
                return_value=[m],
            ),
        ):
            assert method(api) == [{"x": 1}]


class TestLabels:
    def test_labels(self, app):
        api = ToolLabelsApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.ToolLabelsService.list_tool_labels",
                return_value=["l1"],
            ),
        ):
            assert method(api) == ["l1"]


class TestOAuth:
    def test_oauth_no_client(self, app):
        api = ToolPluginOAuthApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(id="u"), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_oauth_client",
                return_value=None,
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "provider")

    def test_oauth_callback_no_cookie(self, app):
        api = ToolOAuthCallback()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "provider")


class TestOAuthCustomClient:
    def test_save_custom_client(self, app):
        api = ToolOAuthCustomClient()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"client_params": {"a": 1}}),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.save_custom_oauth_client_params",
                return_value={"ok": True},
            ),
        ):
            assert method(api, "provider")["ok"]

    def test_get_custom_client(self, app):
        api = ToolOAuthCustomClient()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.get_custom_oauth_client_params",
                return_value={"client_id": "x"},
            ),
        ):
            assert method(api, "provider") == {"client_id": "x"}

    def test_delete_custom_client(self, app):
        api = ToolOAuthCustomClient()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.tool_providers.current_account_with_tenant",
                return_value=(MagicMock(), "t"),
            ),
            patch(
                "controllers.console.workspace.tool_providers.BuiltinToolManageService.delete_custom_oauth_client_params",
                return_value={"ok": True},
            ),
        ):
            assert method(api, "provider")["ok"]
