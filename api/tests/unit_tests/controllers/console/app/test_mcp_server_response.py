import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.console import console_ns
from controllers.console.app.mcp_server import AppMCPServerController, AppMCPServerResponse
from models.enums import AppMCPServerStatus
from models.model import AppMCPServer


def _server(**overrides: object) -> AppMCPServer:
    values = {
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "name": "Demo App",
        "description": "Description",
        "parameters": "{}",
        "status": AppMCPServerStatus.ACTIVE,
        "server_code": "server-code",
    }
    values.update(overrides)
    return AppMCPServer(**values)


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
    @pytest.mark.parametrize("sqlite_session", [(AppMCPServer,)], indirect=True)
    def test_get_returns_empty_dict_when_server_missing(self, sqlite_session: Session):
        api = AppMCPServerController()
        method = unwrap(api.get)

        with patch("controllers.console.app.mcp_server.db.session", sqlite_session):
            response = method(api, app_model=SimpleNamespace(id="app-1"))

        assert response == {}

    @pytest.mark.parametrize("sqlite_session", [(AppMCPServer,)], indirect=True)
    def test_post_returns_201(self, sqlite_session: Session):
        api = AppMCPServerController()
        method = unwrap(api.post)
        payload = {"parameters": {"timeout": 30}}
        app = Flask(__name__)
        app.config["TESTING"] = True

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch("controllers.console.app.mcp_server.db.session", sqlite_session),
            patch("controllers.console.app.mcp_server.AppMCPServer.generate_server_code", return_value="server-code"),
        ):
            response, status_code = method(
                api, "tenant-1", app_model=SimpleNamespace(id="app-1", name="Demo App", description="App description")
            )

        server = sqlite_session.scalar(select(AppMCPServer))
        assert server is not None
        assert response["server_code"] == "server-code"
        assert response["parameters"] == {"timeout": 30}
        assert status_code == 201

    @pytest.mark.parametrize("sqlite_session", [(AppMCPServer,)], indirect=True)
    def test_put_binds_server_lookup_to_app_ref(self, sqlite_session: Session):
        api = AppMCPServerController()
        method = unwrap(api.put)
        payload = {"id": "server-1", "description": "Updated", "parameters": {"timeout": 30}, "status": "active"}
        app = Flask(__name__)
        app.config["TESTING"] = True
        server = _server(name="Old", description="Old")
        server.id = "server-1"
        other_server = _server(tenant_id="tenant-2", app_id="app-2", name="Other", server_code="other-code")
        other_server.id = "server-2"
        sqlite_session.add_all([server, other_server])
        sqlite_session.commit()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch("controllers.console.app.mcp_server.db.session", sqlite_session),
        ):
            response = method(
                api,
                app_model=SimpleNamespace(
                    id="app-1", tenant_id="tenant-1", name="Demo App", description="App description"
                ),
            )

        sqlite_session.expire_all()
        assert response["id"] == "server-1"
        assert sqlite_session.get(AppMCPServer, "server-1").description == "Updated"
        assert sqlite_session.get(AppMCPServer, "server-2").description == "Description"
