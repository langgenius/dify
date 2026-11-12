"""Bridge Agent collection queries to the legacy roster and App persistence APIs."""

from dataclasses import replace

from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from repositories.app.response import app_record
from services.agent.roster_service import AgentRosterService
from services.app.agent_app_contracts import AgentAppListItem, AgentAppListPage
from services.app_service import AppService
from services.entities.app_entities import AppListParams


class AgentAppCollectionGateway:
    """Reuse legacy session-bound queries while returning detached Agent App pages.

    The roster reference and Build-conversation helpers are temporary legacy
    transaction participants; they must remain inside the caller-owned session.
    """

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def list_apps(
        self, context: RequestContext, params: AppListParams, *, accessible_agent_ids: set[str] | None
    ) -> AgentAppListPage:
        """Load scoped counts and a page, committing any newly materialized Build conversations."""
        with self._session_factory() as session:
            roster = AgentRosterService(session)
            scoped_params = params.model_copy(deep=True)
            if accessible_agent_ids is not None:
                scoped_params.accessible_app_ids = roster.load_app_ids_for_agents(
                    tenant_id=context.active_workspace_id, agent_ids=sorted(accessible_agent_ids)
                )
            app_service = AppService()
            counts = app_service.get_agent_publication_counts(
                context.account_id, context.active_workspace_id, scoped_params, session
            )
            page = app_service.get_paginate_apps(
                context.account_id, context.active_workspace_id, scoped_params, session
            )
            if page is None:
                return AgentAppListPage(
                    page=params.page, limit=params.limit, total=0, has_more=False, publication_counts=counts, data=[]
                )
            agents = roster.load_app_backing_agents_by_app_id(
                tenant_id=context.active_workspace_id, app_ids=[str(app.id) for app in page.items]
            )
            agent_list = list(agents.values())
            ids = [agent.id for agent in agent_list]
            published = roster.load_active_config_is_published_by_agent_id(
                tenant_id=context.active_workspace_id, agents=agent_list
            )
            references = roster.load_published_references_by_agent_id(
                tenant_id=context.active_workspace_id, agent_ids=ids
            )
            counts_by_agent = roster.load_reference_counts_by_agent_id(
                tenant_id=context.active_workspace_id, agent_ids=ids
            )
            conversations = roster.load_or_create_build_conversation_ids_by_agent_id(
                tenant_id=context.active_workspace_id, agents=agent_list, account_id=context.account_id
            )
            items: list[AgentAppListItem] = []
            for app in page.items:
                agent = agents.get(str(app.id))
                items.append(
                    AgentAppListItem(
                        app=replace(app_record(app, session=session), has_draft_trigger=app.has_draft_trigger),
                        agent_id=agent.id if agent else None,
                        backing_app_id=(agent.backing_app_id or app.id) if agent else None,
                        role=(agent.role or "") if agent else None,
                        debug_conversation_id=conversations.get(agent.id) if agent else None,
                        active_config_is_published=published.get(agent.id, False) if agent else False,
                        reference_count=counts_by_agent.get(agent.id, 0) if agent else None,
                        published_references=references.get(agent.id, []) if agent else [],
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
