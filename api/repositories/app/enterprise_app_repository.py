"""Own the read Session for the enterprise cross-workspace app reads."""

from collections.abc import Sequence
from datetime import datetime
from typing import override

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from libs.helper import escape_like_pattern
from libs.pagination import PaginatedResult, clamp_pagination
from libs.url_utils import normalize_api_base_url
from models import Account, Tenant
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentConfigRevision,
    AgentConfigSnapshot,
    AgentScope,
    AgentStatus,
)
from models.enums import ApiTokenType, AppStatus, AppTriggerType, InvokeFrom, MessageStatus, WorkflowRunTriggeredFrom
from models.model import ApiToken, App, AppMCPServer, AppMode, Message, Site
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from models.workflow import Workflow, WorkflowRun
from services.app.enterprise_app_service import (
    EnterpriseAppApi,
    EnterpriseAppBuiltIn,
    EnterpriseAppCreator,
    EnterpriseAppDetail,
    EnterpriseAppListParams,
    EnterpriseAppMCPServer,
    EnterpriseAppPublishedVersion,
    EnterpriseAppSite,
    EnterpriseAppStore,
    EnterpriseAppSummary,
    EnterpriseAppTrigger,
)
from services.entities.app_entities import RECENT_APP_MODES

# App modes a Studio user can open from the app list.
ENTERPRISE_APP_LIST_MODES: tuple[AppMode, ...] = (*RECENT_APP_MODES, AppMode.AGENT)
_WORKFLOW_APP_MODES = (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT)
# Published workflow runs; debugging and RAG pipeline runs are excluded.
_INVOKED_RUN_SOURCES = (
    WorkflowRunTriggeredFrom.APP_RUN,
    WorkflowRunTriggeredFrom.WEBHOOK,
    WorkflowRunTriggeredFrom.SCHEDULE,
    WorkflowRunTriggeredFrom.PLUGIN,
)
# Every finished run that is neither succeeded nor stopped by the user.
_FAILED_RUN_STATUSES = (WorkflowExecutionStatus.FAILED, WorkflowExecutionStatus.PARTIAL_SUCCEEDED)

# Outer joins: the workspace and creator columns are None at runtime when the row is missing.
_SummaryRow = tuple[App, str, str, str, str]


def _studio_visible_condition() -> sa.ColumnElement[bool]:
    """Match Studio's app list across all workspaces.

    Agent Apps are listed only while bound to an active roster Agent, which also
    excludes the hidden runtime backing Apps of workflow-only Agents.
    """
    roster_agent = (
        sa.exists()
        .where(
            Agent.tenant_id == App.tenant_id,
            Agent.app_id == App.id,
            Agent.scope == AgentScope.ROSTER,
            Agent.source.in_(APP_BACKED_AGENT_SOURCES),
            Agent.status == AgentStatus.ACTIVE,
        )
        .correlate(App)
    )
    return sa.and_(
        App.is_universal.is_(False),
        App.status == AppStatus.NORMAL,
        App.mode.in_(ENTERPRISE_APP_LIST_MODES),
        sa.or_(App.mode != AppMode.AGENT, roster_agent),
    )


def _summary_query() -> sa.Select[_SummaryRow]:
    return (
        sa.select(App, Tenant.name, Account.id, Account.name, Account.email)
        .outerjoin(Tenant, Tenant.id == App.tenant_id)
        .outerjoin(Account, Account.id == App.created_by)
        .where(_studio_visible_condition())
    )


def _summary(row: sa.Row[_SummaryRow]) -> EnterpriseAppSummary:
    app, workspace_name, creator_id, creator_name, creator_email = row
    return EnterpriseAppSummary(
        id=app.id,
        name=app.name,
        description=app.description,
        mode=app.mode,
        icon_type=app.icon_type,
        icon=app.icon,
        icon_background=app.icon_background,
        workspace_id=app.tenant_id,
        workspace_name=workspace_name,
        created_by=(
            EnterpriseAppCreator(id=creator_id, name=creator_name, email=creator_email)
            if creator_id is not None
            else None
        ),
        created_at=app.created_at,
        updated_at=app.updated_at,
    )


class EnterpriseAppRepository(EnterpriseAppStore):
    def __init__(self, *, session_factory: sessionmaker[Session], app_web_url: str, service_api_url: str) -> None:
        self._session_factory = session_factory
        self._app_base_url = app_web_url.rstrip("/") or None
        self._api_base_url = normalize_api_base_url(service_api_url) if service_api_url else None

    @override
    def list_apps(self, params: EnterpriseAppListParams) -> PaginatedResult[EnterpriseAppSummary]:
        filters = [_studio_visible_condition()]
        if params.workspace_ids:
            filters.append(App.tenant_id.in_(params.workspace_ids))
        if params.modes:
            filters.append(App.mode.in_(params.modes))
        if params.name:
            filters.append(App.name.ilike(f"%{escape_like_pattern(params.name)}%", escape="\\"))

        sort_column = sa.func.lower(App.name) if params.sort_by == "name" else App.created_at
        order_by = sort_column.asc() if params.sort_order == "asc" else sort_column.desc()
        page, limit = clamp_pagination(params.page, params.limit)

        with self._session_factory() as session:
            total = session.scalar(sa.select(sa.func.count()).select_from(App).where(*filters)) or 0
            rows = session.execute(
                _summary_query()
                .where(*filters)
                # App id breaks ties so page boundaries stay stable.
                .order_by(order_by, App.id.asc())
                .offset((page - 1) * limit)
                .limit(limit)
            ).all()
            items = [_summary(row) for row in rows]
        return PaginatedResult(items=items, total=total, page=page, per_page=limit)

    @override
    def get_app(self, app_id: str, *, invoked_since: datetime) -> EnterpriseAppDetail | None:
        with self._session_factory() as session:
            row = session.execute(_summary_query().where(App.id == app_id)).one_or_none()
            if row is None:
                return None
            app = row[0]
            last_invoked_at, invocation_count, failed_invocation_count = self._invocations(session, app, invoked_since)
            return EnterpriseAppDetail(
                app=_summary(row),
                built_in=EnterpriseAppBuiltIn(
                    published_version=self._published_version(session, app),
                    site=EnterpriseAppSite(
                        enabled=app.enable_site,
                        code=session.scalar(sa.select(Site.code).where(Site.app_id == app.id).limit(1)),
                        app_base_url=self._app_base_url,
                    ),
                    api=EnterpriseAppApi(
                        enabled=app.enable_api,
                        base_url=self._api_base_url,
                        api_key_count=session.scalar(
                            sa.select(sa.func.count())
                            .select_from(ApiToken)
                            .where(ApiToken.app_id == app.id, ApiToken.type == ApiTokenType.APP)
                        )
                        or 0,
                    ),
                    mcp_server=self._mcp_server(session, app),
                    triggers=self._triggers(session, app),
                    last_invoked_at=last_invoked_at,
                    invocation_count=invocation_count,
                    failed_invocation_count=failed_invocation_count,
                ),
            )

    @staticmethod
    def _published_version(session: Session, app: App) -> EnterpriseAppPublishedVersion | None:
        if app.mode in _WORKFLOW_APP_MODES:
            if not app.workflow_id:
                return None
            workflow = session.execute(
                sa.select(Workflow.id, Workflow.version_number, Workflow.created_at).where(
                    Workflow.id == app.workflow_id, Workflow.app_id == app.id
                )
            ).one_or_none()
            return EnterpriseAppPublishedVersion(*workflow) if workflow else None

        if app.mode != AppMode.AGENT:
            return None
        snapshot = session.execute(
            sa.select(Agent.id, AgentConfigSnapshot.id, AgentConfigSnapshot.version, AgentConfigSnapshot.created_at)
            .join(AgentConfigSnapshot, AgentConfigSnapshot.id == Agent.active_config_snapshot_id)
            .where(
                Agent.tenant_id == app.tenant_id,
                Agent.app_id == app.id,
                Agent.scope == AgentScope.ROSTER,
                Agent.status == AgentStatus.ACTIVE,
                Agent.active_config_is_published.is_(True),
            )
            .limit(1)
        ).one_or_none()
        if snapshot is None:
            return None
        agent_id, snapshot_id, version, created_at = snapshot
        # Restoring an older version re-serves an existing snapshot, so the
        # latest revision pointing at it is when it went live.
        published_at = session.scalar(
            sa.select(sa.func.max(AgentConfigRevision.created_at)).where(
                AgentConfigRevision.tenant_id == app.tenant_id,
                AgentConfigRevision.agent_id == agent_id,
                AgentConfigRevision.current_snapshot_id == snapshot_id,
            )
        )
        return EnterpriseAppPublishedVersion(
            id=snapshot_id, version_number=version, published_at=published_at or created_at
        )

    @staticmethod
    def _mcp_server(session: Session, app: App) -> EnterpriseAppMCPServer | None:
        server = session.execute(
            sa.select(AppMCPServer.status, AppMCPServer.server_code).where(
                AppMCPServer.tenant_id == app.tenant_id, AppMCPServer.app_id == app.id
            )
        ).one_or_none()
        return EnterpriseAppMCPServer(*server) if server else None

    @staticmethod
    def _triggers(session: Session, app: App) -> Sequence[EnterpriseAppTrigger]:
        if app.mode != AppMode.WORKFLOW:
            return []
        # Keyed loosely to match the nullable AppTrigger.node_id lookups below.
        webhooks: dict[str | None, str] = {
            webhook.node_id: webhook.webhook_url
            for webhook in session.scalars(
                sa.select(WorkflowWebhookTrigger).where(
                    WorkflowWebhookTrigger.tenant_id == app.tenant_id, WorkflowWebhookTrigger.app_id == app.id
                )
            )
        }
        triggers = session.scalars(
            sa.select(AppTrigger)
            .where(AppTrigger.tenant_id == app.tenant_id, AppTrigger.app_id == app.id)
            .order_by(AppTrigger.created_at.desc(), AppTrigger.id.desc())
        )
        return [
            EnterpriseAppTrigger(
                id=trigger.id,
                node_id=trigger.node_id,
                title=trigger.title,
                trigger_type=trigger.trigger_type,
                provider_name=trigger.provider_name,
                status=trigger.status,
                webhook_url=(
                    webhooks.get(trigger.node_id) if trigger.trigger_type == AppTriggerType.TRIGGER_WEBHOOK else None
                ),
            )
            for trigger in triggers
        ]

    @staticmethod
    def _invocations(session: Session, app: App, since: datetime) -> tuple[datetime | None, int, int]:
        """Read built-in invocations: workflow runs for workflow Apps, messages otherwise."""
        if app.mode in _WORKFLOW_APP_MODES:
            source = sa.and_(
                WorkflowRun.tenant_id == app.tenant_id,
                WorkflowRun.app_id == app.id,
                WorkflowRun.triggered_from.in_(_INVOKED_RUN_SOURCES),
            )
            created_at = WorkflowRun.created_at
            failed = WorkflowRun.status.in_(_FAILED_RUN_STATUSES)
        else:
            source = sa.and_(Message.app_id == app.id, Message.invoke_from != InvokeFrom.DEBUGGER)
            created_at = Message.created_at
            failed = Message.status == MessageStatus.ERROR

        last_invoked_at = session.scalar(sa.select(sa.func.max(created_at)).where(source))
        # SUM(CASE) instead of COUNT FILTER, which MySQL does not support.
        total, failed_total = session.execute(
            sa.select(sa.func.count(), sa.func.coalesce(sa.func.sum(sa.case((failed, 1), else_=0)), 0)).where(
                source, created_at >= since
            )
        ).one()
        return last_invoked_at, int(total), int(failed_total)
