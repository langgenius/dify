"""Agent App access & sharing endpoints (read-only workflow references).

An Agent App is backed by a roster Agent that workflow Agent nodes may also
reference. This exposes the read-only "Workflow access" surface from the PRD:
which workflow apps use this Agent, without leaking the workflows' internals.
"""

from flask_restx import Resource

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models.model import App, AppMode
from services.agent.roster_service import AgentRosterService


@console_ns.route("/apps/<uuid:app_id>/agent-referencing-workflows")
class AgentAppReferencingWorkflowsResource(Resource):
    @console_ns.doc("list_agent_app_referencing_workflows")
    @console_ns.doc(description="List workflow apps that reference this Agent App's bound Agent (read-only)")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Referencing workflows listed successfully")
    @console_ns.response(404, "App not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    def get(self, app_model: App):
        _, tenant_id = current_account_with_tenant()
        workflows = AgentRosterService(db.session).list_workflows_referencing_app_agent(
            tenant_id=tenant_id, app_id=app_model.id
        )
        return {"data": workflows}
