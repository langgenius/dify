"""Regression coverage for the ``db.session``→session-parameter refactor on
``AppMCPServer.generate_server_code``.

The static method reached for the global ``db.session`` internally and has been converted to
take an explicit ``session: Session`` (per the pattern established in #40370/#40797/#41394,
tracked in #40372).
"""

from unittest.mock import patch
from uuid import uuid4

from sqlalchemy.orm import Session

from models.enums import AppMCPServerStatus
from models.model import AppMCPServer


def _persist_server(session: Session, *, server_code: str) -> AppMCPServer:
    server = AppMCPServer(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        name="Test MCP Server",
        description="Test server",
        server_code=server_code,
        status=AppMCPServerStatus.ACTIVE,
        parameters="{}",
    )
    session.add(server)
    session.flush()
    return server


def test_generate_server_code_retries_a_taken_code_through_the_given_session(sqlite_session: Session) -> None:
    _persist_server(sqlite_session, server_code="taken-code")

    with patch("models.model.generate_string", side_effect=["taken-code", "fresh-code"]):
        result = AppMCPServer.generate_server_code(16, session=sqlite_session)

    assert result == "fresh-code"
