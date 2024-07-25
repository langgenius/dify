import logging

from flask_restful import Resource, fields, marshal_with, reqparse
from werkzeug.exceptions import InternalServerError

from controllers.service_api import api
from controllers.service_api.app.error import (
    CompletionRequestError,
    NotWorkflowAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    AppInvokeQuotaExceededError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from libs import helper
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun
from services.app_generate_service import AppGenerateService

logger = logging.getLogger(__name__)


class WorkflowRunApi(Resource):
    workflow_run_fields = {
        'id': fields.String,
        'workflow_id': fields.String,
        'status': fields.String,
        'inputs': fields.Raw,
        'outputs': fields.Raw,
        'error': fields.String,
        'total_steps': fields.Integer,
        'total_tokens': fields.Integer,
        'created_at': fields.DateTime,
        'finished_at': fields.DateTime,
        'elapsed_time': fields.Float,
    }

    @validate_app_token
    @marshal_with(workflow_run_fields)
    def get(self, app_model: App, workflow_id: str):
        """
        Get a workflow task running detail
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        workflow_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == workflow_id).first()
        return workflow_run

    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser):
        """
        Run workflow
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        parser = reqparse.RequestParser()
        parser.add_argument('inputs', type=dict, required=True, nullable=False, location='json')
        parser.add_argument('files', type=list, required=False, location='json')
        parser.add_argument('response_mode', type=str, choices=['blocking', 'streaming'], location='json')
        args = parser.parse_args()

        streaming = args.get('response_mode') == 'streaming'

        try:
            response = AppGenerateService.generate(
                app_model=app_model,
                user=end_user,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=streaming
            )

            return helper.compact_generate_response(response)
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except (ValueError, AppInvokeQuotaExceededError) as e:
            raise e
        except Exception as e:
            logging.exception("internal server error.")
            raise InternalServerError()


class WorkflowTaskStopApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser, task_id: str):
        """
        Stop workflow task
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.SERVICE_API, end_user.id)

        return {
            "result": "success"
        }


api.add_resource(WorkflowRunApi, '/workflows/run/<string:workflow_id>', '/workflows/run')
api.add_resource(WorkflowTaskStopApi, '/workflows/tasks/<string:task_id>/stop')
