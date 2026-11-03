"""What an agent can add to a workflow or chatflow graph, each with a seed to copy."""

from __future__ import annotations

from http import HTTPStatus

from flask_restx import Resource

from configs import dify_config
from controllers.common.agent_access import resolve_agent_access_filter
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._models import NodeOptionListResponse, NodeOptionQuery, NodeOptionRow
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import WORKSPACE_READ_GUARDS
from extensions.ext_application_services import application_services
from services.agent.roster_service import AgentRosterService
from services.workflow.authoring import FillContext
from services.workflow.authoring.node_options import list_node_options


def _accessible_agent_ids(tenant_id: str, account_id: str) -> list[str] | None:
    """The Agents the account may see, as the console's Agent invite options reads them; None for every Agent."""
    if not dify_config.RBAC_ENABLED:
        return None
    permissions = application_services().rbac.members.permissions(tenant_id, account_id)
    access_filter = resolve_agent_access_filter(tenant_id, account_id, permissions=permissions)
    if access_filter.accessible_agent_ids is None:
        return None
    return sorted(access_filter.accessible_agent_ids)


@openapi_ns.route("/workspaces/<string:workspace_id>/node-options")
class NodeOptionListApi(Resource):
    """Every node an app of ``app_mode`` can add: blocks, tools and roster Agents, sorted by kind then label.

    Each row's ``seed`` is the smallest node data that names the option; copy it into the graph, then fill
    and check the package. For the node's schema, call describe.node_type with its ``type``.
    """

    @endpoint(
        op="get.node_option",
        kind=Kind.LIST,
        summary="Nodes a workflow or chatflow can add here, each with a seed to copy into the graph",
        examples=(
            Example(title="Find time tools for a workflow", input={"app_mode": "workflow", "keyword": "time"}),
            Example(title="Agents a chatflow can call", input={"app_mode": "advanced-chat", "kind": "agent"}),
        ),
        requirements=WORKSPACE_READ_GUARDS,
        query=NodeOptionQuery,
        returns=(HTTPStatus.OK, NodeOptionListResponse, "Node options"),
    )
    def get(self, ctx: Context, workspace_id: str, *, query: NodeOptionQuery):
        tenant_id, account_id = ctx.workspace.id, ctx.account.id
        options = list_node_options(
            ctx=FillContext(tenant_id=tenant_id, account_id=account_id),
            mode=query.app_mode,
            kind=query.kind,
            keyword=query.keyword,
            accessible_agent_ids=_accessible_agent_ids(tenant_id, account_id),
            roster=AgentRosterService(ctx.session),
            language=ctx.account.interface_language,
        )
        return NodeOptionListResponse.page_of([NodeOptionRow.of(option) for option in options], query=query)
