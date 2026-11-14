"""Scoped reads and conditional writes protect refreshed MCP grants from management races."""

import pytest
from sqlalchemy import update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from models.tools import MCPToolProvider
from repositories.credentials.query_repository import CredentialQueryRepository


@pytest.mark.parametrize("sqlite_session", [(MCPToolProvider,)], indirect=True)
@pytest.mark.parametrize(
    "changed", ["server_url", "encrypted_headers", "identity_mode", "encrypted_credentials", "authed"]
)
def test_mcp_cas_rejects_management_race(sqlite_engine: Engine, sqlite_session: Session, changed: str) -> None:
    row = MCPToolProvider(
        name="MCP",
        server_identifier="server",
        server_url="encrypted-url",
        server_url_hash="hash",
        icon="",
        tenant_id="tenant",
        user_id="user",
        encrypted_credentials='{"access_token":"old"}',
        authed=True,
    )
    sqlite_session.add(row)
    sqlite_session.commit()
    repository = CredentialQueryRepository(session_factory=sessionmaker(sqlite_engine))
    assert repository.get_mcp_credential(workspace_id="other", provider="server", credential_id=row.id) is None
    assert repository.get_mcp_credential(workspace_id="tenant", provider="other", credential_id=row.id) is None
    record = repository.get_mcp_credential(workspace_id="tenant", provider="server", credential_id=row.id)
    assert record is not None
    replacement = {"authed": False} if changed == "authed" else {changed: "replacement"}
    if changed == "identity_mode":
        replacement = {"identity_mode": "idp_token"}
    with Session(sqlite_engine) as session:
        session.execute(update(MCPToolProvider).where(MCPToolProvider.id == row.id).values(**replacement))
        session.commit()
    assert not repository.update_mcp_credential_if_unchanged(record=record, encrypted_credentials="stale", authed=True)
    fresh = repository.get_mcp_credential(workspace_id="tenant", provider="server", credential_id=row.id)
    assert fresh is not None
    assert repository.update_mcp_credential_if_unchanged(record=fresh, encrypted_credentials="new", authed=True)
