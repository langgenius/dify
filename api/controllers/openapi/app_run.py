"""POST /openapi/v1/apps/<app_id>/run — mode-agnostic runner."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, HTTPException, InternalServerError, NotFound, UnprocessableEntity

import services
from controllers.openapi import openapi_ns
from controllers.openapi._audit import emit_app_run
from controllers.openapi._models import (
    AppRunRequest,
    ChatMessageResponse,
    CompletionMessageResponse,
    WorkflowRunResponse,
)
from controllers.openapi.auth.composition import OAUTH_BEARER_PIPELINE
from controllers.service_api.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
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
def _translate_service_errors() -> Iterator[None]:
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
    except InvokeRateLimitError as ex:
        raise InvokeRateLimitHttpError(ex.description)
    except InvokeError as e:
        raise CompletionRequestError(e.description)


def _unpack_blocking(response: Any) -> Mapping[str, Any]:
    if isinstance(response, tuple):
        response = response[0]
    if not isinstance(response, Mapping):
        raise InternalServerError("blocking generate returned non-mapping response")
    return response


def _generate(app: App, caller: Any, args: dict[str, Any], streaming: bool):
    return AppGenerateService.generate(
        app_model=app,
        user=caller,
        args=args,
        invoke_from=InvokeFrom.OPENAPI,
        streaming=streaming,
    )


def _run_chat(app: App, caller: Any, payload: AppRunRequest, streaming: bool):
    if not payload.query or not payload.query.strip():
        raise UnprocessableEntity("query_required_for_chat")
    args = payload.model_dump(exclude_none=True)
    with _translate_service_errors():
        response = _generate(app, caller, args, streaming)
    if streaming:
        return response, None
    return None, ChatMessageResponse.model_validate(_unpack_blocking(response)).model_dump(mode="json")


def _run_completion(app: App, caller: Any, payload: AppRunRequest, streaming: bool):
    args = payload.model_dump(exclude_none=True)
    args["auto_generate_name"] = False
    args.setdefault("query", "")
    with _translate_service_errors():
        response = _generate(app, caller, args, streaming)
    if streaming:
        return response, None
    return None, CompletionMessageResponse.model_validate(_unpack_blocking(response)).model_dump(mode="json")


def _run_workflow(app: App, caller: Any, payload: AppRunRequest, streaming: bool):
    if payload.query is not None:
        raise UnprocessableEntity("query_not_supported_for_workflow")
    args = payload.model_dump(exclude={"query", "conversation_id", "auto_generate_name"}, exclude_none=True)
    with _translate_service_errors():
        response = _generate(app, caller, args, streaming)
    if streaming:
        return response, None
    return None, WorkflowRunResponse.model_validate(_unpack_blocking(response)).model_dump(mode="json")


_DISPATCH: dict[AppMode, Callable[[App, Any, AppRunRequest, bool], tuple[Any, dict[str, Any] | None]]] = {
    AppMode.CHAT: _run_chat,
    AppMode.AGENT_CHAT: _run_chat,
    AppMode.ADVANCED_CHAT: _run_chat,
    AppMode.COMPLETION: _run_completion,
    AppMode.WORKFLOW: _run_workflow,
}


@openapi_ns.route("/apps/<string:app_id>/run")
class AppRunApi(Resource):
    @openapi_ns.expect(openapi_ns.models[AppRunRequest.__name__])
    @openapi_ns.response(200, "Run result")
    @OAUTH_BEARER_PIPELINE.guard(scope=Scope.APPS_RUN)
    def post(self, app_id: str, app_model: App, caller, caller_kind: str):
        body = request.get_json(silent=True) or {}
        body.pop("user", None)
        try:
            payload = AppRunRequest.model_validate(body)
        except ValidationError as exc:
            raise UnprocessableEntity(exc.json())

        handler = _DISPATCH.get(app_model.mode)
        if handler is None:
            raise UnprocessableEntity("mode_not_runnable")

        streaming = payload.response_mode == "streaming"
        try:
            stream_obj, blocking_body = handler(app_model, caller, payload, streaming)
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

        if streaming:
            return helper.compact_generate_response(stream_obj)
        return blocking_body, 200
