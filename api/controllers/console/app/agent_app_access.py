"""Agent App access & sharing endpoints (read-only workflow references).

An Agent App is backed by a roster Agent that workflow Agent nodes may also
reference. This exposes the read-only "Workflow access" surface from the PRD:
which workflow apps use this Agent, without leaking the workflows' internals.
"""

from uuid import UUID

from flask_restx import Resource
from pydantic import Field
from sqlalchemy.orm import Session

from controllers.common.schema import register_response_schema_models
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.agent.app_helpers import resolve_agent_app_model
from controllers.console.wraps import account_initialization_required, setup_required, with_current_tenant_id
from fields.base import ResponseModel
from libs.login import login_required
from services.agent.roster_service import AgentRosterService


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
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    @with_session(write=False)
    def get(self, session: Session, tenant_id: str, agent_id: UUID):
        app_model = resolve_agent_app_model(session=session, tenant_id=tenant_id, agent_id=agent_id)
        workflows = AgentRosterService(session).list_workflows_referencing_app_agent(
            tenant_id=tenant_id, app_id=app_model.id
        )
        return AgentReferencingWorkflowsResponse(
            data=[AgentReferencingWorkflowResponse.model_validate(workflow) for workflow in workflows]
        ).model_dump(mode="json")
