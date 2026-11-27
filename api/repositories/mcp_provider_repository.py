"""SQLAlchemy adapter for workspace-scoped external MCP provider deletion."""

from typing import override

from sqlalchemy import CursorResult, delete
from sqlalchemy.orm import Session, sessionmaker

from models.tools import MCPToolProvider
from services.mcp_provider_service import MCPProviderNotFoundError, MCPProviderStore


class MCPProviderRepository(MCPProviderStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        """Bind the session factory without opening a session."""
        self._session_factory = session_factory

    @override
    def delete(self, *, workspace_id: str, provider_id: str) -> None:
        """Commit deletion of a validated ID in this workspace, or raise without changing data."""
        with self._session_factory.begin() as session:
            result = session.execute(
                delete(MCPToolProvider).where(
                    MCPToolProvider.tenant_id == workspace_id,
                    MCPToolProvider.id == provider_id,
                )
            )
            assert isinstance(result, CursorResult)
            if result.rowcount == 0:
                raise MCPProviderNotFoundError
