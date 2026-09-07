import logging

from flask import Response
from flask_restx import Resource
from werkzeug.exceptions import InternalServerError, Unauthorized

from controllers.common.controller_schemas import WorkflowRunPayload
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import register_response_schema_models, register_schema_model
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.explore.error import NotWorkflowAppError
from controllers.console.explore.installed_app_admission import get_installed_app
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from extensions.ext_application_services import application_services
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.errors.llm import InvokeRateLimitError
from services.installed_app_access_service import InstalledAppRef
from services.installed_app_generation_service import InstalledAppNotWorkflowError

from .. import console_ns

logger = logging.getLogger(__name__)

register_schema_model(console_ns, WorkflowRunPayload)
register_response_schema_models(console_ns, SimpleResultResponse)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/workflows/run")
class InstalledAppWorkflowRunApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowRunPayload.__name__])
    @console_ns.response(200, "Success")
    @console_account_admission()
    @get_installed_app
    @model_validate(WorkflowRunPayload)
    def post(
        self,
        req_data: WorkflowRunPayload,
        request_context: RequestContext,
        installed_app: InstalledAppRef,
    ) -> Response:
        """
        Run workflow
        """
        try:
            response = application_services().installed_app_generation.generate_workflow(
                installed_app=installed_app,
                account_id=request_context.account_id,
                args=req_data.model_dump(exclude_none=True),
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
        except (AppDefinitionUnavailableError, InstalledAppNotWorkflowError):
            raise NotWorkflowAppError() from None
        except AccountNotFoundError:
            raise Unauthorized("Account no longer exists.") from None
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


@console_ns.route("/installed-apps/<uuid:installed_app_id>/workflows/tasks/<string:task_id>/stop")
class InstalledAppWorkflowTaskStopApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission()
    @get_installed_app
    def post(self, request_context: RequestContext, installed_app: InstalledAppRef, task_id: str) -> dict[str, object]:
        """
        Stop workflow task
        """
        try:
            app_mode = application_services().app_definitions.get_mode(installed_app.app_id)
        except AppDefinitionUnavailableError:
            raise NotWorkflowAppError() from None
        if app_mode != "workflow":
            raise NotWorkflowAppError()

        application_services().app_tasks.stop_workflow_task_no_user_check(task_id=task_id)

        return SimpleResultResponse(result="success").model_dump(mode="json")
