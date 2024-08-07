from flask_restful import Resource, marshal_with, reqparse
from flask_restful.inputs import int_range

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from fields.workflow_run_fields import (
    advanced_chat_workflow_run_pagination_fields,
    workflow_run_detail_fields,
    workflow_run_node_execution_list_fields,
    workflow_run_pagination_fields,
)
from libs.helper import uuid_value
from libs.login import login_required
from models.model import App, AppMode
from services.workflow_run_service import WorkflowRunService


class AdvancedChatAppWorkflowRunListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @marshal_with(advanced_chat_workflow_run_pagination_fields)
    def get(self, app_model: App):
        """
        Get advanced chat app workflow run list
        """
        parser = reqparse.RequestParser()
        parser.add_argument('last_id', type=uuid_value, location='args')
        parser.add_argument('limit', type=int_range(1, 100), required=False, default=20, location='args')
        args = parser.parse_args()

        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_paginate_advanced_chat_workflow_runs(
            app_model=app_model,
            args=args
        )

        return result


class WorkflowRunListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_pagination_fields)
    def get(self, app_model: App):
        """
        Get workflow run list
        """
        parser = reqparse.RequestParser()
        parser.add_argument('last_id', type=uuid_value, location='args')
        parser.add_argument('limit', type=int_range(1, 100), required=False, default=20, location='args')
        args = parser.parse_args()

        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_paginate_workflow_runs(
            app_model=app_model,
            args=args
        )

        return result


class WorkflowRunDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_detail_fields)
    def get(self, app_model: App, run_id):
        """
        Get workflow run detail
        """
        run_id = str(run_id)

        workflow_run_service = WorkflowRunService()
        workflow_run = workflow_run_service.get_workflow_run(app_model=app_model, run_id=run_id)

        return workflow_run


class WorkflowRunNodeExecutionListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_node_execution_list_fields)
    def get(self, app_model: App, run_id):
        """
        Get workflow run node execution list
        """
        run_id = str(run_id)

        workflow_run_service = WorkflowRunService()
        node_executions = workflow_run_service.get_workflow_run_node_executions(app_model=app_model, run_id=run_id)

        return {
            'data': node_executions
        }


api.add_resource(AdvancedChatAppWorkflowRunListApi, '/apps/<uuid:app_id>/advanced-chat/workflow-runs')
api.add_resource(WorkflowRunListApi, '/apps/<uuid:app_id>/workflow-runs')
api.add_resource(WorkflowRunDetailApi, '/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>')
api.add_resource(WorkflowRunNodeExecutionListApi, '/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>/node-executions')
