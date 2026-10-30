"""GET /openapi/v1/workspaces/<id>/agents: the roster Agents a caller can see."""

from __future__ import annotations

from http import HTTPStatus

from flask_restx import Resource

from configs import dify_config
from constants.oauth_bearer import Scope
from controllers.common.agent_access import resolve_agent_access_filter
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._models import AgentListQuery, AgentListResponse, AgentListRow
from controllers.openapi.auth.requirements import CheckScope, CheckSubject, CheckWorkspaceMember
from controllers.openapi.auth.subjects import AccountSubject
from core.db.session_factory import session_factory
from machinery.context import RequestContext
from services.agent.roster_service import AgentRosterService


@openapi_ns.route("/workspaces/<string:workspace_id>/agents")
class AgentListApi(Resource):
    @endpoint(
        context="workspace",
        op="get.agent",
        kind=Kind.LIST,
        summary="List the Agents you can see in a workspace",
        examples=(Example(title="Find Agents by name", input={"name": "support"}),),
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckScope(Scope.APPS_READ),
            CheckWorkspaceMember(),
        ),
        query=AgentListQuery,
        returns=(HTTPStatus.OK, AgentListResponse, "Agent list"),
    )
    def get(self, ctx: RequestContext, workspace_id: str, *, query: AgentListQuery):
        accessible_agent_ids = None
        if dify_config.RBAC_ENABLED:
            accessible_agent_ids = resolve_agent_access_filter(
                ctx.active_workspace_id, ctx.account_id
            ).accessible_agent_ids

        with session_factory.create_session() as session:
            entries, total = AgentRosterService(session).list_openapi_roster_agents(
                tenant_id=ctx.active_workspace_id,
                account_id=ctx.account_id,
                page=query.page,
                limit=query.limit,
                name=query.name,
                published=query.published,
                accessible_agent_ids=accessible_agent_ids,
            )
        return AgentListResponse.build(
            page=query.page,
            limit=query.limit,
            total=total,
            items=[AgentListRow.model_validate(entry._asdict()) for entry in entries],
        )
