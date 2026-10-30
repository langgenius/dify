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
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import CheckScope, CheckSubject, CheckWorkspaceMember
from controllers.openapi.auth.subjects import AccountSubject
from services.agent.roster_service import AgentRosterService, RosterAgentEntry


def _row(entry: RosterAgentEntry) -> AgentListRow:
    return AgentListRow(
        agent_id=entry.agent_id,
        app_id=entry.app_id,
        name=entry.name,
        description=entry.description,
        role=entry.role,
        published=entry.published,
        updated_at=entry.updated_at.isoformat(),
    )


@openapi_ns.route("/workspaces/<string:workspace_id>/agents")
class AgentListApi(Resource):
    @endpoint(
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
    def get(self, ctx: Context, workspace_id: str, *, query: AgentListQuery):
        accessible_agent_ids = None
        if dify_config.RBAC_ENABLED:
            accessible_agent_ids = resolve_agent_access_filter(ctx.workspace.id, ctx.account.id).accessible_agent_ids

        entries, total = AgentRosterService(ctx.session).list_openapi_roster_agents(
            tenant_id=ctx.workspace.id,
            account_id=ctx.account.id,
            page=query.page,
            limit=query.limit,
            name=query.name,
            published=query.published,
            accessible_agent_ids=accessible_agent_ids,
        )
        return AgentListResponse.build(
            page=query.page, limit=query.limit, total=total, items=[_row(entry) for entry in entries]
        )
