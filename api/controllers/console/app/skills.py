from flask_restx import Resource

from controllers.console import console_ns
from controllers.console.app.error import DraftWorkflowNotExist
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, current_account_with_tenant, setup_required
from core.skill.entities.api_entities import NodeSkillInfo
from libs.login import login_required
from models import App
from models._workflow_exc import NodeNotFoundError
from models.model import AppMode
from services.skill_service import SkillService
from services.workflow_service import WorkflowService


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/skills")
class NodeSkillsApi(Resource):
    """API for retrieving skill references for a specific workflow node."""

    @console_ns.doc("get_node_skills")
    @console_ns.doc(description="Get skill references for a specific node in the draft workflow")
    @console_ns.doc(params={"app_id": "Application ID", "node_id": "Node ID"})
    @console_ns.response(200, "Node skills retrieved successfully")
    @console_ns.response(404, "Workflow or node not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, node_id: str):
        """
        Get skill information for a specific node in the draft workflow.

        Returns information about skill references in the node, including:
        - skill_references: List of prompt messages marked as skills
        - tool_references: Aggregated tool references from all skill prompts
        - file_references: Aggregated file references from all skill prompts
        """
        current_user, _ = current_account_with_tenant()
        workflow_service = WorkflowService()
        workflow = workflow_service.get_draft_workflow(app_model=app_model)

        if not workflow:
            raise DraftWorkflowNotExist()

        try:
            skill_info = SkillService.get_node_skill_info(
                app=app_model,
                workflow=workflow,
                node_id=node_id,
                user_id=current_user.id,
            )
        except NodeNotFoundError:
            return NodeSkillInfo.empty(node_id=node_id).model_dump()
        return skill_info.model_dump()


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/skills")
class WorkflowSkillsApi(Resource):
    """API for retrieving all skill references in a workflow."""

    @console_ns.doc("get_workflow_skills")
    @console_ns.doc(description="Get all skill references in the draft workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Workflow skills retrieved successfully")
    @console_ns.response(404, "Workflow not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App):
        """
        Get skill information for all nodes in the draft workflow that have skill references.

        Returns a list of nodes with their skill information.
        """
        current_user, _ = current_account_with_tenant()
        workflow_service = WorkflowService()
        workflow = workflow_service.get_draft_workflow(app_model=app_model)

        if not workflow:
            raise DraftWorkflowNotExist()

        skills_info = SkillService.get_workflow_skills(
            app=app_model,
            workflow=workflow,
            user_id=current_user.id,
        )
        return {"nodes": [info.model_dump() for info in skills_info]}
