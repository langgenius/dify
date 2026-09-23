"""Console app persistence, reusing the established app queries and write operations.

Console operations own short Sessions and materialize response records before
closing them. Shared model queries accept an explicit caller-owned Session for
existing use cases that still need attached models.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from dataclasses import replace
from datetime import datetime
from typing import Any, cast, override

import sqlalchemy as sa
from pydantic import TypeAdapter
from sqlalchemy import ColumnElement, delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from core.trigger.constants import TRIGGER_NODE_TYPES
from libs.datetime_utils import naive_utc_now
from libs.pagination import PaginatedResult, paginate_query
from machinery.context import RequestContext
from models.account import Account, Tenant
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentIconType,
    AgentScope,
    AgentStatus,
    AgentWorkspaceBinding,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.enums import AppStatus
from models.model import App, AppMode, AppModelConfig, AppStar, IconType
from models.skill import AgentSkillBinding
from models.workflow import Workflow
from repositories.app.response import app_record, app_summary
from repositories.tag_repository import TagRepository
from services.agent.errors import (
    AgentAccessNotReadyError,
    AgentNameConflictError,
)
from services.app.console_service import ConsoleAppNotFoundError, ConsoleApps
from services.app.query_service import AppQueryStore
from services.app_creation_records import create_installed_app_record, create_site_record
from services.entities.app_entities import (
    RECENT_APP_MODES,
    AppChange,
    AppCreationSettings,
    AppDeletion,
    AppEvent,
    AppListBaseParams,
    AppListParams,
    AppListSortBy,
    AppPage,
    AppRecord,
    AppReference,
    AppSummary,
    AppTraceSettings,
    AppUpdateArguments,
    CreateAppParams,
    RecentAppListItem,
    RecentAppMode,
    StarredAppListParams,
    UpdateAppParams,
)
from services.errors.account import NoPermissionError
from services.openapi.visibility import apply_openapi_gate, is_openapi_visible

logger = logging.getLogger(__name__)
_app_trace_settings_adapter = TypeAdapter(AppTraceSettings)


def find_console_app(session: Session, *, workspace_id: str, app_id: str) -> App | None:
    """Shared normal-app lookup, including the hidden workflow backing-app gate."""
    app = session.scalar(
        select(App)
        .where(
            App.id == app_id,
            App.tenant_id == workspace_id,
            App.status == AppStatus.NORMAL,
        )
        .limit(1)
    )
    if app is not None:
        binding = app.agent_app_binding_with_session(session=session, include_archived=True)
        if binding is not None and binding.scope == AgentScope.WORKFLOW_ONLY:
            return None
    return app


def require_console_app(session: Session, context: RequestContext, app_id: str) -> App:
    app = find_console_app(session, workspace_id=context.active_workspace_id, app_id=app_id)
    if app is None:
        raise ConsoleAppNotFoundError("App not found")
    return app


def console_app_actor(session: Session, context: RequestContext) -> Account:
    account = session.get(Account, context.account_id)
    tenant = session.get(Tenant, context.active_workspace_id)
    if account is None or tenant is None:
        raise NoPermissionError("Workspace membership not found")
    account.set_current_tenant_with_session(tenant, session=session)
    if account.current_tenant_id != context.active_workspace_id:
        raise NoPermissionError("Workspace membership not found")
    return account


class ConsoleAppRepository(ConsoleApps, AppQueryStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def find_visible_app(self, app_id: str, tenant_id: str) -> AppSummary | None:
        with self._session_factory() as session:
            app = self.get_visible_app_by_id(app_id, session)
            return app_summary(app) if app is not None and app.tenant_id == tenant_id else None

    @override
    def find_visible_apps(self, app_ids: Sequence[str]) -> list[AppSummary]:
        with self._session_factory() as session:
            return [app_summary(app) for app in self.find_visible_apps_by_ids(app_ids, session)]

    @override
    def query_apps(self, user_id: str, tenant_id: str, params: AppListParams) -> PaginatedResult[AppSummary] | None:
        with self._session_factory() as session:
            page = self.get_paginate_apps(user_id, tenant_id, params, session)
            if page is None:
                return None
            return PaginatedResult(
                items=[app_summary(app) for app in page.items],
                total=page.total,
                page=page.page,
                per_page=page.per_page,
            )

    @override
    def related_apps(self, tenant_id: str, app_ids: Sequence[str]) -> list[AppRecord]:
        if not app_ids:
            return []
        with self._session_factory() as session:
            apps = session.scalars(select(App).where(App.tenant_id == tenant_id, App.id.in_(app_ids))).all()
            records = {app.id: app_record(app, session=session) for app in apps}
            return [records[app_id] for app_id in app_ids if app_id in records]

    @override
    def list_apps(self, context: RequestContext, params: AppListParams | StarredAppListParams) -> AppPage:
        with self._session_factory() as session:
            if isinstance(params, StarredAppListParams):
                page = self.get_paginate_starred_apps(
                    context.account_id,
                    context.active_workspace_id,
                    params,
                    session,
                )
            else:
                page = self.get_paginate_apps(
                    context.account_id,
                    context.active_workspace_id,
                    params,
                    session,
                )
            if page is None:
                return AppPage(page=params.page, limit=params.limit, total=0, has_more=False, data=[])
            trigger_app_ids = self._draft_trigger_app_ids(session, context.active_workspace_id, page.items)
            return AppPage(
                page=page.page,
                limit=page.per_page,
                total=page.total,
                has_more=page.has_next,
                data=[
                    replace(
                        app_record(app, session=session),
                        has_draft_trigger=app.id in trigger_app_ids,
                    )
                    for app in page.items
                ],
            )

    @override
    def recent(self, context: RequestContext, params: AppListParams) -> list[RecentAppListItem]:
        with self._session_factory() as session:
            return self.get_recent_apps(context.account_id, context.active_workspace_id, params, session)

    @override
    def get(self, context: RequestContext, app_id: str) -> AppRecord:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
            return app_record(app, session=session, projection="detail-with-site")

    @override
    def update(self, context: RequestContext, app_id: str, params: UpdateAppParams) -> AppRecord:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
            changes: AppUpdateArguments = {
                "name": params.name,
                "description": params.description,
                "icon_type": params.icon_type,
                "icon": params.icon,
                "icon_background": params.icon_background,
                "use_icon_as_answer_icon": params.use_icon_as_answer_icon,
                "max_active_requests": params.max_active_requests,
                "role": params.role,
            }
            app = self.update_app(app, changes, account_id=context.account_id, session=session)
            return app_record(app, session=session, projection="detail-with-site")

    @override
    def rename(self, context: RequestContext, app_id: str, name: str) -> AppRecord:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
            app = self.update_app_name(app, name, account_id=context.account_id, session=session)
            return app_record(app, session=session, projection="detail")

    @override
    def update_icon(
        self, context: RequestContext, app_id: str, *, icon: str, icon_background: str, icon_type: str | None
    ) -> AppRecord:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
            app = self.update_app_icon(
                app,
                icon,
                icon_background,
                icon_type,
                account_id=context.account_id,
                session=session,
            )
            return app_record(app, session=session, projection="detail")

    @override
    def set_site_enabled(self, context: RequestContext, app_id: str, enabled: bool) -> AppChange:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
            changed = app.enable_site != enabled
            app = self.update_app_site_status(app, enabled, account_id=context.account_id, session=session)
            return AppChange(app_record(app, session=session, projection="detail"), changed)

    @override
    def set_api_enabled(self, context: RequestContext, app_id: str, enabled: bool) -> AppChange:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
            changed = app.enable_api != enabled
            app = self.update_app_api_status(app, enabled, account_id=context.account_id, session=session)
            return AppChange(app_record(app, session=session, projection="detail"), changed)

    @override
    def set_starred(self, context: RequestContext, app_id: str, starred: bool) -> None:
        with self._session_factory.begin() as session:
            app = require_console_app(session, context, app_id)
            if starred:
                self.star_app(app=app, account_id=context.account_id, session=session)
            else:
                self.unstar_app(app=app, account_id=context.account_id, session=session)

    @override
    def get_reference(self, context: RequestContext, app_id: str) -> AppReference:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
            return AppReference(
                id=app.id, name=app.name, mode=app.mode, bound_agent_id=app.bound_agent_id_with_session(session=session)
            )

    @override
    def get_trace(self, context: RequestContext, app_id: str) -> AppTraceSettings:
        with self._session_factory() as session:
            app = require_console_app(session, context, app_id)
            return _app_trace_settings_adapter.validate_json(app.tracing) if app.tracing else AppTraceSettings()

    @override
    def set_trace(self, context: RequestContext, app_id: str, settings: AppTraceSettings) -> None:
        with self._session_factory.begin() as session:
            app = require_console_app(session, context, app_id)
            app.tracing = json.dumps({"enabled": settings.enabled, "tracing_provider": settings.tracing_provider})

    @staticmethod
    def _draft_trigger_app_ids(session: Session, workspace_id: str, apps: list[App]) -> set[str]:
        workflow_app_ids = [app.id for app in apps if app.mode in {"workflow", "advanced-chat"}]
        result: set[str] = set()
        if not workflow_app_ids:
            return result
        workflows = session.scalars(
            select(Workflow).where(
                Workflow.version == Workflow.VERSION_DRAFT,
                Workflow.app_id.in_(workflow_app_ids),
                Workflow.tenant_id == workspace_id,
            )
        )
        for workflow in workflows:
            node_id = None
            try:
                for node_id, node_data in workflow.walk_nodes():
                    if node_data.get("type") in TRIGGER_NODE_TYPES:
                        result.add(workflow.app_id)
                        break
            except Exception:
                logger.exception("error while walking nodes, workflow_id=%s, node_id=%s", workflow.id, node_id)
        return result

    @staticmethod
    def _agent_app_exists_filter(tenant_id: str, *, is_published: bool | None = None) -> sa.Exists:
        agent_filters = [
            Agent.tenant_id == tenant_id,
            Agent.app_id == App.id,
            Agent.scope == AgentScope.ROSTER,
            Agent.source.in_(APP_BACKED_AGENT_SOURCES),
            Agent.status == AgentStatus.ACTIVE,
        ]
        if is_published is not None:
            has_published_config = sa.and_(
                Agent.active_config_snapshot_id.is_not(None),
                Agent.active_config_is_published.is_(True),
            )
            agent_filters.append(has_published_config if is_published else sa.not_(has_published_config))

        return sa.exists().where(*agent_filters).correlate(App)

    @staticmethod
    def _build_app_list_filters(
        user_id: str, tenant_id: str, params: AppListBaseParams, session: Session
    ) -> list[sa.ColumnElement[bool]]:
        filters = [App.tenant_id == tenant_id, App.is_universal == False]

        if params.mode == "workflow":
            filters.append(App.mode == AppMode.WORKFLOW)
        elif params.mode == "completion":
            filters.append(App.mode == AppMode.COMPLETION)
        elif params.mode == "chat":
            filters.append(App.mode == AppMode.CHAT)
        elif params.mode == "advanced-chat":
            filters.append(App.mode == AppMode.ADVANCED_CHAT)
        elif params.mode == "agent-chat":
            filters.append(App.mode == AppMode.AGENT_CHAT)
        elif params.mode == "agent":
            filters.append(App.mode == AppMode.AGENT)
            publication_filter = params.agent_is_published if isinstance(params, AppListParams) else None
            filters.append(ConsoleAppRepository._agent_app_exists_filter(tenant_id, is_published=publication_filter))
        elif params.mode == "all":
            filters.append(App.mode != AppMode.AGENT)

        if isinstance(params, AppListParams):
            if params.status:
                filters.append(App.status == params.status)
            # OpenAPI surface visibility gate. Pushed into the query so
            # `pagination.total` reflects only apps the openapi caller can
            # actually reach; post-filtering by enable_api after the page
            # arrives would make `total` page-dependent.
            if params.openapi_visible:
                filters.append(App.enable_api.is_(True))

        if params.is_created_by_me:
            filters.append(App.created_by == user_id)
        elif params.accessible_app_ids is not None:
            accessible_filter: ColumnElement[bool] = App.id.in_(params.accessible_app_ids)
            if params.include_own_apps:
                accessible_filter = sa.or_(App.maintainer == user_id, accessible_filter)
            filters.append(accessible_filter)
        if params.creator_ids:
            filters.append(App.created_by.in_(params.creator_ids))
        if params.name:
            from libs.helper import escape_like_pattern

            name = params.name[:30]
            escaped_name = escape_like_pattern(name)
            filters.append(App.name.ilike(f"%{escaped_name}%", escape="\\"))
        if params.tag_ids and len(params.tag_ids) > 0:
            target_ids = TagRepository.get_target_ids_by_tag_ids(
                "app", tenant_id, params.tag_ids, session, match_all=True
            )
            if target_ids and len(target_ids) > 0:
                filters.append(App.id.in_(target_ids))
            else:
                return []

        return filters

    @staticmethod
    def _build_app_list_order_by(sort_by: AppListSortBy) -> sa.ColumnElement[Any]:
        return {
            "last_modified": App.updated_at.desc(),
            "recently_created": App.created_at.desc(),
            "earliest_created": App.created_at.asc(),
        }[sort_by]

    @staticmethod
    def get_starred_app_ids(
        session: Session,
        *,
        tenant_id: str,
        account_id: str,
        app_ids: Sequence[str],
    ) -> set[str]:
        """Return app IDs starred by this account within the tenant."""
        if not app_ids:
            return set()

        starred_app_ids = session.scalars(
            select(AppStar.app_id).where(
                AppStar.tenant_id == tenant_id,
                AppStar.account_id == account_id,
                AppStar.app_id.in_(list(app_ids)),
            )
        ).all()
        return set(starred_app_ids)

    @staticmethod
    def get_console_app_by_id(app_id: str, workspace_id: str, session: Session) -> App | None:
        return find_console_app(session, workspace_id=workspace_id, app_id=app_id)

    @staticmethod
    def get_visible_app_by_id(
        app_id: str,
        session: Session,
    ) -> App | None:
        app = session.get(App, app_id)
        if not app or app.status != "normal" or not is_openapi_visible(app):
            return None
        return app

    @staticmethod
    def find_visible_apps_by_ids(
        app_ids: Sequence[str],
        session: Session,
    ) -> list[App]:
        if not app_ids:
            return []
        return list(session.execute(apply_openapi_gate(select(App).where(App.id.in_(list(app_ids))))).scalars().all())

    @classmethod
    def get_paginate_apps(
        cls,
        user_id: str,
        tenant_id: str,
        params: AppListParams,
        session: Session,
    ) -> PaginatedResult | None:
        """
        Get app list with pagination, filters, and explicit sort order.
        :param user_id: user id
        :param tenant_id: tenant id
        :param params: query parameters
        :return:
        """
        filters = cls._build_app_list_filters(user_id, tenant_id, params, session)
        if not filters:
            return None

        order_by = cls._build_app_list_order_by(params.sort_by)

        app_models = paginate_query(
            sa.select(App).where(*filters).order_by(order_by),
            page=params.page,
            per_page=params.limit,
            session=session,
        )

        app_ids = [str(app.id) for app in app_models.items]
        starred_app_ids = cls.get_starred_app_ids(
            session=session,
            tenant_id=tenant_id,
            account_id=user_id,
            app_ids=app_ids,
        )
        for app in app_models.items:
            app.is_starred = str(app.id) in starred_app_ids

        return app_models

    @classmethod
    def get_recent_apps(
        cls,
        user_id: str,
        tenant_id: str,
        params: AppListParams,
        session: Session,
    ) -> list[RecentAppListItem]:
        """Return recently modified apps as one lightweight, non-paginated projection."""
        filters = cls._build_app_list_filters(user_id, tenant_id, params, session)
        if not filters:
            return []

        stmt = (
            sa.select(
                App.id,
                App.name,
                App.icon_type,
                App.icon,
                App.icon_background,
                App.mode,
                Account.name.label("author_name"),
                App.updated_at,
                App.maintainer,
            )
            .outerjoin(Account, Account.id == App.created_by)
            .where(*filters, App.mode.in_(RECENT_APP_MODES))
            .order_by(App.updated_at.desc())
            .limit(params.limit)
        )
        rows = session.execute(stmt).all()

        return [
            RecentAppListItem(
                id=str(app_id),
                name=name,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
                mode=cast(RecentAppMode, mode),
                author_name=author_name,
                updated_at=updated_at,
                maintainer=maintainer,
            )
            for (
                app_id,
                name,
                icon_type,
                icon,
                icon_background,
                mode,
                author_name,
                updated_at,
                maintainer,
            ) in rows
        ]

    @classmethod
    def get_paginate_starred_apps(
        cls,
        user_id: str,
        tenant_id: str,
        params: StarredAppListParams,
        session: Session,
    ) -> PaginatedResult | None:
        """
        Get apps starred by the current account with pagination, filters, and explicit sort order.
        """
        filters = cls._build_app_list_filters(user_id, tenant_id, params, session)
        if not filters:
            return None

        order_by = cls._build_app_list_order_by(params.sort_by)
        app_models = paginate_query(
            sa.select(App)
            .join(
                AppStar,
                sa.and_(
                    AppStar.tenant_id == App.tenant_id,
                    AppStar.app_id == App.id,
                    AppStar.account_id == user_id,
                ),
            )
            .where(AppStar.tenant_id == tenant_id, *filters)
            .order_by(order_by),
            page=params.page,
            per_page=params.limit,
            session=session,
        )

        for app in app_models.items:
            app.is_starred = True

        return app_models

    @staticmethod
    def star_app(*, app: App, account_id: str, session: Session) -> None:
        """Create the account's app star if it does not already exist."""
        existing_star = session.scalar(
            select(AppStar)
            .where(
                AppStar.tenant_id == app.tenant_id,
                AppStar.app_id == app.id,
                AppStar.account_id == account_id,
            )
            .limit(1)
        )
        if existing_star:
            return

        session.add(AppStar(tenant_id=app.tenant_id, app_id=app.id, account_id=account_id))

    @staticmethod
    def unstar_app(*, app: App, account_id: str, session: Session) -> None:
        """Remove the account's app star if present."""
        existing_star = session.scalar(
            select(AppStar)
            .where(
                AppStar.tenant_id == app.tenant_id,
                AppStar.app_id == app.id,
                AppStar.account_id == account_id,
            )
            .limit(1)
        )
        if not existing_star:
            return

        session.delete(existing_star)

    @staticmethod
    def insert_app_record(
        tenant_id: str, params: CreateAppParams, account: Account, settings: AppCreationSettings, *, session: Session
    ) -> App:
        """Persist the App aggregate and required records before any external creation hooks."""
        app_mode = AppMode.value_of(params.mode)
        app = App(**settings.app)
        app.name = params.name
        app.description = params.description or ""
        app.mode = app_mode
        app.icon_type = IconType(params.icon_type) if params.icon_type else IconType.EMOJI
        app.icon = params.icon
        app.icon_background = params.icon_background
        app.tenant_id = tenant_id
        app.api_rph = params.api_rph
        app.api_rpm = params.api_rpm
        app.max_active_requests = params.max_active_requests
        app.created_by = account.id
        app.maintainer = account.id
        app.updated_by = account.id

        session.add(app)
        session.flush()

        if settings.model_config:
            app_model_config = AppModelConfig(
                **settings.model_config, app_id=app.id, created_by=account.id, updated_by=account.id
            )
            session.add(app_model_config)
            session.flush()

            app.app_model_config_id = app_model_config.id
        elif app_mode == AppMode.AGENT:
            # An Agent App keeps its model / prompt / tools in the bound Agent
            # Soul, so the app_model_config row carries no model — only the
            # app-level presentation features the PRD requires (conversation
            # opener, follow-up suggestions, citations, moderation, annotation).
            # They default to disabled/empty here and are read by both the
            # webapp /parameters endpoint and the chat pipeline. agent_mode is
            # left unset so App.is_agent stays False (this is the new Agent App
            # type, not a legacy function-call/react agent).
            agent_app_model_config = AppModelConfig(app_id=app.id, created_by=account.id, updated_by=account.id)
            session.add(agent_app_model_config)
            session.flush()

            app.app_model_config_id = agent_app_model_config.id

        create_site_record(app=app, account=account, session=session)
        create_installed_app_record(app=app, session=session)
        return app

    @staticmethod
    def _get_backing_agent(app: App, *, session: Session) -> Agent | None:
        if app.mode != AppMode.AGENT:
            return None
        return session.scalar(
            select(Agent).where(
                Agent.tenant_id == app.tenant_id,
                Agent.app_id == app.id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
        )

    @staticmethod
    def _to_agent_icon_type(icon_type: IconType | str | None) -> AgentIconType | None:
        if icon_type is None:
            return None
        value = icon_type.value if isinstance(icon_type, IconType) else icon_type
        return AgentIconType(value)

    @classmethod
    def _sync_backing_agent_identity(
        cls,
        app: App,
        *,
        name: str | None = None,
        description: str | None = None,
        role: str | None = None,
        icon_type: IconType | str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
        account_id: str | None = None,
        updated_at: datetime | None = None,
        session: Session,
    ) -> None:
        """Keep the Roster identity aligned with its Agent App shell.

        Agent Soul remains versioned through Composer. This helper only mirrors
        user-facing identity fields, including the roster role/persona label,
        so Roster and Agent Console do not drift.

        Role omission is intentional: ``role=None`` preserves the backing
        Agent's current role, while ``role=""`` explicitly clears it.
        """
        agent = cls._get_backing_agent(app, session=session)
        if agent is None:
            return

        if name is not None:
            agent.name = name
        if description is not None:
            agent.description = description
        if role is not None:
            agent.role = role
        if icon_type is not None:
            agent.icon_type = cls._to_agent_icon_type(icon_type)
        if icon is not None:
            agent.icon = icon
        if icon_background is not None:
            agent.icon_background = icon_background
        agent.updated_by = account_id
        if updated_at is not None:
            agent.updated_at = updated_at

    @staticmethod
    def _commit_app_identity_update(app: App, *, session: Session) -> None:
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            if app.mode == AppMode.AGENT:
                raise AgentNameConflictError() from exc
            raise

    @classmethod
    def update_app(cls, app: App, args: AppUpdateArguments, *, account_id: str, session: Session) -> App:
        """
        Update app
        :param app: App instance
        :param args: request args
        :return: App instance
        """
        app.name = args["name"]
        app.description = args["description"]
        icon_type = args.get("icon_type")
        if icon_type is None:
            resolved_icon_type = app.icon_type
        else:
            resolved_icon_type = IconType(icon_type)

        app.icon_type = resolved_icon_type
        app.icon = args["icon"]
        app.icon_background = args["icon_background"]
        app.use_icon_as_answer_icon = args.get("use_icon_as_answer_icon", False)
        app.max_active_requests = args.get("max_active_requests")
        app.updated_by = account_id
        app.updated_at = naive_utc_now()
        cls._sync_backing_agent_identity(
            app,
            name=app.name,
            description=app.description,
            # Omitted role must stay omitted here: None means "preserve current
            # backing-agent role", while an empty string is an explicit clear.
            role=args.get("role"),
            icon_type=app.icon_type,
            icon=app.icon,
            icon_background=app.icon_background,
            account_id=account_id,
            updated_at=app.updated_at,
            session=session,
        )
        cls._commit_app_identity_update(app, session=session)

        return app

    @classmethod
    def update_app_name(cls, app: App, name: str, *, account_id: str, session: Session) -> App:
        """
        Update app name
        :param app: App instance
        :param name: new name
        :return: App instance
        """
        app.name = name
        app.updated_by = account_id
        app.updated_at = naive_utc_now()
        cls._sync_backing_agent_identity(
            app,
            name=app.name,
            account_id=account_id,
            updated_at=app.updated_at,
            session=session,
        )
        cls._commit_app_identity_update(app, session=session)

        return app

    @classmethod
    def update_app_icon(
        cls,
        app: App,
        icon: str,
        icon_background: str,
        icon_type: IconType | str | None = None,
        *,
        account_id: str,
        session: Session,
    ) -> App:
        """
        Update app icon
        :param app: App instance
        :param icon: new icon
        :param icon_background: new icon_background
        :param icon_type: new icon type
        :return: App instance
        """
        app.icon = icon
        app.icon_background = icon_background
        if icon_type is not None:
            app.icon_type = icon_type if isinstance(icon_type, IconType) else IconType(icon_type)
        app.updated_by = account_id
        app.updated_at = naive_utc_now()
        cls._sync_backing_agent_identity(
            app,
            icon_type=app.icon_type,
            icon=app.icon,
            icon_background=app.icon_background,
            account_id=account_id,
            updated_at=app.updated_at,
            session=session,
        )
        session.commit()

        return app

    @staticmethod
    def is_agent_app_access_ready(app: App, *, session: Session) -> bool:
        """Return whether an Agent App has a publish-visible active snapshot."""

        if app.mode != AppMode.AGENT:
            return True
        agent = session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == app.tenant_id,
                Agent.app_id == app.id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
            .limit(1)
        )
        return bool(agent and agent_has_workflow_callable_active_snapshot(session=session, agent=agent))

    @classmethod
    def ensure_agent_app_access_ready(cls, app: App, *, session: Session) -> None:
        if not cls.is_agent_app_access_ready(app, session=session):
            raise AgentAccessNotReadyError()

    @classmethod
    def update_app_site_status(cls, app: App, enable_site: bool, *, account_id: str, session: Session) -> App:
        """
        Update app site status
        :param app: App instance
        :param enable_site: enable site status
        :return: App instance
        """
        if enable_site:
            cls.ensure_agent_app_access_ready(app, session=session)
        if enable_site == app.enable_site:
            return app
        app.enable_site = enable_site
        app.updated_by = account_id
        app.updated_at = naive_utc_now()
        session.commit()

        return app

    @classmethod
    def update_app_api_status(cls, app: App, enable_api: bool, *, account_id: str, session: Session) -> App:
        """
        Update app api status
        :param app: App instance
        :param enable_api: enable api status
        :return: App instance
        """
        if enable_api:
            cls.ensure_agent_app_access_ready(app, session=session)
        if enable_api == app.enable_api:
            return app

        app.enable_api = enable_api
        app.updated_by = account_id
        app.updated_at = naive_utc_now()
        session.commit()

        return app

    @classmethod
    def delete_app_record(cls, app: App, *, account_id: str | None, session: Session) -> AppDeletion:
        """Stage App deletion; the lifecycle adapter retires Agent resources in the same transaction."""
        app_event = AppEvent(app.id, app.tenant_id, str(app.mode))
        backing_agent = cls._get_backing_agent(app, session=session)
        workflow_agent_ids = set(
            session.scalars(
                select(Agent.id).where(
                    Agent.tenant_id == app.tenant_id,
                    Agent.app_id == app.id,
                    Agent.scope == AgentScope.WORKFLOW_ONLY,
                    Agent.status == AgentStatus.ACTIVE,
                )
            ).all()
        )
        if app.mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
            workflow_agent_ids.update(
                agent_id
                for agent_id in session.scalars(
                    select(WorkflowAgentNodeBinding.agent_id).where(
                        WorkflowAgentNodeBinding.tenant_id == app.tenant_id,
                        WorkflowAgentNodeBinding.app_id == app.id,
                        WorkflowAgentNodeBinding.binding_type == WorkflowAgentBindingType.INLINE_AGENT,
                        WorkflowAgentNodeBinding.agent_id.is_not(None),
                    )
                ).all()
                if agent_id
            )
            session.execute(
                delete(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == app.tenant_id,
                    WorkflowAgentNodeBinding.app_id == app.id,
                )
            )
        agent_ids_to_unbind = set(workflow_agent_ids)
        if backing_agent is not None:
            agent_ids_to_unbind.add(backing_agent.id)
        if agent_ids_to_unbind:
            session.execute(
                delete(AgentSkillBinding).where(
                    AgentSkillBinding.tenant_id == app.tenant_id,
                    AgentSkillBinding.agent_id.in_(agent_ids_to_unbind),
                )
            )
        if backing_agent is not None:
            now = naive_utc_now()
            backing_agent.status = AgentStatus.ARCHIVED
            backing_agent.archived_by = account_id
            backing_agent.archived_at = now
            backing_agent.updated_by = account_id
            backing_agent.updated_at = now

        retired_binding_ids: list[str] = []
        retired_snapshot_ids: list[str] = []
        if backing_agent is not None:
            bindings = session.scalars(
                select(AgentWorkspaceBinding).where(
                    AgentWorkspaceBinding.tenant_id == app.tenant_id,
                    AgentWorkspaceBinding.agent_id == backing_agent.id,
                )
            ).all()
            retired_binding_ids = [binding.id for binding in bindings]

        session.delete(app)
        result = AppDeletion(
            app_event,
            workflow_agent_ids,
            [],
            retired_binding_ids,
            retired_snapshot_ids,
            backing_agent.id if backing_agent else None,
        )
        return result
