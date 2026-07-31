import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

import pytest
from flask import Flask

from controllers.console import console_ns
from controllers.console.app.mcp_server import (
    AppMCPServerController,
    AppMCPServerRefreshController,
    AppMCPServerResponse,
)
from controllers.console.wraps import RBACPermission, RBACResourceScope


class _ValidatedResponse:
    def __init__(self, payload):
        self._payload = payload

    def model_dump(self, mode="json"):
        return self._payload


class TestAppMCPServerResponse:
    def test_parameters_json_string_parsed(self):
        data = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": '{"key": "value"}',
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == {"key": "value"}

    def test_parameters_invalid_json_returns_original(self):
        data = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": "not-valid-json",
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == "not-valid-json"

    def test_parameters_dict_passthrough(self):
        data = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": {"already": "parsed"},
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == {"already": "parsed"}

    def test_parameters_json_array_parsed(self):
        data = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": '["a", "b"]',
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == ["a", "b"]

    def test_timestamps_normalized(self):
        dt = datetime.datetime(2024, 1, 1, 0, 0, 0, tzinfo=datetime.UTC)
        data = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": {},
            "created_at": dt,
            "updated_at": dt,
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.created_at == int(dt.timestamp())
        assert resp.updated_at == int(dt.timestamp())

    def test_timestamps_none(self):
        data = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": {},
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.created_at is None
        assert resp.updated_at is None


class TestAppMCPServerController:
    def test_get_returns_empty_dict_when_server_missing(self):
        api = AppMCPServerController()
        method = unwrap(api.get)

        with patch("controllers.console.app.mcp_server.db.session.scalar", return_value=None):
            response = method(api, app_model=SimpleNamespace(id="app-1"))

        assert response == {}

    def test_post_returns_201(self):
        api = AppMCPServerController()
        method = unwrap(api.post)
        payload = {"parameters": {"timeout": 30}}
        app = Flask(__name__)
        app.config["TESTING"] = True

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch("controllers.console.app.mcp_server.db.session.add"),
            patch("controllers.console.app.mcp_server.db.session.commit"),
            patch("controllers.console.app.mcp_server.AppMCPServer.generate_server_code", return_value="server-code"),
            patch(
                "controllers.console.app.mcp_server.AppMCPServerResponse.model_validate",
                return_value=_ValidatedResponse({"id": "server-1"}),
            ),
        ):
            response, status_code = method(
                api, "tenant-1", app_model=SimpleNamespace(id="app-1", name="Demo App", description="App description")
            )

        assert response == {"id": "server-1"}
        assert status_code == 201

    def test_put_binds_server_lookup_to_app_ref(self):
        api = AppMCPServerController()
        method = unwrap(api.put)
        payload = {"id": "server-1", "description": "Updated", "parameters": {"timeout": 30}, "status": "active"}
        app = Flask(__name__)
        app.config["TESTING"] = True
        server = SimpleNamespace(
            id="server-1",
            tenant_id="tenant-1",
            app_id="app-1",
            name="Old",
            description="Old",
            parameters="{}",
            status="active",
        )

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch("controllers.console.app.mcp_server.db.session.scalar", return_value=server) as scalar,
            patch("controllers.console.app.mcp_server.db.session.get") as get_mock,
            patch("controllers.console.app.mcp_server.db.session.commit") as commit,
            patch(
                "controllers.console.app.mcp_server.AppMCPServerResponse.model_validate",
                return_value=_ValidatedResponse({"id": "server-1"}),
            ),
        ):
            response = method(
                api,
                app_model=SimpleNamespace(
                    id="app-1", tenant_id="tenant-1", name="Demo App", description="App description"
                ),
            )

        stmt = scalar.call_args.args[0]
        compiled = stmt.compile()
        statement = str(compiled)
        assert "app_mcp_servers.id" in statement
        assert "app_mcp_servers.tenant_id" in statement
        assert "app_mcp_servers.app_id" in statement
        assert payload["id"] in compiled.params.values()
        assert "tenant-1" in compiled.params.values()
        assert "app-1" in compiled.params.values()
        get_mock.assert_not_called()
        commit.assert_called_once()
        assert response == {"id": "server-1"}


class TestAppMCPServerRefreshController:
    def test_post_refreshes_server_bound_to_app_and_tenant(self):
        api = AppMCPServerRefreshController()
        method = unwrap(api.post)
        server = SimpleNamespace(server_code="old-code")

        with (
            patch("controllers.console.app.mcp_server.db.session.scalar", return_value=server) as scalar,
            patch("controllers.console.app.mcp_server.db.session.commit") as commit,
            patch("controllers.console.app.mcp_server.AppMCPServer.generate_server_code", return_value="new-code"),
            patch(
                "controllers.console.app.mcp_server.AppMCPServerResponse.model_validate",
                return_value=_ValidatedResponse({"id": "server-1", "server_code": "new-code"}),
            ),
        ):
            response = method(api, "tenant-1", app_model=SimpleNamespace(id="app-1"))

        stmt = scalar.call_args.args[0]
        compiled = stmt.compile()
        statement = str(compiled)
        assert "app_mcp_servers.tenant_id" in statement
        assert "app_mcp_servers.app_id" in statement
        assert "tenant-1" in compiled.params.values()
        assert "app-1" in compiled.params.values()
        assert server.server_code == "new-code"
        commit.assert_called_once()
        assert response == {"id": "server-1", "server_code": "new-code"}

    def test_route_is_app_scoped_post(self):
        route_map = {
            resource.__name__: urls
            for resource, urls, _route_doc, _kwargs in console_ns.resources
            if resource.__name__ == "AppMCPServerRefreshController"
        }

        assert route_map["AppMCPServerRefreshController"] == ("/apps/<uuid:app_id>/server/refresh",)
        assert hasattr(AppMCPServerRefreshController, "post")
        assert not hasattr(AppMCPServerRefreshController, "get")

    def test_post_requires_app_view_layout_permission(self):
        method = AppMCPServerRefreshController.post
        while "rbac_permission_required" not in method.__code__.co_qualname:
            method = method.__wrapped__

        class PermissionCheckedError(Exception):
            pass

        current_user = SimpleNamespace(id="account-1")
        with (
            patch("controllers.common.wraps.dify_config.RBAC_ENABLED", True),
            patch(
                "controllers.common.wraps.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch(
                "controllers.common.wraps.enforce_rbac_access",
                side_effect=PermissionCheckedError,
            ) as enforce_rbac_access,
            pytest.raises(PermissionCheckedError),
        ):
            method(AppMCPServerRefreshController(), app_id="app-1")

        enforce_rbac_access.assert_called_once_with(
            tenant_id="tenant-1",
            account_id="account-1",
            resource_type=RBACResourceScope.APP,
            scene=RBACPermission.APP_VIEW_LAYOUT,
            resource_required=True,
            path_args={"app_id": "app-1"},
        )
