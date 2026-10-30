"""GET /openapi/v1/workspaces/<id>/agents: the roster Agents a caller can see, and one Agent in detail."""

from __future__ import annotations

from http import HTTPStatus

from flask_restx import Resource
from werkzeug.exceptions import NotFound

from configs import dify_config
from constants.oauth_bearer import Scope
from controllers.common.agent_access import resolve_agent_access_filter
from controllers.common.fields import Parameters
from controllers.common.rbac import AgentId, RBACCheck, RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._app_response import wants_block
from controllers.openapi._contract import Example, Kind, endpoint, op_of
from controllers.openapi._input_schema import build_input_schema
from controllers.openapi._models import (
    AgentDescribeInfo,
    AgentDescribeResponse,
    AgentListQuery,
    AgentListResponse,
    AgentListRow,
    AppDescribeQuery,
    Hint,
)
from controllers.openapi.agent_run import AgentRunApi, AgentTestApi
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
)
from controllers.openapi.auth.subjects import AccountSubject
from controllers.service_api.app.error import AppUnavailableError
from core.app.app_config.common.parameters_mapping import AppParametersDict
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from services.agent.errors import AgentNotFoundError
from services.agent.roster_service import AgentRosterService, RosterAgentEntry
from services.app_definition_query_service import AppDefinitionNotPublishedError, AppDefinitionUnavailableError


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


def _describe_info(entry: RosterAgentEntry) -> AgentDescribeInfo:
    return AgentDescribeInfo(**_row(entry).model_dump(), service_api_enabled=entry.service_api_enabled)


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


def _published_parameters(app_id: str) -> AppParametersDict | None:
    try:
        return application_services().app_definitions.get_public_parameters(app_id)
    except AppDefinitionNotPublishedError:
        return None
    except AppDefinitionUnavailableError:
        raise AppUnavailableError() from None


@openapi_ns.route("/workspaces/<string:workspace_id>/agents/<string:agent_id>")
class AgentDescribeApi(Resource):
    @endpoint(
        op="describe.agent",
        kind=Kind.OBJECT,
        summary="Describe an Agent: its info and the inputs a run takes",
        examples=(
            Example(title="Describe an Agent", input={"agent_id": "<agent_id>"}),
            Example(title="Only the inputs a run takes", input={"agent_id": "<agent_id>", "fields": "input_schema"}),
        ),
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckAppApiEnabled(),
            CheckWorkspaceMember(),
            CheckScope(Scope.APPS_READ),
            CheckRBACPermission(RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())),
        ),
        query=AppDescribeQuery,
        returns=(HTTPStatus.OK, AgentDescribeResponse, "Agent description"),
    )
    def get(self, ctx: Context, workspace_id: str, agent_id: str, *, query: AppDescribeQuery):
        try:
            entry = AgentRosterService(ctx.session).describe_openapi_roster_agent(
                tenant_id=ctx.workspace.id, app=ctx.app
            )
        except AgentNotFoundError as error:
            raise NotFound("agent not found") from error

        parameters = _published_parameters(ctx.app.id)
        target = {"workspace_id": workspace_id, "agent_id": agent_id}
        response = AgentDescribeResponse()
        if wants_block(query.fields, "info"):
            response.info = _describe_info(entry)
        if parameters is None:
            response.hints = [Hint(summary="Run this Agent's draft", op=op_of(AgentTestApi.post), input=target)]
            return response

        if wants_block(query.fields, "parameters"):
            response.parameters = dump_response(Parameters, parameters)
        if wants_block(query.fields, "input_schema"):
            response.input_schema = build_input_schema(ctx.app.mode, parameters["user_input_form"])
        response.hints = [Hint(summary="Run this Agent", op=op_of(AgentRunApi.post), input=target)]
        return response
