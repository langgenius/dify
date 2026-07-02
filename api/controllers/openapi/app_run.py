"""POST /openapi/v1/apps/<app_id>/run — mode-agnostic runner."""

from __future__ import annotations

import logging
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Any

from flask_restx import Resource
from werkzeug.exceptions import (
    BadRequest,
    HTTPException,
    InternalServerError,
    NotFound,
    TooManyRequests,
    UnprocessableEntity,
)

import services
from controllers.common.fields import EventStreamResponse
from controllers.common.wraps import RBACPermission, RBACResourceScope
from controllers.openapi import openapi_ns
from controllers.openapi._audit import emit_app_run
from controllers.openapi._contract import accepts, returns
from controllers.openapi._models import AppRunRequest, TaskStopResponse
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData, RBACRequirement
from controllers.service_api.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from sqlalchemy.orm import Session

from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    AppInvokeQuotaExceededError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from sqlalchemy.orm import Session
from controllers.console.app.wraps import with_session
from extensions.ext_redis import redis_client
from graphon.graph_engine.manager import GraphEngineManager
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.oauth_bearer import Scope
from models.model import App, AppMode
from services.app_generate_service import AppGenerateService
from services.errors.app import (
    IsDraftWorkflowError,
    WorkflowIdFormatError,
    WorkflowNotFoundError,
)
from services.errors.llm import InvokeRateLimitError

logger = logging.getLogger(__name__)


@contextmanager
def _translate_service_errors() -> Generator[None, None, None]:
    try:
        yield
    except WorkflowNotFoundError as ex:
        raise NotFound(str(ex))
    except (IsDraftWorkflowError, WorkflowIdFormatError) as ex:
        raise BadRequest(str(ex))
    except services.errors.conversation.ConversationNotExistsError:
        raise NotFound("Conversation Not Exists.")
    except services.errors.conversation.ConversationCompletedError:
        raise ConversationCompletedError()
    except services.errors.app_model_config.AppModelConfigBrokenError:
        logger.exception("App model config broken.")
        raise AppUnavailableError()
    except ProviderTokenNotInitError as ex:
        raise ProviderNotInitializeError(ex.description)
    except QuotaExceededError:
        raise ProviderQuotaExceededError()
    except ModelCurrentlyNotSupportError:
        raise ProviderModelCurrentlyNotSupportError()
    except AppInvokeQuotaExceededError:
        # App concurrency limit. Without this it falls through to the bare `except Exception`
        # below and surfaces as a 500. Render as the canonical 429 (code "too_many_requests");
        # the source message is dropped since it carries internal detail (client_id / limits).
        raise TooManyRequests()
    except InvokeRateLimitError as ex:
        raise InvokeRateLimitHttpError(ex.description)
    except InvokeError as e:
        raise CompletionRequestError(e.description)


def _generate(app: App, caller: Any, args: dict[str, Any], streaming: bool, session: Session):
    return AppGenerateService.generate(
        session=session,
        app_model=app,
        user=caller,
        args=args,
        invoke_from=InvokeFrom.OPENAPI,
        streaming=streaming,
    )


def _run_chat(app: App, caller: Any, payload: AppRunRequest, session: Session):
    if not payload.query or not payload.query.strip():
        raise UnprocessableEntity("query_required_for_chat")
    args = payload.model_dump(exclude_none=True)
    with _translate_service_errors():
        return _generate(app, caller, args, streaming=True, session=session)


def _run_completion(app: App, caller: Any, payload: AppRunRequest, session: Session):
    args = payload.model_dump(exclude_none=True)
    args["auto_generate_name"] = False
    args.setdefault("query", "")
    with _translate_service_errors():
        return _generate(app, caller, args, streaming=True, session=session)


def _run_workflow(app: App, caller: Any, payload: AppRunRequest, session: Session):
    if payload.query is not None:
        raise UnprocessableEntity("query_not_supported_for_workflow")
    args = payload.model_dump(exclude={"query", "conversation_id", "auto_generate_name"}, exclude_none=True)
    with _translate_service_errors():
        return _generate(app, caller, args, streaming=True, session=session)


_DISPATCH: dict[AppMode, Callable[[App, Any, AppRunRequest, Session], Any]] = {
    AppMode.CHAT: _run_chat,
    AppMode.AGENT_CHAT: _run_chat,
    AppMode.ADVANCED_CHAT: _run_chat,
    AppMode.COMPLETION: _run_completion,
    AppMode.WORKFLOW: _run_workflow,
}


@openapi_ns.route("/apps/<string:app_id>/run")
class AppRunApi(Resource):
    @auth_router.guard(
        scope=Scope.APPS_RUN,
        rbac=RBACRequirement(resource_type=RBACResourceScope.APP, scene=RBACPermission.APP_TEST_AND_RUN),
    )
    @openapi_ns.response(200, "Run result (SSE stream)", openapi_ns.models[EventStreamResponse.__name__])
    @accepts(body=AppRunRequest)
    @with_session
    def post(self, session: Session, app_id: str, *, auth_data: AuthData, body: AppRunRequest):
        app_model, caller, caller_kind = auth_data.require_app_context()

        handler = _DISPATCH.get(app_model.mode)
        if handler is None:
            raise UnprocessableEntity("mode_not_runnable")

        try:
            stream_obj = handler(app_model, caller, body, session)
        except HTTPException:
            raise
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()

        emit_app_run(
            app_id=app_model.id,
            tenant_id=app_model.tenant_id,
            caller_kind=caller_kind,
            mode=str(app_model.mode),
            surface="apps",
        )

        # response-contract:ignore compact_generate_response
        return helper.compact_generate_response(stream_obj)


@openapi_ns.route("/apps/<string:app_id>/tasks/<string:task_id>/stop")
class AppRunTaskStopApi(Resource):
    @auth_router.guard(
        scope=Scope.APPS_RUN,
        rbac=RBACRequirement(resource_type=RBACResourceScope.APP, scene=RBACPermission.APP_TEST_AND_RUN),
    )
    @returns(200, TaskStopResponse, description="Task stopped")
    def post(self, app_id: str, task_id: str, *, auth_data: AuthData):
        app_model, caller, caller_kind = auth_data.require_app_context()
        AppQueueManager.set_stop_flag_no_user_check(task_id)
        GraphEngineManager(redis_client).send_stop_command(task_id)
        return TaskStopResponse(result="success")
