"""SQLite-backed unit tests for MCP app controller database helpers."""

import pytest
from sqlalchemy.orm import Session

from controllers.mcp.mcp import MCPAppApi
from models.enums import AppMCPServerStatus
from models.model import App, AppMCPServer, AppMode, IconType

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"


@pytest.mark.parametrize("sqlite_session", [(App, AppMCPServer)], indirect=True)
def test_get_mcp_server_and_app_returns_persisted_models(sqlite_session: Session) -> None:
    app = App(
        tenant_id=TENANT_ID,
        name="MCP App",
        description="",
        mode=AppMode.ADVANCED_CHAT,
        icon_type=IconType.EMOJI,
        icon="🤖",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
    )
    app.id = APP_ID
    server = AppMCPServer(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        name="Test MCP Server",
        description="Test server",
        server_code="server-1",
        status=AppMCPServerStatus.ACTIVE,
        parameters="{}",
    )
    sqlite_session.add_all([app, server])
    sqlite_session.commit()

    result_server, result_app = MCPAppApi()._get_mcp_server_and_app("server-1", sqlite_session)

    assert result_server is server
    assert result_app is app
