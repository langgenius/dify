"""Agent App persistence, reusing the roster's canonical app and reference queries."""

from dataclasses import replace
from typing import Any, cast

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from events.app_event import app_model_config_was_updated
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models.agent import AgentConfigDraftType
from models.enums import ApiTokenType, AppStatus
from models.model import ApiToken, App, AppMode, AppModelConfig, AppModelConfigDict
from repositories.agent_roster_queries import load_reference_counts_by_agent_id
from repositories.agent_roster_repository import load_published_references_by_agent_id
from repositories.app.agent_app_queries import (
    get_app_backing_agent,
    get_roster_agent_app,
    load_app_backing_agents_by_app_id,
    load_app_ids_for_agents,
)
from repositories.app.agent_debug_conversations import get_or_create_agent_debug_conversation
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app.response import app_record
from services.agent.errors import AgentNotFoundError
from services.agent.roster_service import AgentRosterService
from services.app.agent_app_contracts import (
    AgentApiAccess,
    AgentApiAccessChange,
    AgentAppAccessNotReadyError,
    AgentAppListItem,
    AgentAppListPage,
    AgentAppNotFoundError,
    AgentReferencingWorkflow,
)
from services.entities.app_entities import AppListParams


class AgentAppRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def list_apps(
        self, context: RequestContext, params: AppListParams, *, accessible_agent_ids: set[str] | None
    ) -> AgentAppListPage:
        """Load an admitted account's Agent App page and commit its Build conversations together.

        A None visibility set leaves the App filters unrestricted by Agent id.
        The editor mapping's unique key prevents concurrent duplicate mappings.
        A write or projection failure rolls back the page's conversation changes.
        """
        tenant_id = context.active_workspace_id
        account_id = context.account_id
        with self._session_factory.begin() as session:
            scoped_params = params
            if accessible_agent_ids is not None:
                app_ids = load_app_ids_for_agents(session, tenant_id=tenant_id, agent_ids=sorted(accessible_agent_ids))
                scoped_params = params.model_copy(update={"accessible_app_ids": app_ids})
            counts = ConsoleAppRepository.get_agent_publication_counts(account_id, tenant_id, scoped_params, session)
            page = ConsoleAppRepository.get_paginate_apps(account_id, tenant_id, scoped_params, session)
            if page is None:
                return AgentAppListPage(
                    page=params.page, limit=params.limit, total=0, has_more=False, publication_counts=counts, data=[]
                )

            agents = load_app_backing_agents_by_app_id(
                session, tenant_id=tenant_id, app_ids=[app.id for app in page.items]
            )
            agent_ids = [agent.id for agent in agents.values()]
            references = load_published_references_by_agent_id(session, tenant_id=tenant_id, agent_ids=agent_ids)
            reference_counts = load_reference_counts_by_agent_id(session, tenant_id=tenant_id, agent_ids=agent_ids)
            items: list[AgentAppListItem] = []
            for app in page.items:
                agent = agents.get(app.id)
                backing_app_id = (agent.backing_app_id or app.id) if agent else None
                conversation_id = (
                    get_or_create_agent_debug_conversation(
                        session,
                        tenant_id=tenant_id,
                        agent_id=agent.id,
                        backing_app_id=backing_app_id,
                        account_id=account_id,
                        draft_type=AgentConfigDraftType.DEBUG_BUILD,
                    )
                    if agent and backing_app_id
                    else None
                )
                items.append(
                    AgentAppListItem(
                        app=replace(app_record(app, session=session), has_draft_trigger=app.has_draft_trigger),
                        agent_id=agent.id if agent else None,
                        backing_app_id=backing_app_id,
                        role=(agent.role or "") if agent else None,
                        debug_conversation_id=conversation_id,
                        active_config_is_published=bool(
                            agent and agent.active_config_snapshot_id and agent.active_config_is_published
                        ),
                        reference_count=reference_counts.get(agent.id, 0) if agent else None,
                        published_references=[
                            AgentReferencingWorkflow(
                                app_id=ref.app_id,
                                app_name=ref.app_name,
                                app_icon_type=ref.app_icon_type,
                                app_icon=ref.app_icon,
                                app_icon_background=ref.app_icon_background,
                                app_mode=ref.app_mode,
                                app_updated_at=ref.app_updated_at,
                                workflow_id=ref.workflow_id,
                                workflow_version=ref.workflow_version,
                                node_ids=list(ref.node_ids),
                            )
                            for ref in (references.get(agent.id, ()) if agent else ())
                        ],
                        permission_keys=[],
                    )
                )
            return AgentAppListPage(
                page=page.page,
                limit=page.per_page,
                total=page.total,
                has_more=page.has_next,
                publication_counts=counts,
                data=items,
            )

    @staticmethod
    def _resolve_api_app(session: Session, *, tenant_id: str, agent_id: str) -> App:
        """Resolve only an active, app-backed roster Agent in the given tenant."""
        app = get_roster_agent_app(session, tenant_id=tenant_id, agent_id=agent_id)
        if app is None:
            raise AgentAppNotFoundError
        return app

    @staticmethod
    def _api_access(session: Session, app: App) -> AgentApiAccess:
        """Materialize access state while the app and publication data are available."""
        agent = get_app_backing_agent(session, tenant_id=app.tenant_id, app_id=app.id)
        ready = bool(agent and agent_has_workflow_callable_active_snapshot(session=session, agent=agent))
        count = session.scalar(
            select(func.count(ApiToken.id)).where(
                or_(ApiToken.tenant_id == app.tenant_id, ApiToken.tenant_id.is_(None)),
                ApiToken.type == ApiTokenType.APP,
                ApiToken.app_id == app.id,
            )
        )
        return AgentApiAccess(
            app_id=app.id,
            access_ready=ready,
            enabled=bool(app.enable_api and ready),
            api_rpm=app.api_rpm or 0,
            api_rph=app.api_rph or 0,
            api_key_count=count or 0,
        )

    def get_api_access(self, *, tenant_id: str, agent_id: str) -> AgentApiAccess:
        """Return detached access state for an active Agent App in the tenant."""
        with self._session_factory() as session:
            app = self._resolve_api_app(session, tenant_id=tenant_id, agent_id=agent_id)
            return self._api_access(session, app)

    def set_api_access(self, *, tenant_id: str, agent_id: str, account_id: str, enabled: bool) -> AgentApiAccessChange:
        """Commit access state in one transaction; an unpublished Agent cannot be enabled."""
        with self._session_factory.begin() as session:
            app = self._resolve_api_app(session, tenant_id=tenant_id, agent_id=agent_id)
            access = self._api_access(session, app)
            if enabled and not access.access_ready:
                raise AgentAppAccessNotReadyError
            changed = app.enable_api != enabled
            if changed:
                app.enable_api = enabled
                app.updated_by = account_id
                app.updated_at = naive_utc_now()
            return AgentApiAccessChange(
                access=replace(access, enabled=bool(enabled and access.access_ready)), changed=changed
            )

    def resolve_roster_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        """Resolve a roster Agent's configuration owner without materializing inline Apps."""
        with self._session_factory() as session:
            return self._resolve_api_app(session, tenant_id=tenant_id, agent_id=agent_id).id

    def resolve_runtime_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        with self._session_factory() as session:
            try:
                return (
                    AgentRosterService(session).get_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id).id
                )
            except AgentNotFoundError as exc:
                raise AgentAppNotFoundError from exc

    def resolve_existing_runtime_app_id(self, *, tenant_id: str, agent_id: str) -> str:
        """Read persisted runtime state without creating a hidden app during a GET."""
        with self._session_factory() as session:
            try:
                return (
                    AgentRosterService(session)
                    .get_existing_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
                    .id
                )
            except AgentNotFoundError as exc:
                raise AgentAppNotFoundError from exc

    def list_referencing_workflows(self, *, tenant_id: str, agent_id: str) -> list[AgentReferencingWorkflow]:
        with self._session_factory() as session:
            roster = AgentRosterService(session)
            try:
                app = roster.get_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
            except AgentNotFoundError as exc:
                raise AgentAppNotFoundError from exc
            return roster.list_workflows_referencing_app_agent(tenant_id=tenant_id, app_id=app.id)

    def update_features(self, *, tenant_id: str, app_id: str, account_id: str, config: dict[str, Any]) -> None:
        """Commit the feature version, app pointer and dataset joins together."""
        with self._session_factory.begin() as session:
            app = session.scalar(
                select(App).where(
                    App.id == app_id,
                    App.tenant_id == tenant_id,
                    App.mode == AppMode.AGENT,
                    App.status == AppStatus.NORMAL,
                )
            )
            if app is None:
                raise AgentAppNotFoundError
            new_config = AppModelConfig(
                app_id=app.id, created_by=account_id, updated_by=account_id
            ).from_model_config_dict(cast(AppModelConfigDict, config))
            session.add(new_config)
            session.flush()
            app.app_model_config_id = new_config.id
            app.updated_by = account_id
            app.updated_at = naive_utc_now()
            app_model_config_was_updated.send(app, app_model_config=new_config, session=session)
