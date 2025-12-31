import json
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask_restx import Api

from controllers.console.workspace.tool_providers import ToolProviderMCPApi
from core.db.session_factory import configure_session_factory
from extensions.ext_database import db
from services.tools.mcp_tools_manage_service import ReconnectResult


# Backward-compat fixtures referenced by @pytest.mark.usefixtures in this file.
# They are intentionally no-ops because the test already patches the required
# behaviors explicitly via @patch and context managers below.
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
