import logging

from flask import Response
from flask_restx import Resource
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.common.controller_schemas import WorkflowRunPayload
from controllers.common.fields import GeneratedAppResponse, SimpleResultResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.web import web_ns
from controllers.web.error import (
    CompletionRequestError,
    NotWorkflowAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
    TriggerWorkflowServiceModeUnavailableError,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from controllers.web.flask_admission import web_app_admission
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from extensions.ext_application_services import application_services
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from machinery.context import WebAppRequestContext
from services.app.web_workflow_service import WebAppNotWorkflowError, WebWorkflowUnavailableError
from services.errors.app import (
    TriggerWorkflowServiceModeUnavailableError as TriggerWorkflowServiceModeUnavailableServiceError,
)
from services.errors.llm import InvokeRateLimitError

logger = logging.getLogger(__name__)

register_schema_models(web_ns, WorkflowRunPayload)
register_response_schema_models(web_ns, GeneratedAppResponse, SimpleResultResponse)


@web_ns.route("/workflows/run")
class WorkflowRunApi(Resource):
    @web_ns.doc("Run Workflow")
    @web_ns.doc(description="Execute a workflow with provided inputs and files.")
    @web_ns.expect(web_ns.models[WorkflowRunPayload.__name__])
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "App Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[GeneratedAppResponse.__name__])
    @web_app_admission
    def post(self, request_context: WebAppRequestContext, app_mode: str) -> Response:
        """
        Run workflow
        """
        payload = WorkflowRunPayload.model_validate(web_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        try:
            response = application_services().apps.web_workflows.run(
                request_context,
                app_mode=app_mode,
                args=args,
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
        except WebAppNotWorkflowError:
            raise NotWorkflowAppError() from None
        except WebWorkflowUnavailableError:
            raise NotFound() from None
        except TriggerWorkflowServiceModeUnavailableServiceError:
            raise TriggerWorkflowServiceModeUnavailableError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@web_ns.route("/workflows/tasks/<string:task_id>/stop")
class WorkflowTaskStopApi(Resource):
    @web_ns.doc("Stop Workflow Task")
    @web_ns.doc(description="Stop a running workflow task.")
    @web_ns.doc(
        params={
            "task_id": {"description": "Task ID to stop", "type": "string", "required": True},
        }
    )
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Task Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[SimpleResultResponse.__name__])
    @web_app_admission
    def post(self, _request_context: WebAppRequestContext, app_mode: str, task_id: str) -> dict[str, object]:
        """
        Stop workflow task
        """
        try:
            application_services().apps.web_workflows.stop(app_mode=app_mode, task_id=task_id)
        except WebAppNotWorkflowError:
            raise NotWorkflowAppError() from None

        return SimpleResultResponse(result="success").model_dump(mode="json")
