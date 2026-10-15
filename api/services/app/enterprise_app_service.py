"""Cross-workspace app reads for the trusted enterprise admin inner API.

Enterprise owns non-built-in environments, their deployment status, and their
invocation metrics. CE exposes the Studio-visible app metadata enterprise joins
against, plus everything the built-in environment owns: its published version,
access points, and invocations.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, Protocol

from libs.pagination import PaginatedResult
from models.model import AppMode, IconType

EnterpriseAppSortBy = Literal["created_at", "name"]
EnterpriseAppSortOrder = Literal["asc", "desc"]

# Window for the built-in invocation counts shown on the admin detail page.
INVOCATION_WINDOW = timedelta(hours=24)


@dataclass(frozen=True, slots=True)
class EnterpriseAppListParams:
    page: int
    limit: int
    # Empty sequences mean "no filter" for workspace_ids and modes.
    workspace_ids: Sequence[str]
    modes: Sequence[AppMode]
    name: str | None
    sort_by: EnterpriseAppSortBy
    sort_order: EnterpriseAppSortOrder


@dataclass(frozen=True, slots=True)
class EnterpriseAppCreator:
    id: str
    name: str
    email: str


@dataclass(frozen=True, slots=True)
class EnterpriseAppSummary:
    id: str
    name: str
    description: str
    mode: AppMode
    icon_type: IconType | None
    icon: str | None
    icon_background: str | None
    workspace_id: str
    workspace_name: str | None
    # None when the app has no recorded creator or the account was removed.
    created_by: EnterpriseAppCreator | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class EnterpriseAppBuiltInSummary:
    """Built-in environment state cheap enough to read for a whole list page."""

    # True exactly when the detail reports a published_version.
    published: bool
    invocation_count: int


@dataclass(frozen=True, slots=True)
class EnterpriseAppListItem:
    app: EnterpriseAppSummary
    built_in: EnterpriseAppBuiltInSummary


@dataclass(frozen=True, slots=True)
class EnterpriseAppPublishedVersion:
    """The workflow or Agent config version the built-in environment serves."""

    id: str
    # Workflow version string; None for Agent config snapshots, which have none.
    version: str | None
    # The `#N` Studio shows in version history. None for workflows published
    # before version numbering was introduced, and for Agent snapshots that
    # are not in the user-facing history.
    version_number: int | None
    # Workflow version name; None for Agent snapshots, which have none.
    marked_name: str | None
    # Workflow version comment, or the Agent snapshot's version note.
    marked_comment: str | None
    # None when the publisher was not recorded or the account was removed.
    created_by: EnterpriseAppCreator | None
    published_at: datetime


@dataclass(frozen=True, slots=True)
class EnterpriseAppSite:
    enabled: bool
    # None when the app has no Site record.
    code: str | None
    # None when APP_WEB_URL is not configured; the request host is not used
    # because inner API callers reach CE through an internal address.
    app_base_url: str | None


@dataclass(frozen=True, slots=True)
class EnterpriseAppApi:
    enabled: bool
    # None when SERVICE_API_URL is not configured, for the same reason as Site.
    base_url: str | None
    api_key_count: int


@dataclass(frozen=True, slots=True)
class EnterpriseAppMCPServer:
    # Only "active" servers accept MCP calls.
    status: str
    server_code: str


@dataclass(frozen=True, slots=True)
class EnterpriseAppTrigger:
    id: str
    node_id: str | None
    title: str
    trigger_type: str
    provider_name: str | None
    status: str
    # Set only for webhook triggers.
    webhook_url: str | None


@dataclass(frozen=True, slots=True)
class EnterpriseAppBuiltIn:
    # None when the app has never been published (workflow and Agent Apps) or
    # has no version concept (legacy chat, completion, and agent-chat Apps).
    # Agent Apps also report None while their draft differs from the active
    # snapshot, matching Studio's published filter.
    published_version: EnterpriseAppPublishedVersion | None
    # Size of the user-facing version history; 0 for Apps without versions.
    published_version_count: int
    site: EnterpriseAppSite
    api: EnterpriseAppApi
    # None when no MCP server was ever created for the app.
    mcp_server: EnterpriseAppMCPServer | None
    triggers: Sequence[EnterpriseAppTrigger]
    # Debugger runs are excluded from all invocation fields. Unlike the counts,
    # last_invoked_at is not limited to the invocation window.
    last_invoked_at: datetime | None
    invocation_count: int
    failed_invocation_count: int


@dataclass(frozen=True, slots=True)
class EnterpriseAppDetail:
    app: EnterpriseAppSummary
    built_in: EnterpriseAppBuiltIn


class EnterpriseAppStore(Protocol):
    def list_apps(
        self, params: EnterpriseAppListParams, *, invoked_since: datetime
    ) -> PaginatedResult[EnterpriseAppListItem]: ...

    def get_app(self, app_id: str, *, invoked_since: datetime) -> EnterpriseAppDetail | None:
        """Return None when the app does not exist or is hidden from Studio."""
        ...


class EnterpriseAppService:
    def __init__(self, *, apps: EnterpriseAppStore, now: Callable[[], datetime]) -> None:
        self._apps = apps
        self._now = now

    def list_apps(self, params: EnterpriseAppListParams) -> PaginatedResult[EnterpriseAppListItem]:
        return self._apps.list_apps(params, invoked_since=self._now() - INVOCATION_WINDOW)

    def get_app(self, app_id: str) -> EnterpriseAppDetail | None:
        return self._apps.get_app(app_id, invoked_since=self._now() - INVOCATION_WINDOW)
