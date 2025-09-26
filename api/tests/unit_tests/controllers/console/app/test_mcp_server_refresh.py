import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.console.app.mcp_server import AppMCPServerRefreshController
from models.account import AccountStatus
from models.model import AppMCPServer


@pytest.fixture(autouse=True)
def configure_decorators(monkeypatch):
    monkeypatch.setattr("libs.login.dify_config.LOGIN_DISABLED", True, raising=False)
    monkeypatch.setattr("controllers.console.wraps.dify_config.EDITION", "CLOUD", raising=False)


@pytest.fixture
def mock_current_user(monkeypatch):
    user = SimpleNamespace(
        is_editor=True,
        status=AccountStatus.ACTIVE,
        current_tenant_id="tenant-id",
        is_authenticated=True,
    )
    from controllers.console.app import mcp_server as mcp_module

    monkeypatch.setattr(mcp_module, "current_user", user, raising=False)
    monkeypatch.setattr("controllers.console.wraps.current_user", user, raising=False)
    return user


@pytest.fixture
def mock_db_session(monkeypatch):
    mock_session = MagicMock()
    mock_db = SimpleNamespace(session=mock_session)
    from controllers.console.app import mcp_server as mcp_module

    monkeypatch.setattr(mcp_module, "db", mock_db, raising=False)
    return mock_session


@pytest.fixture
def flask_app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


class TestAppMCPServerRefreshController:
    def test_refresh_regenerates_server_code(self, flask_app, mock_current_user, mock_db_session, monkeypatch):
        server = MagicMock(spec=AppMCPServer)
        server.server_code = "old"

        server_query = MagicMock()
        server_query.where.return_value = server_query
        server_query.first.return_value = server

        mock_db_session.query.return_value = server_query
        mock_db_session.commit = MagicMock()

        monkeypatch.setattr(
            "models.model.AppMCPServer.generate_server_code", MagicMock(return_value="new"), raising=False
        )

        controller = AppMCPServerRefreshController()
        refresh_handler = inspect.unwrap(AppMCPServerRefreshController.post)

        with flask_app.test_request_context("/apps/{}/server/refresh".format("app"), method="POST"):
            result = refresh_handler(controller, "server-id")

        assert result is server
        assert server.server_code == "new"
        mock_db_session.commit.assert_called_once_with()
        mock_db_session.query.assert_called_once()

    def test_refresh_requires_editor(self, flask_app, mock_current_user, mock_db_session, monkeypatch):
        mock_current_user.is_editor = False

        mock_db_session.query.return_value = MagicMock()
        mock_db_session.commit = MagicMock()

        controller = AppMCPServerRefreshController()
        refresh_handler = inspect.unwrap(AppMCPServerRefreshController.post)

        with flask_app.test_request_context("/apps/{}/server/refresh".format("app"), method="POST"):
            with pytest.raises(NotFound):
                refresh_handler(controller, "server-id")

        mock_db_session.commit.assert_not_called()
