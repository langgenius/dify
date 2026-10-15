"""Own the read Session for the enterprise cross-workspace app reads."""

from collections.abc import Sequence
from datetime import datetime
from typing import override

import sqlalchemy as sa
from sqlalchemy.orm import InstrumentedAttribute, Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from libs.helper import escape_like_pattern
from libs.pagination import PaginatedResult, clamp_pagination
from libs.url_utils import normalize_api_base_url
from models import Account, Tenant
from models.agent import (
    AGENT_APP_VERSION_OPERATIONS,
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.enums import ApiTokenType, AppStatus, AppTriggerType, InvokeFrom, MessageStatus, WorkflowRunTriggeredFrom
from models.model import ApiToken, App, AppMCPServer, AppMode, Message, Site
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from models.workflow import Workflow, WorkflowRun
from services.app.enterprise_app_service import (
    EnterpriseAppApi,
    EnterpriseAppBuiltIn,
    EnterpriseAppBuiltInSummary,
    EnterpriseAppCreator,
    EnterpriseAppDetail,
    EnterpriseAppListItem,
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
_INVOKED_RUN = WorkflowRun.triggered_from.in_(_INVOKED_RUN_SOURCES)
_INVOKED_MESSAGE = Message.invoke_from != InvokeFrom.DEBUGGER

# Outer joins: the workspace and creator columns are None at runtime when the row is missing.
_SummaryRow = tuple[App, str, str, str, str]


def _creator(account_id: str | None, name: str | None, email: str | None) -> EnterpriseAppCreator | None:
    """Build a creator from outer-joined Account columns, which are all None when the row is missing."""
    if account_id is None or name is None or email is None:
        return None
    return EnterpriseAppCreator(id=account_id, name=name, email=email)


def _roster_agent_condition(
    tenant_id: sa.ColumnElement[str] | InstrumentedAttribute[str] | str,
    app_id: sa.ColumnElement[str] | InstrumentedAttribute[str] | str,
) -> sa.ColumnElement[bool]:
    """Match the active roster Agent an Agent App is bound to."""
    return sa.and_(
        Agent.tenant_id == tenant_id,
        Agent.app_id == app_id,
        Agent.scope == AgentScope.ROSTER,
        Agent.status == AgentStatus.ACTIVE,
    )


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
        created_by=_creator(creator_id, creator_name, creator_email),
        created_at=app.created_at,
        updated_at=app.updated_at,
    )


class EnterpriseAppRepository(EnterpriseAppStore):
    def __init__(self, *, session_factory: sessionmaker[Session], app_web_url: str, service_api_url: str) -> None:
        self._session_factory = session_factory
        self._app_base_url = app_web_url.rstrip("/") or None
        self._api_base_url = normalize_api_base_url(service_api_url) if service_api_url else None

    @override
    def list_apps(
        self, params: EnterpriseAppListParams, *, invoked_since: datetime
    ) -> PaginatedResult[EnterpriseAppListItem]:
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
            apps = [row[0] for row in rows]
            published = self._published_app_ids(session, apps)
            invocations = self._invocation_counts(session, apps, invoked_since)
            items = [
                EnterpriseAppListItem(
                    app=_summary(row),
                    built_in=EnterpriseAppBuiltInSummary(
                        published=row[0].id in published, invocation_count=invocations.get(row[0].id, 0)
                    ),
                )
                for row in rows
            ]
        return PaginatedResult(items=items, total=total, page=page, per_page=limit)

    @override
    def get_app(self, app_id: str, *, invoked_since: datetime) -> EnterpriseAppDetail | None:
        with self._session_factory() as session:
            row = session.execute(_summary_query().where(App.id == app_id)).one_or_none()
            if row is None:
                return None
            app = row[0]
            last_invoked_at, invocation_count, failed_invocation_count = self._invocations(session, app, invoked_since)
            published_version, published_version_count = self._published_versions(session, app)
            return EnterpriseAppDetail(
                app=_summary(row),
                built_in=EnterpriseAppBuiltIn(
                    published_version=published_version,
                    published_version_count=published_version_count,
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
    def _published_app_ids(session: Session, apps: Sequence[App]) -> set[str]:
        """Batch form of the published_version check: ids whose detail reports a published version."""
        workflow_app_ids = [app.id for app in apps if app.mode in _WORKFLOW_APP_MODES]
        agent_app_ids = [app.id for app in apps if app.mode == AppMode.AGENT]
        published: set[str] = set()
        if workflow_app_ids:
            published.update(
                session.scalars(
                    sa.select(App.id)
                    .join(Workflow, sa.and_(Workflow.id == App.workflow_id, Workflow.app_id == App.id))
                    .where(App.id.in_(workflow_app_ids))
                )
            )
        if agent_app_ids:
            published.update(
                session.scalars(
                    sa.select(App.id)
                    .join(Agent, _roster_agent_condition(App.tenant_id, App.id))
                    .join(
                        AgentConfigSnapshot,
                        sa.and_(
                            AgentConfigSnapshot.id == Agent.active_config_snapshot_id,
                            AgentConfigSnapshot.agent_id == Agent.id,
                        ),
                    )
                    .where(App.id.in_(agent_app_ids), Agent.active_config_is_published.is_(True))
                )
            )
        return published

    @classmethod
    def _published_versions(cls, session: Session, app: App) -> tuple[EnterpriseAppPublishedVersion | None, int]:
        """Return the served version and the size of the version history Studio shows."""
        if app.mode in _WORKFLOW_APP_MODES:
            return cls._published_workflow(session, app)
        if app.mode == AppMode.AGENT:
            return cls._published_agent_snapshot(session, app)
        return None, 0

    @staticmethod
    def _published_workflow(session: Session, app: App) -> tuple[EnterpriseAppPublishedVersion | None, int]:
        count = (
            session.scalar(
                sa.select(sa.func.count())
                .select_from(Workflow)
                .where(
                    Workflow.tenant_id == app.tenant_id,
                    Workflow.app_id == app.id,
                    Workflow.version != Workflow.VERSION_DRAFT,
                )
            )
            or 0
        )
        if not app.workflow_id:
            return None, count
        row = session.execute(
            sa.select(
                Workflow.id,
                Workflow.version,
                Workflow.version_number,
                Workflow.marked_name,
                Workflow.marked_comment,
                Workflow.created_at,
                Account.id,
                Account.name,
                Account.email,
            )
            .outerjoin(Account, Account.id == Workflow.created_by)
            .where(Workflow.id == app.workflow_id, Workflow.app_id == app.id)
        ).one_or_none()
        if row is None:
            return None, count
        workflow_id, version, version_number, marked_name, marked_comment, created_at, *creator = row
        return (
            EnterpriseAppPublishedVersion(
                id=workflow_id,
                version=version,
                version_number=version_number,
                marked_name=marked_name,
                marked_comment=marked_comment,
                created_by=_creator(*creator),
                published_at=created_at,
            ),
            count,
        )

    @staticmethod
    def _published_agent_snapshot(session: Session, app: App) -> tuple[EnterpriseAppPublishedVersion | None, int]:
        agent = session.execute(
            sa.select(Agent.id, Agent.source, Agent.active_config_snapshot_id, Agent.active_config_is_published)
            .where(_roster_agent_condition(app.tenant_id, app.id))
            .limit(1)
        ).one_or_none()
        if agent is None:
            return None, 0
        agent_id, source, snapshot_id, is_published = agent
        operations = (
            AGENT_APP_VERSION_OPERATIONS | {AgentConfigRevisionOperation.IMPORT_PACKAGE}
            if source == AgentSource.IMPORTED
            else AGENT_APP_VERSION_OPERATIONS
        )
        history = session.scalars(
            sa.select(AgentConfigSnapshot.id)
            .where(
                AgentConfigSnapshot.tenant_id == app.tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id.in_(
                    sa.select(AgentConfigRevision.current_snapshot_id).where(
                        AgentConfigRevision.tenant_id == app.tenant_id,
                        AgentConfigRevision.agent_id == agent_id,
                        AgentConfigRevision.operation.in_(operations),
                    )
                ),
            )
            .order_by(AgentConfigSnapshot.version.asc())
        ).all()
        if not (snapshot_id and is_published):
            return None, len(history)
        snapshot = session.execute(
            sa.select(
                AgentConfigSnapshot.version_note,
                AgentConfigSnapshot.created_at,
                Account.id,
                Account.name,
                Account.email,
            )
            .outerjoin(Account, Account.id == AgentConfigSnapshot.created_by)
            .where(
                AgentConfigSnapshot.tenant_id == app.tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == snapshot_id,
            )
        ).one_or_none()
        if snapshot is None:
            return None, len(history)
        version_note, created_at, *creator = snapshot
        # Restoring an older version re-serves an existing snapshot, so the
        # latest revision pointing at it is when it went live.
        published_at = session.scalar(
            sa.select(sa.func.max(AgentConfigRevision.created_at)).where(
                AgentConfigRevision.tenant_id == app.tenant_id,
                AgentConfigRevision.agent_id == agent_id,
                AgentConfigRevision.current_snapshot_id == snapshot_id,
            )
        )
        # Studio numbers history entries from 1 in snapshot version order.
        version_numbers = {history_id: number for number, history_id in enumerate(history, start=1)}
        return (
            EnterpriseAppPublishedVersion(
                id=snapshot_id,
                version=None,
                version_number=version_numbers.get(snapshot_id),
                marked_name=None,
                marked_comment=version_note,
                created_by=_creator(*creator),
                published_at=published_at or created_at,
            ),
            len(history),
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
            source = sa.and_(WorkflowRun.tenant_id == app.tenant_id, WorkflowRun.app_id == app.id, _INVOKED_RUN)
            created_at = WorkflowRun.created_at
            failed = WorkflowRun.status.in_(_FAILED_RUN_STATUSES)
        else:
            source = sa.and_(Message.app_id == app.id, _INVOKED_MESSAGE)
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

    @staticmethod
    def _invocation_counts(session: Session, apps: Sequence[App], since: datetime) -> dict[str, int]:
        """Batch form of the detail's invocation_count, keyed by app id; apps without invocations are absent."""
        workflow_apps = [app for app in apps if app.mode in _WORKFLOW_APP_MODES]
        message_app_ids = [app.id for app in apps if app.mode not in _WORKFLOW_APP_MODES]
        counts: dict[str, int] = {}
        if workflow_apps:
            counts.update(
                session.execute(
                    sa.select(WorkflowRun.app_id, sa.func.count())
                    .where(
                        WorkflowRun.tenant_id.in_({app.tenant_id for app in workflow_apps}),
                        WorkflowRun.app_id.in_([app.id for app in workflow_apps]),
                        _INVOKED_RUN,
                        WorkflowRun.created_at >= since,
                    )
                    .group_by(WorkflowRun.app_id)
                )
                .tuples()
                .all()
            )
        if message_app_ids:
            counts.update(
                session.execute(
                    sa.select(Message.app_id, sa.func.count())
                    .where(Message.app_id.in_(message_app_ids), _INVOKED_MESSAGE, Message.created_at >= since)
                    .group_by(Message.app_id)
                )
                .tuples()
                .all()
            )
        return counts
