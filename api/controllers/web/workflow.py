import logging
from typing import Any

from pydantic import BaseModel, Field
from werkzeug.exceptions import InternalServerError

from controllers.common.schema import register_schema_models
from controllers.web import web_ns
from controllers.web.error import (
    CompletionRequestError,
    NotWorkflowAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from controllers.web.wraps import WebApiResource
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_runtime.errors.invoke import InvokeError
from core.workflow.graph_engine.manager import GraphEngineManager
from libs import helper
from models.model import App, AppMode, EndUser
from services.app_generate_service import AppGenerateService
from services.errors.llm import InvokeRateLimitError


class WorkflowRunPayload(BaseModel):
    inputs: dict[str, Any] = Field(description="Input variables for the workflow")
    files: list[dict[str, Any]] | None = Field(default=None, description="Files to be processed by the workflow")


logger = logging.getLogger(__name__)

register_schema_models(web_ns, WorkflowRunPayload)


@web_ns.route("/workflows/run")
class WorkflowRunApi(WebApiResource):
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
    def post(self, app_model: App, end_user: EndUser):
        """
        Run workflow
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        payload = WorkflowRunPayload.model_validate(web_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        try:
            response = AppGenerateService.generate(
                app_model=app_model, user=end_user, args=args, invoke_from=InvokeFrom.WEB_APP, streaming=True
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
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@web_ns.route("/workflows/tasks/<string:task_id>/stop")
class WorkflowTaskStopApi(WebApiResource):
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
    def post(self, app_model: App, end_user: EndUser, task_id: str):
        """
        Stop workflow task
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        # Stop using both mechanisms for backward compatibility
        # Legacy stop flag mechanism (without user check)
        AppQueueManager.set_stop_flag_no_user_check(task_id)

        # New graph engine command channel mechanism
        GraphEngineManager.send_stop_command(task_id)

        return {"result": "success"}
