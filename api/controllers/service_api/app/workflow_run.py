from flask_restful import Resource, marshal_with  # type: ignore

from controllers.service_api import api
from controllers.service_api.wraps import validate_app_token
from fields.workflow_run_fields import (
    workflow_run_node_execution_fields,
)
from models import App
from services.workflow_run_service import WorkflowRunService


class WorkflowRunDetailApi(Resource):
    @validate_app_token
    @marshal_with(workflow_run_node_execution_fields)
    def get(self, app_model: App, run_id):
        """
        Get workflow run detail
        """
        run_id = str(run_id)

        workflow_run_service = WorkflowRunService()
        workflow_run = workflow_run_service.get_workflow_run(app_model=app_model, run_id=run_id)

        return workflow_run


api.add_resource(WorkflowRunDetailApi, "/apps/workflow-runs/<uuid:run_id>", endpoint="workflow_run_detail")
