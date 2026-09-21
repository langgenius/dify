"""Run routes on /openapi/v1: one per app mode, plus the deprecated mode-agnostic :run."""

from __future__ import annotations

import logging
from collections.abc import Callable, Collection, Generator, Iterable, Mapping
from contextlib import contextmanager
from typing import Any, Final

from flask_restx import Resource
from sqlalchemy.orm import Session
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
from controllers.common.rbac import PlainApp, RBACCheck, RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._audit import emit_app_run
from controllers.openapi._contract import Kind, endpoint, op_of
from controllers.openapi._files import materialize, merge_files
from controllers.openapi._hints import attach_stream_hints
from controllers.openapi._models import (
    AdvancedChatRunPayload,
    AppRunRequest,
    ChatRunPayload,
    CompletionRunPayload,
    Hint,
    RunPayloadBase,
    TaskStopResponse,
    WorkflowRunPayload,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    CheckAppAccess,
    CheckAppApiEnabled,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
)
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject
from controllers.openapi.human_input_form import with_form_hints
from controllers.service_api.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
    TriggerWorkflowServiceModeUnavailableError,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import MessageEndStreamResponse, StreamEvent
from core.errors.error import (
    AppInvokeQuotaExceededError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
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
from services.errors.app import (
    TriggerWorkflowServiceModeUnavailableError as TriggerWorkflowServiceModeUnavailableServiceError,
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
    except TriggerWorkflowServiceModeUnavailableServiceError:
        raise TriggerWorkflowServiceModeUnavailableError()
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
    except ValueError as ex:
        raise BadRequest(str(ex))
    except HTTPException:
        raise
    except Exception:
        logger.exception("internal server error.")
        raise InternalServerError()


_RUN_GUARDS: Final = (
    CheckSubject(allowed=(AccountSubject, ExternalSsoSubject)),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_RUN),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp())),
    CheckAppAccess(),
)
_STREAM_RESULT: Final = (200, EventStreamResponse, "Run result (SSE stream)")


def _generate(app: App, caller: Any, args: dict[str, Any], session: Session):
    return AppGenerateService.generate(
        session=session,
        app_model=app,
        user=caller,
        args=args,
        invoke_from=InvokeFrom.OPENAPI,
        streaming=True,
    )


def _generate_args(caller: Any, payload: RunPayloadBase, *, exclude: Collection[str] = ()) -> dict[str, Any]:
    args = payload.model_dump(exclude={"files", "attachments", *exclude}, exclude_none=True)
    args["inputs"] = merge_files(payload.inputs, payload.files, caller)
    if payload.attachments:
        args["files"] = materialize(payload.attachments, caller)
    return args


def _stream(ctx: Context, args: dict[str, Any]):
    with _translate_service_errors():
        return _generate(ctx.app, ctx.caller, args, ctx.session)


def _require_mode(app: App, *modes: AppMode) -> None:
    if app.mode not in modes:
        raise UnprocessableEntity("app_mode_mismatch")


def _respond(ctx: Context, stream: Any):
    app_model = ctx.app
    emit_app_run(
        app_id=app_model.id,
        tenant_id=app_model.tenant_id,
        caller_kind=ctx.subject.caller_role,
        mode=str(app_model.mode),
        surface="apps",
    )
    # response-contract:ignore compact_generate_response
    return helper.compact_generate_response(stream)


class _ChatMessageEnd(MessageEndStreamResponse):
    conversation_id: str


def with_reply_hints(events: Iterable[str], *, op: str, app_id: str) -> Generator[str, None, None]:
    def build(event: Mapping[str, Any]) -> list[Hint]:
        end = _ChatMessageEnd.model_validate(event)
        return [
            Hint(
                summary="Reply in this conversation",
                op=op,
                input={"app_id": app_id, "conversation_id": end.conversation_id, "query": None, "inputs": {}},
            )
        ]

    return attach_stream_hints(events, event=StreamEvent.MESSAGE_END.value, build=build)


def _run_chat(app: App, caller: Any, payload: AppRunRequest, session: Session):
    if not payload.query or not payload.query.strip():
        raise UnprocessableEntity("query_required_for_chat")
    args = _generate_args(caller, payload)
    with _translate_service_errors():
        return _generate(app, caller, args, session)


def _run_completion(app: App, caller: Any, payload: AppRunRequest, session: Session):
    args = _generate_args(caller, payload)
    args["auto_generate_name"] = False
    args.setdefault("query", "")
    with _translate_service_errors():
        return _generate(app, caller, args, session)


def _run_workflow(app: App, caller: Any, payload: AppRunRequest, session: Session):
    if payload.query is not None:
        raise UnprocessableEntity("query_not_supported_for_workflow")
    args = _generate_args(caller, payload, exclude={"query", "conversation_id", "auto_generate_name"})
    with _translate_service_errors():
        return _generate(app, caller, args, session)


_DISPATCH: dict[AppMode, Callable[[App, Any, AppRunRequest, Session], Any]] = {
    AppMode.CHAT: _run_chat,
    AppMode.AGENT_CHAT: _run_chat,
    AppMode.ADVANCED_CHAT: _run_chat,
    AppMode.COMPLETION: _run_completion,
    AppMode.WORKFLOW: _run_workflow,
}


@openapi_ns.route("/apps/<string:app_id>/workflow:run")
class WorkflowRunApi(Resource):
    @endpoint(
        op="console_app.workflow.run",
        kind=Kind.SSE,
        summary="Run a workflow app; streams workflow events",
        requirements=_RUN_GUARDS,
        body=WorkflowRunPayload,
        returns=_STREAM_RESULT,
    )
    def post(self, ctx: Context, app_id: str, *, body: WorkflowRunPayload):
        _require_mode(ctx.app, AppMode.WORKFLOW)
        stream = _stream(ctx, _generate_args(ctx.caller, body))
        return _respond(ctx, with_form_hints(stream, app_id=ctx.app.id))


@openapi_ns.route("/apps/<string:app_id>/chat:run")
class ChatRunApi(Resource):
    @endpoint(
        op="console_app.chat.run",
        kind=Kind.SSE,
        summary="Run a chat or agent app; streams message events",
        requirements=_RUN_GUARDS,
        body=ChatRunPayload,
        returns=_STREAM_RESULT,
    )
    def post(self, ctx: Context, app_id: str, *, body: ChatRunPayload):
        _require_mode(ctx.app, AppMode.CHAT, AppMode.AGENT_CHAT)
        stream = _stream(ctx, _generate_args(ctx.caller, body))
        return _respond(ctx, with_reply_hints(stream, op=op_of(type(self).post), app_id=ctx.app.id))


@openapi_ns.route("/apps/<string:app_id>/advanced-chat:run")
class AdvancedChatRunApi(Resource):
    @endpoint(
        op="console_app.advanced_chat.run",
        kind=Kind.SSE,
        summary="Run an advanced-chat (chatflow) app; streams message and workflow events",
        requirements=_RUN_GUARDS,
        body=AdvancedChatRunPayload,
        returns=_STREAM_RESULT,
    )
    def post(self, ctx: Context, app_id: str, *, body: AdvancedChatRunPayload):
        _require_mode(ctx.app, AppMode.ADVANCED_CHAT)
        stream = with_reply_hints(
            _stream(ctx, _generate_args(ctx.caller, body)), op=op_of(type(self).post), app_id=ctx.app.id
        )
        return _respond(ctx, with_form_hints(stream, app_id=ctx.app.id))


@openapi_ns.route("/apps/<string:app_id>/completion:run")
class CompletionRunApi(Resource):
    @endpoint(
        op="console_app.completion.run",
        kind=Kind.SSE,
        summary="Run a completion app; streams message events",
        requirements=_RUN_GUARDS,
        body=CompletionRunPayload,
        returns=_STREAM_RESULT,
    )
    def post(self, ctx: Context, app_id: str, *, body: CompletionRunPayload):
        _require_mode(ctx.app, AppMode.COMPLETION)
        return _respond(ctx, _stream(ctx, _generate_args(ctx.caller, body)))


@openapi_ns.route("/apps/<string:app_id>:run")
class AppRunApi(Resource):
    @endpoint(
        op="console_app.run",
        kind=Kind.SSE,
        summary="Deprecated: use console_app.<mode>.run for the app's mode",
        requirements=_RUN_GUARDS,
        body=AppRunRequest,
        returns=_STREAM_RESULT,
        deprecated=True,
    )
    def post(self, ctx: Context, app_id: str, *, body: AppRunRequest):
        app_model = ctx.app
        caller = ctx.caller

        handler = _DISPATCH.get(app_model.mode)
        if handler is None:
            raise UnprocessableEntity("mode_not_runnable")

        try:
            stream_obj = handler(app_model, caller, body, ctx.session)
        except HTTPException:
            raise
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()

        emit_app_run(
            app_id=app_model.id,
            tenant_id=app_model.tenant_id,
            caller_kind=ctx.subject.caller_role,
            mode=str(app_model.mode),
            surface="apps",
        )

        # response-contract:ignore compact_generate_response
        return helper.compact_generate_response(with_form_hints(stream_obj, app_id=app_model.id))


@openapi_ns.route("/apps/<string:app_id>/tasks/<string:task_id>:stop")
class AppRunTaskStopApi(Resource):
    @endpoint(
        op="run.stop",
        kind=Kind.OBJECT,
        summary="Stop a running task",
        requirements=_RUN_GUARDS,
        returns=(200, TaskStopResponse, "Task stopped"),
    )
    def post(self, ctx: Context, app_id: str, task_id: str):
        AppQueueManager.set_stop_flag_no_user_check(task_id)
        GraphEngineManager(redis_client).send_stop_command(task_id)
        return TaskStopResponse(result="success")
