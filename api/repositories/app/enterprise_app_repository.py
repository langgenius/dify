"""Own the read Session for the enterprise cross-workspace app reads.

Workflow runs are read through ``APIWorkflowRunRepository`` by the service,
because deployments may keep them outside the database. The reads here that
belong to other domains (workflows, Agents, sites, API tokens, MCP servers,
triggers, messages) query those tables directly until each domain owns a
repository that can serve them.
"""

from collections.abc import Sequence
from datetime import datetime
from typing import override

import sqlalchemy as sa
from sqlalchemy.orm import InstrumentedAttribute, Session, sessionmaker

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
from models.enums import ApiTokenType, AppStatus, AppTriggerType, InvokeFrom, MessageStatus
from models.model import ApiToken, App, AppMCPServer, AppMode, Message, Site
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from models.workflow import Workflow
from services.app.enterprise_app_service import (
    WORKFLOW_APP_MODES,
    EnterpriseAppApi,
    EnterpriseAppCreator,
    EnterpriseAppListEntry,
    EnterpriseAppListParams,
    EnterpriseAppMCPServer,
    EnterpriseAppMessageStats,
    EnterpriseAppPublishedVersion,
    EnterpriseAppRecord,
    EnterpriseAppSite,
    EnterpriseAppStore,
    EnterpriseAppSummary,
    EnterpriseAppTrigger,
)
from services.entities.app_entities import RECENT_APP_MODES

# App modes a Studio user can open from the app list.
ENTERPRISE_APP_LIST_MODES: tuple[AppMode, ...] = (*RECENT_APP_MODES, AppMode.AGENT)
_NON_DEBUGGER_MESSAGE = Message.invoke_from != InvokeFrom.DEBUGGER

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
    # TODO: read workspace names and creators through the workspace and account
    # domain repositories once they can serve batch lookups.
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
    def list_apps(self, params: EnterpriseAppListParams) -> PaginatedResult[EnterpriseAppListEntry]:
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
            published = self._published_app_ids(session, [row[0] for row in rows])
            items = [EnterpriseAppListEntry(app=_summary(row), published=row[0].id in published) for row in rows]
        return PaginatedResult(items=items, total=total, page=page, per_page=limit)

    @override
    def get_app(self, app_id: str) -> EnterpriseAppRecord | None:
        with self._session_factory() as session:
            row = session.execute(_summary_query().where(App.id == app_id)).one_or_none()
            if row is None:
                return None
            app = row[0]
            published_version, published_version_count = self._published_versions(session, app)
            manual_entry = not self._published_trigger_entry(session, app)
            return EnterpriseAppRecord(
                app=_summary(row),
                published_version=published_version,
                published_version_count=published_version_count,
                site=EnterpriseAppSite(
                    enabled=app.enable_site,
                    code=self._site_code(session, app),
                    app_base_url=self._app_base_url,
                )
                if manual_entry
                else None,
                api=EnterpriseAppApi(
                    enabled=app.enable_api,
                    base_url=self._api_base_url,
                    api_key_count=self._api_key_count(session, app),
                )
                if manual_entry
                else None,
                mcp_server=self._mcp_server(session, app) if manual_entry else None,
                triggers=self._triggers(session, app),
            )

    @override
    def get_message_stats_by_app_ids(
        self, app_ids: Sequence[str], *, created_since: datetime
    ) -> dict[str, EnterpriseAppMessageStats]:
        # TODO: move to the message domain repository once it exists.
        if not app_ids:
            return {}
        # SUM(CASE) instead of COUNT FILTER, which MySQL does not support.
        in_window = sa.func.sum(sa.case((Message.created_at >= created_since, 1), else_=0))
        status_counts: dict[str, dict[MessageStatus, int]] = {}
        last_created_at: dict[str, datetime] = {}
        with self._session_factory() as session:
            rows = session.execute(
                sa.select(Message.app_id, Message.status, in_window, sa.func.max(Message.created_at))
                .where(Message.app_id.in_(app_ids), _NON_DEBUGGER_MESSAGE)
                .group_by(Message.app_id, Message.status)
            )
            for app_id, status, count, created_at in rows:
                if count:
                    status_counts.setdefault(app_id, {})[MessageStatus(status)] = int(count)
                last_created_at[app_id] = max(created_at, last_created_at.get(app_id, created_at))
        return {
            app_id: EnterpriseAppMessageStats(status_counts=status_counts.get(app_id, {}), last_created_at=created_at)
            for app_id, created_at in last_created_at.items()
        }

    @staticmethod
    def _published_trigger_entry(session: Session, app: App) -> bool:
        """Whether the published workflow starts from a trigger, matching AppGenerateService's run check."""
        # TODO: move to the workflow domain repository once it exists.
        if app.mode != AppMode.WORKFLOW or not app.workflow_id:
            return False
        workflow = session.scalar(sa.select(Workflow).where(Workflow.id == app.workflow_id, Workflow.app_id == app.id))
        return workflow is not None and workflow.has_trigger_node()

    @staticmethod
    def _site_code(session: Session, app: App) -> str | None:
        # TODO: move to the site domain repository once it has a read side.
        return session.scalar(sa.select(Site.code).where(Site.app_id == app.id).limit(1))

    @staticmethod
    def _api_key_count(session: Session, app: App) -> int:
        # TODO: move to AppApiKeyRepository once it can count keys without loading the tokens.
        return (
            session.scalar(
                sa.select(sa.func.count())
                .select_from(ApiToken)
                .where(ApiToken.app_id == app.id, ApiToken.type == ApiTokenType.APP)
            )
            or 0
        )

    @staticmethod
    def _published_app_ids(session: Session, apps: Sequence[App]) -> set[str]:
        """Batch form of the published_version check: ids whose detail reports a published version."""
        # TODO: move to the workflow and Agent domain repositories once they exist.
        workflow_app_ids = [app.id for app in apps if app.mode in WORKFLOW_APP_MODES]
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
        if app.mode in WORKFLOW_APP_MODES:
            return cls._published_workflow(session, app)
        if app.mode == AppMode.AGENT:
            return cls._published_agent_snapshot(session, app)
        return None, 0

    @staticmethod
    def _published_workflow(session: Session, app: App) -> tuple[EnterpriseAppPublishedVersion | None, int]:
        # TODO: move to the workflow domain repository once it exists.
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
        # TODO: move to the Agent domain repository once it exists.
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
        # TODO: read through AppMCPServerRepository.find_server, which already returns status and server_code.
        server = session.execute(
            sa.select(AppMCPServer.status, AppMCPServer.server_code).where(
                AppMCPServer.tenant_id == app.tenant_id, AppMCPServer.app_id == app.id
            )
        ).one_or_none()
        return EnterpriseAppMCPServer(*server) if server else None

    @staticmethod
    def _triggers(session: Session, app: App) -> Sequence[EnterpriseAppTrigger]:
        # TODO: move to the trigger domain repository once it exists.
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
