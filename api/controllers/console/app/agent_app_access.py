"""Agent App access & sharing endpoints (read-only workflow references).

An Agent App is backed by a roster Agent that workflow Agent nodes may also
reference. This exposes the read-only "Workflow access" surface from the PRD:
which workflow apps use this Agent, without leaking the workflows' internals.
"""

from flask_restx import Resource
from pydantic import Field

from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required, with_current_tenant_id
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.login import login_required
from models.model import App, AppMode
from services.agent.roster_service import AgentRosterService


class AgentReferencingWorkflowResponse(ResponseModel):
    app_id: str
    app_name: str
    app_mode: str
    workflow_id: str
    node_ids: list[str] = Field(default_factory=list)


class AgentReferencingWorkflowsResponse(ResponseModel):
    data: list[AgentReferencingWorkflowResponse] = Field(default_factory=list)


register_response_schema_models(console_ns, AgentReferencingWorkflowsResponse)


@console_ns.route("/apps/<uuid:app_id>/agent-referencing-workflows")
class AgentAppReferencingWorkflowsResource(Resource):
    @console_ns.doc("list_agent_app_referencing_workflows")
    @console_ns.doc(description="List workflow apps that reference this Agent App's bound Agent (read-only)")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Referencing workflows listed successfully",
        console_ns.models[AgentReferencingWorkflowsResponse.__name__],
    )
    @console_ns.response(404, "App not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    @with_current_tenant_id
    def get(self, tenant_id: str, app_model: App):
        workflows = AgentRosterService(db.session).list_workflows_referencing_app_agent(
            tenant_id=tenant_id, app_id=app_model.id
        )
        return AgentReferencingWorkflowsResponse(
            data=[AgentReferencingWorkflowResponse.model_validate(workflow) for workflow in workflows]
        ).model_dump(mode="json")
