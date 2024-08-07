from flask_restful import Resource, marshal_with, reqparse
from flask_restful.inputs import int_range

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from fields.workflow_app_log_fields import workflow_app_log_pagination_fields
from libs.login import login_required
from models.model import App, AppMode
from services.workflow_app_service import WorkflowAppService


class WorkflowAppLogApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @marshal_with(workflow_app_log_pagination_fields)
    def get(self, app_model: App):
        """
        Get workflow app logs
        """
        parser = reqparse.RequestParser()
        parser.add_argument('keyword', type=str, location='args')
        parser.add_argument('status', type=str, choices=['succeeded', 'failed', 'stopped'], location='args')
        parser.add_argument('page', type=int_range(1, 99999), default=1, location='args')
        parser.add_argument('limit', type=int_range(1, 100), default=20, location='args')
        args = parser.parse_args()

        # get paginate workflow app logs
        workflow_app_service = WorkflowAppService()
        workflow_app_log_pagination = workflow_app_service.get_paginate_workflow_app_logs(
            app_model=app_model,
            args=args
        )

        return workflow_app_log_pagination


api.add_resource(WorkflowAppLogApi, '/apps/<uuid:app_id>/workflow-app-logs')
