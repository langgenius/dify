"""Application boundary for deleting external MCP providers within the caller's workspace."""

from typing import Protocol

from machinery.context import RequestContext


class MCPProviderError(Exception):
    """Base class for external MCP provider application failures."""


class MCPProviderNotFoundError(MCPProviderError):
    def __init__(self) -> None:
        """Represent an absent or foreign provider without revealing its ownership."""
        super().__init__("MCP tool not found")


class MCPProviderStore(Protocol):
    def delete(self, *, workspace_id: str, provider_id: str) -> None:
        """Delete a validated provider ID only within the supplied workspace.

        Commit one transaction on success. A conditional delete enforces ownership;
        zero affected rows raises MCPProviderNotFoundError without changing data.
        Database failures propagate and roll back the transaction.
        """
        ...


class MCPProviderService:
    def __init__(self, *, providers: MCPProviderStore) -> None:
        """Bind the persistence port without performing I/O."""
        self._providers = providers

    def delete(self, context: RequestContext, provider_id: str) -> None:
        """Delete a validated provider ID for a caller admitted with MCP management permission.

        Success means the deletion committed. Missing or foreign providers raise
        MCPProviderNotFoundError; other workspaces are never modified.
        """
        self._providers.delete(workspace_id=context.active_workspace_id, provider_id=provider_id)
