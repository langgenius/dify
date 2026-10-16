"""Cross-workspace app reads for the trusted enterprise admin inner API.

CE exposes the Studio-visible app metadata enterprise joins against by app id,
plus what CE itself owns for each app: its published version, access points,
and invocations.
"""

from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, Protocol

from graphon.enums import WorkflowExecutionStatus
from libs.pagination import PaginatedResult
from models.enums import MessageStatus, WorkflowRunTriggeredFrom
from models.model import AppMode, IconType
from repositories.api_workflow_run_repository import APIWorkflowRunRepository

EnterpriseAppSortBy = Literal["created_at", "name"]
EnterpriseAppSortOrder = Literal["asc", "desc"]

# Window for the invocation counts shown on the admin list and detail pages.
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
class EnterpriseAppListItem:
    """App state cheap enough to read for a whole list page."""

    app: EnterpriseAppSummary
    # True exactly when the detail reports a published_version.
    published: bool
    invocation_count: int


@dataclass(frozen=True, slots=True)
class EnterpriseAppPublishedVersion:
    """The workflow or Agent config version the app currently serves."""

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
class EnterpriseAppRecord:
    """App state the app store reads; invocations come from run and message logs."""

    app: EnterpriseAppSummary
    # None when the app has never been published (workflow and Agent Apps) or
    # has no version concept (legacy chat, completion, and agent-chat Apps).
    # Agent Apps also report None while their draft differs from the active
    # snapshot, matching Studio's published filter.
    published_version: EnterpriseAppPublishedVersion | None
    # Size of the user-facing version history; 0 for Apps without versions.
    published_version_count: int
    # Web App, Service API, and MCP are None when the published workflow has a
    # trigger entry, because such workflows cannot be run through them.
    site: EnterpriseAppSite | None
    api: EnterpriseAppApi | None
    # Also None when no MCP server was ever created for the app.
    mcp_server: EnterpriseAppMCPServer | None
    triggers: Sequence[EnterpriseAppTrigger]


@dataclass(frozen=True, slots=True)
class EnterpriseAppDetail:
    app: EnterpriseAppSummary
    published_version: EnterpriseAppPublishedVersion | None
    published_version_count: int
    site: EnterpriseAppSite | None
    api: EnterpriseAppApi | None
    mcp_server: EnterpriseAppMCPServer | None
    triggers: Sequence[EnterpriseAppTrigger]
    # Debugger runs are excluded from all invocation fields. Unlike the counts,
    # last_invoked_at is not limited to the invocation window.
    last_invoked_at: datetime | None
    invocation_count: int
    failed_invocation_count: int


@dataclass(frozen=True, slots=True)
class EnterpriseAppListEntry:
    app: EnterpriseAppSummary
    # True exactly when the app's record has a published_version.
    published: bool


@dataclass(frozen=True, slots=True)
class EnterpriseAppMessageStats:
    # Messages created at or after the requested time, by status.
    status_counts: Mapping[MessageStatus, int]
    # Creation time of the newest message, with no time limit.
    last_created_at: datetime


class EnterpriseAppStore(Protocol):
    def list_apps(self, params: EnterpriseAppListParams) -> PaginatedResult[EnterpriseAppListEntry]: ...

    def get_app(self, app_id: str) -> EnterpriseAppRecord | None:
        """Return None when the app does not exist or is hidden from Studio."""
        ...

    def get_message_stats_by_app_ids(
        self, app_ids: Sequence[str], *, created_since: datetime
    ) -> dict[str, EnterpriseAppMessageStats]:
        """Summarize non-debugger messages per app; apps without messages are absent."""
        ...


# Workflow and advanced-chat Apps are invoked through workflow runs; every other
# mode through messages.
WORKFLOW_APP_MODES = frozenset({AppMode.WORKFLOW, AppMode.ADVANCED_CHAT})
# Published workflow runs; debugging and RAG pipeline runs are excluded.
INVOKED_RUN_SOURCES = (
    WorkflowRunTriggeredFrom.APP_RUN,
    WorkflowRunTriggeredFrom.WEBHOOK,
    WorkflowRunTriggeredFrom.SCHEDULE,
    WorkflowRunTriggeredFrom.PLUGIN,
)
# Every finished run that is neither succeeded nor stopped by the user.
FAILED_RUN_STATUSES = frozenset({WorkflowExecutionStatus.FAILED, WorkflowExecutionStatus.PARTIAL_SUCCEEDED})
FAILED_MESSAGE_STATUSES = frozenset({MessageStatus.ERROR})


@dataclass(frozen=True, slots=True)
class _Invocations:
    count: int
    failed_count: int
    last_invoked_at: datetime | None


_NO_INVOCATIONS = _Invocations(count=0, failed_count=0, last_invoked_at=None)


def _invocations[StatusT](
    status_counts: Mapping[StatusT, int], failed: Collection[StatusT], last_created_at: datetime
) -> _Invocations:
    return _Invocations(
        count=sum(status_counts.values()),
        failed_count=sum(count for status, count in status_counts.items() if status in failed),
        last_invoked_at=last_created_at,
    )


class EnterpriseAppService:
    """App queries across tenants, consumed by enterprise dashboard.

    Invocation stats are collected from workflow runs and messages.
    """

    def __init__(
        self, *, apps: EnterpriseAppStore, workflow_runs: APIWorkflowRunRepository, now: Callable[[], datetime]
    ) -> None:
        self._apps = apps
        self._workflow_runs = workflow_runs
        self._now = now

    def list_apps(self, params: EnterpriseAppListParams) -> PaginatedResult[EnterpriseAppListItem]:
        page = self._apps.list_apps(params)
        invocations = self._invocations([entry.app for entry in page.items])
        items = [
            EnterpriseAppListItem(
                app=entry.app,
                published=entry.published,
                invocation_count=invocations.get(entry.app.id, _NO_INVOCATIONS).count,
            )
            for entry in page.items
        ]
        return PaginatedResult(items=items, total=page.total, page=page.page, per_page=page.per_page)

    def get_app(self, app_id: str) -> EnterpriseAppDetail | None:
        record = self._apps.get_app(app_id)
        if record is None:
            return None
        invocations = self._invocations([record.app]).get(record.app.id, _NO_INVOCATIONS)
        return EnterpriseAppDetail(
            app=record.app,
            published_version=record.published_version,
            published_version_count=record.published_version_count,
            site=record.site,
            api=record.api,
            mcp_server=record.mcp_server,
            triggers=record.triggers,
            last_invoked_at=invocations.last_invoked_at,
            invocation_count=invocations.count,
            failed_invocation_count=invocations.failed_count,
        )

    def _invocations(self, apps: Sequence[EnterpriseAppSummary]) -> dict[str, _Invocations]:
        """Read invocations: workflow runs for workflow Apps, messages otherwise."""
        since = self._now() - INVOCATION_WINDOW
        workflow_apps = {app.id: app.workspace_id for app in apps if app.mode in WORKFLOW_APP_MODES}
        message_app_ids = [app.id for app in apps if app.mode not in WORKFLOW_APP_MODES]
        result: dict[str, _Invocations] = {}
        if workflow_apps:
            run_stats = self._workflow_runs.get_stats_by_app_ids(workflow_apps, INVOKED_RUN_SOURCES, since)
            result.update(
                {
                    app_id: _invocations(stats.status_counts, FAILED_RUN_STATUSES, stats.last_created_at)
                    for app_id, stats in run_stats.items()
                }
            )
        if message_app_ids:
            message_stats = self._apps.get_message_stats_by_app_ids(message_app_ids, created_since=since)
            result.update(
                {
                    app_id: _invocations(stats.status_counts, FAILED_MESSAGE_STATUSES, stats.last_created_at)
                    for app_id, stats in message_stats.items()
                }
            )
        return result
