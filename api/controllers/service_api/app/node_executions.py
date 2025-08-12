from flask_restful import Resource, reqparse

from controllers.service_api import api
from controllers.service_api.app.error import AppUnavailableError
from controllers.service_api.wraps import validate_app_token
from libs.helper import uuid_value
from models.model import App
from services.workflow_run_service import WorkflowRunService


class NodeExecutionsApi(Resource):
    @validate_app_token
    def get(self, app_model: App):
        """
        Get workflow run node executions
        """
        parser = reqparse.RequestParser()
        parser.add_argument("workflow_run_id", type=uuid_value, required=True, location="args")
        args = parser.parse_args()

        try:
            workflow_run_service = WorkflowRunService()

            # No longer need user parameter, query directly using app_model.tenant_id
            node_executions = workflow_run_service.get_workflow_run_node_executions(
                app_model=app_model, run_id=args["workflow_run_id"], user=None
            )

            return {
                "data": [
                    {
                        "id": execution.id,
                        "node_id": execution.node_id,
                        "node_type": execution.node_type,
                        "title": execution.title,
                        "index": execution.index,
                        "predecessor_node_id": execution.predecessor_node_id,
                        "inputs": execution.inputs_dict,
                        "outputs": execution.outputs_dict,
                        "status": execution.status,
                        "error": execution.error,
                        "elapsed_time": execution.elapsed_time,
                        "execution_metadata": execution.execution_metadata_dict,
                        "created_at": execution.created_at.isoformat(),
                        "finished_at": execution.finished_at.isoformat() if execution.finished_at else None,
                    }
                    for execution in node_executions
                ]
            }
        except Exception as e:
            raise AppUnavailableError(str(e))


api.add_resource(NodeExecutionsApi, "/node-executions")
