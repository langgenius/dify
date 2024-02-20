from flask_restful import Resource, reqparse, marshal_with

from controllers.console import api
from controllers.console.app.error import DraftWorkflowNotExist
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from fields.workflow_fields import workflow_fields
from libs.login import login_required, current_user
from models.model import App, ChatbotAppEngine, AppMode
from services.workflow_service import WorkflowService


class DraftWorkflowApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.WORKFLOW], app_engine=ChatbotAppEngine.WORKFLOW)
    @marshal_with(workflow_fields)
    def get(self, app_model: App):
        """
        Get draft workflow
        """
        # fetch draft workflow by app_model
        workflow_service = WorkflowService()
        workflow = workflow_service.get_draft_workflow(app_model=app_model)

        if not workflow:
            raise DraftWorkflowNotExist()

        # return workflow, if not found, return None (initiate graph by frontend)
        return workflow

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.WORKFLOW], app_engine=ChatbotAppEngine.WORKFLOW)
    def post(self, app_model: App):
        """
        Sync draft workflow
        """
        parser = reqparse.RequestParser()
        parser.add_argument('graph', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        workflow_service = WorkflowService()
        workflow_service.sync_draft_workflow(app_model=app_model, graph=args.get('graph'), account=current_user)

        return {
            "result": "success"
        }


class DefaultBlockConfigApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.WORKFLOW], app_engine=ChatbotAppEngine.WORKFLOW)
    def get(self, app_model: App):
        """
        Get default block config
        """
        # Get default block configs
        workflow_service = WorkflowService()
        return workflow_service.get_default_block_configs()


class ConvertToWorkflowApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.CHAT)
    @marshal_with(workflow_fields)
    def post(self, app_model: App):
        """
        Convert basic mode of chatbot app to workflow
        """
        # convert to workflow mode
        workflow_service = WorkflowService()
        workflow = workflow_service.chatbot_convert_to_workflow(app_model=app_model)

        # return workflow
        return workflow


api.add_resource(DraftWorkflowApi, '/apps/<uuid:app_id>/workflows/draft')
api.add_resource(DefaultBlockConfigApi, '/apps/<uuid:app_id>/workflows/default-workflow-block-configs')
api.add_resource(ConvertToWorkflowApi, '/apps/<uuid:app_id>/convert-to-workflow')
