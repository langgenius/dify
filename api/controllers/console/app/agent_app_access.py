"""Agent App access & sharing endpoints (read-only workflow references).

An Agent App is backed by a roster Agent that workflow Agent nodes may also
reference. This exposes the read-only "Workflow access" surface from the PRD:
which workflow apps use this Agent, without leaking the workflows' internals.
"""

from uuid import UUID

from flask_restx import Resource
from pydantic import Field

from controllers.common.rbac import AgentId, RBACCheck
from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from services.agent.errors import AgentNotFoundError
from services.app.agent_app_contracts import AgentAppNotFoundError


class AgentReferencingWorkflowResponse(ResponseModel):
    app_id: str
    app_name: str
    app_icon_type: str | None = None
    app_icon: str | None = None
    app_icon_background: str | None = None
    app_mode: str
    app_updated_at: int | None = None
    workflow_id: str
    workflow_version: str
    node_ids: list[str] = Field(default_factory=list)


class AgentReferencingWorkflowsResponse(ResponseModel):
    data: list[AgentReferencingWorkflowResponse] = Field(default_factory=list)


register_response_schema_models(console_ns, AgentReferencingWorkflowsResponse)


@console_ns.route("/agent/<uuid:agent_id>/referencing-workflows")
class AgentAppReferencingWorkflowsResource(Resource):
    @console_ns.doc("list_agent_app_referencing_workflows")
    @console_ns.doc(description="List workflow apps that reference this Agent App's bound Agent (read-only)")
    @console_ns.doc(params={"agent_id": "Agent ID"})
    @console_ns.response(
        200,
        "Referencing workflows listed successfully",
        console_ns.models[AgentReferencingWorkflowsResponse.__name__],
    )
    @console_ns.response(404, "Agent not found")
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId()),))
    def get(self, context: RequestContext, agent_id: UUID):
        try:
            workflows = application_services().agent_apps.access.list_referencing_workflows(context, str(agent_id))
        except AgentAppNotFoundError as exc:
            raise AgentNotFoundError from exc
        return dump_response(AgentReferencingWorkflowsResponse, {"data": workflows})
