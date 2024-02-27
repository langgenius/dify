from flask_restful import Resource, marshal_with, reqparse

from controllers.console import api
from controllers.console.app.error import DraftWorkflowNotExist
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from fields.workflow_fields import workflow_fields
from libs.login import current_user, login_required
from models.model import App, AppMode
from services.workflow_service import WorkflowService


class DraftWorkflowApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
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
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
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


class DraftWorkflowRunApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App):
        """
        Run draft workflow
        """
        # TODO
        workflow_service = WorkflowService()
        workflow_service.run_draft_workflow(app_model=app_model, account=current_user)

        # TODO
        return {
            "result": "success"
        }


class WorkflowTaskStopApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App, task_id: str):
        """
        Stop workflow task
        """
        # TODO
        workflow_service = WorkflowService()
        workflow_service.stop_workflow_task(app_model=app_model, task_id=task_id, account=current_user)

        return {
            "result": "success"
        }


class DraftWorkflowNodeRunApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App, node_id: str):
        """
        Run draft workflow node
        """
        # TODO
        workflow_service = WorkflowService()
        workflow_service.run_draft_workflow_node(app_model=app_model, node_id=node_id, account=current_user)

        # TODO
        return {
            "result": "success"
        }


class PublishedWorkflowApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_fields)
    def get(self, app_model: App):
        """
        Get published workflow
        """
        # fetch published workflow by app_model
        workflow_service = WorkflowService()
        workflow = workflow_service.get_published_workflow(app_model=app_model)

        # return workflow, if not found, return None
        return workflow

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App):
        """
        Publish workflow
        """
        workflow_service = WorkflowService()
        workflow_service.publish_workflow(app_model=app_model, account=current_user)

        return {
            "result": "success"
        }


class DefaultBlockConfigApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
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
    @get_app_model(mode=[AppMode.CHAT, AppMode.COMPLETION])
    def post(self, app_model: App):
        """
        Convert basic mode of chatbot app to workflow mode
        Convert expert mode of chatbot app to workflow mode
        Convert Completion App to Workflow App
        """
        # convert to workflow mode
        workflow_service = WorkflowService()
        workflow = workflow_service.convert_to_workflow(
            app_model=app_model,
            account=current_user
        )

        # return workflow
        return workflow


api.add_resource(DraftWorkflowApi, '/apps/<uuid:app_id>/workflows/draft')
api.add_resource(DraftWorkflowRunApi, '/apps/<uuid:app_id>/workflows/draft/run')
api.add_resource(WorkflowTaskStopApi, '/apps/<uuid:app_id>/workflows/tasks/<string:task_id>/stop')
api.add_resource(DraftWorkflowNodeRunApi, '/apps/<uuid:app_id>/workflows/draft/nodes/<uuid:node_id>/run')
api.add_resource(PublishedWorkflowApi, '/apps/<uuid:app_id>/workflows/published')
api.add_resource(DefaultBlockConfigApi, '/apps/<uuid:app_id>/workflows/default-workflow-block-configs')
api.add_resource(ConvertToWorkflowApi, '/apps/<uuid:app_id>/convert-to-workflow')
