"""Application boundary for publishing a Console app as an MCP server."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, Protocol

from machinery.context import RequestContext


class AppMCPServerStatus(StrEnum):
    """Publication state of a Dify app exposed as an MCP server; only ACTIVE servers accept MCP calls."""

    # Column server default; like INACTIVE, it does not serve MCP calls.
    NORMAL = "normal"
    ACTIVE = "active"
    INACTIVE = "inactive"


@dataclass(frozen=True, slots=True)
class AppMCPServerRecord:
    id: str
    name: str
    server_code: str
    description: str
    status: AppMCPServerStatus
    parameters: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class PublishedApp:
    """The app fields an MCP server mirrors."""

    name: str
    description: str


@dataclass(frozen=True, slots=True)
class AppMCPServerDraft:
    """Complete field values for creating a server; the store writes them verbatim."""

    name: str
    description: str
    parameters: dict[str, Any]
    status: AppMCPServerStatus


@dataclass(frozen=True, slots=True)
class AppMCPServerUpdate:
    """Server edits; a None status leaves the persisted status untouched."""

    name: str
    description: str
    parameters: dict[str, Any]
    status: AppMCPServerStatus | None


class AppMCPServerStore(Protocol):
    """Persistence for MCP servers, always scoped by workspace and app."""

    def find_app(self, *, workspace_id: str, app_id: str) -> PublishedApp | None:
        """Return the app only when Console may address it (normal status, not a hidden backing app)."""
        ...

    def find_server(self, *, workspace_id: str, app_id: str) -> AppMCPServerRecord | None: ...

    def insert_server(self, *, workspace_id: str, app_id: str, draft: AppMCPServerDraft) -> AppMCPServerRecord:
        """Insert with a fresh server code; raise `AppMCPServerAlreadyExistsError` if the app already has one."""
        ...

    def update_server(
        self, *, workspace_id: str, app_id: str, server_id: str, update: AppMCPServerUpdate
    ) -> AppMCPServerRecord:
        """Apply edits, skipping status when None.

        Raise `AppMCPServerNotFoundError` if the ID is absent from this scope.
        """
        ...

    def rotate_server_code(self, *, workspace_id: str, app_id: str) -> AppMCPServerRecord:
        """Find this app's server and rotate its code atomically; raise `AppMCPServerNotFoundError` if absent."""
        ...


class AppMCPServerError(Exception):
    """Base class for framework-neutral app MCP server failures."""


class AppMCPServerAppNotFoundError(AppMCPServerError):
    def __init__(self) -> None:
        super().__init__("App not found")


class AppMCPServerNotFoundError(AppMCPServerError):
    def __init__(self) -> None:
        super().__init__("MCP server not found")


class AppMCPServerAlreadyExistsError(AppMCPServerError):
    def __init__(self) -> None:
        super().__init__("MCP server already exists for this app")


class AppMCPServerService:
    """Owns the publishing rules: a server mirrors its app's name, inherits the app description
    unless given one, starts ACTIVE, and keeps its status unless a new one is requested."""

    def __init__(self, *, servers: AppMCPServerStore) -> None:
        self._servers = servers

    def get(self, context: RequestContext, app_id: str) -> AppMCPServerRecord | None:
        self._require_app(context.active_workspace_id, app_id)
        return self._servers.find_server(workspace_id=context.active_workspace_id, app_id=app_id)

    def create(
        self, context: RequestContext, app_id: str, *, description: str | None, parameters: dict[str, Any]
    ) -> AppMCPServerRecord:
        workspace_id = context.active_workspace_id
        app = self._require_app(workspace_id, app_id)
        if self._servers.find_server(workspace_id=workspace_id, app_id=app_id) is not None:
            raise AppMCPServerAlreadyExistsError
        draft = AppMCPServerDraft(
            name=app.name,
            description=description or app.description,
            parameters=parameters,
            status=AppMCPServerStatus.ACTIVE,
        )
        return self._servers.insert_server(workspace_id=workspace_id, app_id=app_id, draft=draft)

    def update(
        self,
        context: RequestContext,
        app_id: str,
        *,
        server_id: str,
        description: str | None,
        parameters: dict[str, Any],
        status: AppMCPServerStatus | None,
    ) -> AppMCPServerRecord:
        workspace_id = context.active_workspace_id
        app = self._require_app(workspace_id, app_id)
        update = AppMCPServerUpdate(
            name=app.name, description=description or app.description, parameters=parameters, status=status
        )
        return self._servers.update_server(workspace_id=workspace_id, app_id=app_id, server_id=server_id, update=update)

    def refresh(self, context: RequestContext, app_id: str) -> AppMCPServerRecord:
        workspace_id = context.active_workspace_id
        self._require_app(workspace_id, app_id)
        return self._servers.rotate_server_code(workspace_id=workspace_id, app_id=app_id)

    def _require_app(self, workspace_id: str, app_id: str) -> PublishedApp:
        app = self._servers.find_app(workspace_id=workspace_id, app_id=app_id)
        if app is None:
            raise AppMCPServerAppNotFoundError
        return app
