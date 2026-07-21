import logging

from sqlalchemy.orm import Session
from werkzeug.exceptions import InternalServerError

from controllers.common.controller_schemas import WorkflowRunPayload
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import register_response_schema_models, register_schema_model
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.app.wraps import with_session
from controllers.console.explore.error import NotWorkflowAppError
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import with_current_user
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from extensions.ext_redis import redis_client
from graphon.graph_engine.manager import GraphEngineManager
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from models import Account
from models.model import AppMode, InstalledApp
from services.app_generate_service import AppGenerateService
from services.errors.llm import InvokeRateLimitError

from .. import console_ns

logger = logging.getLogger(__name__)

register_schema_model(console_ns, WorkflowRunPayload)
register_response_schema_models(console_ns, SimpleResultResponse)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/workflows/run")
class InstalledAppWorkflowRunApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[WorkflowRunPayload.__name__])
    @console_ns.response(200, "Success")
    @with_current_user
    @with_session
    def post(self, session: Session, current_user: Account, installed_app: InstalledApp):
        """
        Run workflow
        """
        app_model = installed_app.app_with_session(session=session)
        if not app_model:
            raise NotWorkflowAppError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        payload = WorkflowRunPayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)
        try:
            response = AppGenerateService.generate(
                session=session,
                app_model=app_model,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.EXPLORE,
                streaming=True,
            )

            # response-contract:ignore compact_generate_response
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


@console_ns.route("/installed-apps/<uuid:installed_app_id>/workflows/tasks/<string:task_id>/stop")
class InstalledAppWorkflowTaskStopApi(InstalledAppResource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @with_session(write=False)
    def post(self, session: Session, installed_app: InstalledApp, task_id: str):
        """
        Stop workflow task
        """
        app_model = installed_app.app_with_session(session=session)
        if not app_model:
            raise NotWorkflowAppError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode != AppMode.WORKFLOW:
            raise NotWorkflowAppError()

        # Stop using both mechanisms for backward compatibility
        # Legacy stop flag mechanism (without user check)
        AppQueueManager.set_stop_flag_no_user_check(task_id)

        # New graph engine command channel mechanism
        GraphEngineManager(redis_client).send_stop_command(task_id)

        return SimpleResultResponse(result="success").model_dump(mode="json")
