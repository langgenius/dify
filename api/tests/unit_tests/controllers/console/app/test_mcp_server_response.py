import datetime
from inspect import unwrap
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.console import console_ns
from controllers.console.app.mcp_server import (
    AppMCPServerController,
    AppMCPServerRefreshController,
    AppMCPServerResponse,
    MCPServerCreatePayload,
    MCPServerUpdatePayload,
)
from controllers.console.wraps import RBACPermission, RBACResourceScope
from models import Account
from models.account import AccountStatus
from models.enums import AppMCPServerStatus
from models.model import App, AppMCPServer, AppMode, IconType


def _app(
    *,
    app_id: str = "app-1",
    tenant_id: str = "tenant-1",
    name: str = "Demo App",
    description: str = "App description",
) -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name=name,
        description=description,
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
    )


def _server(
    *,
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    name: str = "Demo App",
    description: str = "Description",
    parameters: str = "{}",
    status: AppMCPServerStatus = AppMCPServerStatus.ACTIVE,
    server_code: str = "server-code",
) -> AppMCPServer:
    return AppMCPServer(
        tenant_id=tenant_id,
        app_id=app_id,
        name=name,
        description=description,
        parameters=parameters,
        status=status,
        server_code=server_code,
    )


class TestAppMCPServerResponse:
    def test_parameters_json_string_parsed(self) -> None:
        data: dict[str, object] = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": '{"key": "value"}',
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == {"key": "value"}

    def test_parameters_invalid_json_returns_original(self) -> None:
        data: dict[str, object] = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": "not-valid-json",
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == "not-valid-json"

    def test_parameters_dict_passthrough(self) -> None:
        data: dict[str, object] = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": {"already": "parsed"},
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == {"already": "parsed"}

    def test_parameters_json_array_parsed(self) -> None:
        data: dict[str, object] = {
            "id": "s1",
            "name": "test",
            "server_code": "code",
            "description": "desc",
            "status": "active",
            "parameters": '["a", "b"]',
        }
        resp = AppMCPServerResponse.model_validate(data)
        assert resp.parameters == ["a", "b"]

    def test_timestamps_normalized(self) -> None:
        dt = datetime.datetime(2024, 1, 1, 0, 0, 0, tzinfo=datetime.UTC)
        data: dict[str, object] = {
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

    def test_timestamps_none(self) -> None:
        data: dict[str, object] = {
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
    def test_get_returns_empty_dict_when_server_missing(self, sqlite_session: Session) -> None:
        api = AppMCPServerController()
        method = unwrap(api.get)

        with patch("controllers.console.app.mcp_server.db.session", sqlite_session):
            response = method(api, app_model=_app())

        assert response == {}

    def test_post_returns_201(self, sqlite_session: Session) -> None:
        api = AppMCPServerController()
        method = unwrap(api.post)
        payload = {"parameters": {"timeout": 30}}
        req_data = MCPServerCreatePayload.model_validate(payload)
        app = Flask(__name__)
        app.config["TESTING"] = True

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.app.mcp_server.db.session", sqlite_session),
            patch("controllers.console.app.mcp_server.AppMCPServer.generate_server_code", return_value="server-code"),
        ):
            response, status_code = method(
                api,
                req_data,
                "tenant-1",
                app_model=_app(),
            )

        server = sqlite_session.scalar(select(AppMCPServer))
        assert server is not None
        assert response["server_code"] == "server-code"
        assert response["parameters"] == {"timeout": 30}
        assert status_code == 201

    def test_put_updates_server_for_app(self, sqlite_session: Session) -> None:
        api = AppMCPServerController()
        method = unwrap(api.put)
        payload = {"id": "server-1", "description": "Updated", "parameters": {"timeout": 30}, "status": "active"}
        req_data = MCPServerUpdatePayload.model_validate(payload)
        app = Flask(__name__)
        app.config["TESTING"] = True
        server = _server(name="Old", description="Old")
        server.id = "server-1"
        sqlite_session.add(server)
        sqlite_session.commit()

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.app.mcp_server.db.session", sqlite_session),
        ):
            response = method(
                api,
                req_data,
                app_model=_app(),
            )

        sqlite_session.expire_all()
        updated_server = sqlite_session.get(AppMCPServer, "server-1")
        assert updated_server is not None
        assert response["id"] == "server-1"
        assert updated_server.description == "Updated"

    @pytest.mark.parametrize(
        ("foreign_tenant_id", "foreign_app_id"),
        [
            ("tenant-2", "app-1"),
            ("tenant-1", "app-2"),
        ],
    )
    def test_put_scopes_server_lookup_to_complete_app_ref(
        self,
        sqlite_session: Session,
        foreign_tenant_id: str,
        foreign_app_id: str,
    ) -> None:
        api = AppMCPServerController()
        method = unwrap(api.put)
        payload = {"id": "server-1", "description": "Updated", "parameters": {"timeout": 30}, "status": "active"}
        req_data = MCPServerUpdatePayload.model_validate(payload)
        app = Flask(__name__)
        app.config["TESTING"] = True
        foreign_server = _server(
            tenant_id=foreign_tenant_id,
            app_id=foreign_app_id,
            name="Other",
            server_code="other-code",
        )
        foreign_server.id = "server-1"
        sqlite_session.add(foreign_server)
        sqlite_session.commit()

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.app.mcp_server.db.session", sqlite_session),
            pytest.raises(NotFound),
        ):
            method(
                api,
                req_data,
                app_model=_app(),
            )

        sqlite_session.expire_all()
        unchanged_server = sqlite_session.get(AppMCPServer, "server-1")
        assert unchanged_server is not None
        assert unchanged_server.description == "Description"


class TestAppMCPServerRefreshController:
    def test_post_refreshes_server_bound_to_app_and_tenant(self, sqlite_session: Session) -> None:
        api = AppMCPServerRefreshController()
        method = unwrap(api.post)
        server = _server(server_code="old-code")
        server.id = "server-1"
        tenant_decoy = _server(tenant_id="tenant-2", server_code="tenant-decoy-code")
        tenant_decoy.id = "server-2"
        app_decoy = _server(app_id="app-2", server_code="app-decoy-code")
        app_decoy.id = "server-3"
        sqlite_session.add_all([server, tenant_decoy, app_decoy])
        sqlite_session.commit()

        with (
            patch("controllers.console.app.mcp_server.db.session", sqlite_session),
            patch("controllers.console.app.mcp_server.AppMCPServer.generate_server_code", return_value="new-code"),
        ):
            response = method(api, "tenant-1", app_model=_app())

        sqlite_session.expire_all()
        refreshed_server = sqlite_session.get(AppMCPServer, "server-1")
        persisted_tenant_decoy = sqlite_session.get(AppMCPServer, "server-2")
        persisted_app_decoy = sqlite_session.get(AppMCPServer, "server-3")
        assert refreshed_server is not None
        assert persisted_tenant_decoy is not None
        assert persisted_app_decoy is not None
        assert refreshed_server.server_code == "new-code"
        assert persisted_tenant_decoy.server_code == "tenant-decoy-code"
        assert persisted_app_decoy.server_code == "app-decoy-code"
        assert response["id"] == "server-1"
        assert response["server_code"] == "new-code"

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

        current_user = Account(name="Current user", email="user@example.com", status=AccountStatus.ACTIVE)
        current_user.id = "account-1"
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
