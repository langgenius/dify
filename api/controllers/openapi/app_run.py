"""Run routes on /openapi/v1: one per app mode."""

from __future__ import annotations

import logging
from collections.abc import Callable, Collection, Generator, Iterable, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
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
from constants.oauth_bearer import Scope
from controllers.common.fields import EventStreamResponse
from controllers.common.rbac import PlainApp, RBACCheck, RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._audit import emit_app_run
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._files import end_read_transaction, materialize, merge_files
from controllers.openapi._hints import attach_stream_hints
from controllers.openapi._models import (
    AdvancedChatRunPayload,
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

# The service raises ValueError for a body the generator cannot run; its message names
# internals (variable ids, config keys), so the caller gets a fixed text and the log the detail.
_INVALID_RUN_INPUT: Final = "invalid run input"


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
    except ValueError:
        logger.warning("run input refused by the service.", exc_info=True)
        raise BadRequest(_INVALID_RUN_INPUT)
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


def _generate_args(ctx: Context, payload: RunPayloadBase, *, exclude: Collection[str] = ()) -> dict[str, Any]:
    args = payload.model_dump(exclude={"files", "attachments", *exclude}, exclude_none=True)
    if payload.files or payload.attachments:
        end_read_transaction(ctx.session)
    args["inputs"] = merge_files(payload.inputs, payload.files, ctx.caller)
    if payload.attachments:
        args["files"] = materialize(payload.attachments, ctx.caller)
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


HintLayer = Callable[[Iterable[str], str, str], Generator[str, None, None]]


def _reply_layer(events: Iterable[str], op: str, app_id: str) -> Generator[str, None, None]:
    return with_reply_hints(events, op=op, app_id=app_id)


def _form_layer(events: Iterable[str], op: str, app_id: str) -> Generator[str, None, None]:
    return with_form_hints(events, app_id=app_id)


@dataclass(frozen=True, slots=True, kw_only=True)
class _RunRoute:
    """What differs between the per-mode run routes; `_run_api` builds the Resource from it.

    `hints` apply innermost first, so a stream wrapped in (reply, form) has form hints outermost.
    """

    resource: str
    segment: str
    op: str
    summary: str
    payload: type[RunPayloadBase]
    modes: tuple[AppMode, ...]
    hints: tuple[HintLayer, ...] = ()
    examples: tuple[Example, ...] = ()


_RUN_ROUTES: Final = (
    _RunRoute(
        resource="WorkflowRunApi",
        segment="workflow",
        op="console_app.workflow.run",
        summary="Run a workflow app; streams workflow events",
        payload=WorkflowRunPayload,
        modes=(AppMode.WORKFLOW,),
        hints=(_form_layer,),
        examples=(
            Example(
                title="Run a workflow with two variables",
                input={"app_id": "<app_id>", "inputs": {"topic": "quarterly report", "language": "en"}},
            ),
            Example(
                title="Run a workflow with a local file variable",
                input={"app_id": "<app_id>", "inputs": {}, "files": {"document": "./report.pdf"}},
            ),
            Example(
                title="Run a pinned published workflow version",
                input={"app_id": "<app_id>", "inputs": {}, "workflow_id": "<workflow_id>"},
            ),
        ),
    ),
    _RunRoute(
        resource="ChatRunApi",
        segment="chat",
        op="console_app.chat.run",
        summary="Run a chat or agent app; streams message events",
        payload=ChatRunPayload,
        modes=(AppMode.CHAT, AppMode.AGENT_CHAT),
        hints=(_reply_layer,),
        examples=(
            Example(
                title="Start a new conversation",
                input={"app_id": "<app_id>", "query": "Summarise the latest release", "inputs": {}},
            ),
            Example(
                title="Reply in an existing conversation",
                input={
                    "app_id": "<app_id>",
                    "query": "Make it shorter",
                    "inputs": {},
                    "conversation_id": "<conversation_id>",
                },
            ),
            Example(
                title="Ask about a local file attached to the message",
                input={
                    "app_id": "<app_id>",
                    "query": "What is in this file?",
                    "inputs": {},
                    "attachments": ["./report.pdf"],
                },
            ),
        ),
    ),
    _RunRoute(
        resource="AdvancedChatRunApi",
        segment="advanced-chat",
        op="console_app.advanced_chat.run",
        summary="Run an advanced-chat (chatflow) app; streams message and workflow events",
        payload=AdvancedChatRunPayload,
        modes=(AppMode.ADVANCED_CHAT,),
        hints=(_reply_layer, _form_layer),
        examples=(
            Example(
                title="Start a new conversation",
                input={"app_id": "<app_id>", "query": "Summarise the latest release", "inputs": {}},
            ),
            Example(
                title="Reply in an existing conversation",
                input={
                    "app_id": "<app_id>",
                    "query": "Make it shorter",
                    "inputs": {},
                    "conversation_id": "<conversation_id>",
                },
            ),
        ),
    ),
    _RunRoute(
        resource="CompletionRunApi",
        segment="completion",
        op="console_app.completion.run",
        summary="Run a completion app; streams message events",
        payload=CompletionRunPayload,
        modes=(AppMode.COMPLETION,),
        examples=(
            Example(
                title="Run a completion app with its variables",
                input={"app_id": "<app_id>", "inputs": {"text": "The quick brown fox"}},
            ),
            Example(
                title="Run a completion app with prompt text",
                input={"app_id": "<app_id>", "inputs": {}, "query": "Write a haiku about the sea"},
            ),
        ),
    ),
)


def _run_api(route: _RunRoute) -> type[Resource]:
    @endpoint(
        op=route.op,
        kind=Kind.SSE,
        summary=route.summary,
        requirements=_RUN_GUARDS,
        body=route.payload,
        examples=route.examples,
        returns=_STREAM_RESULT,
    )
    def post(self: Resource, ctx: Context, app_id: str, *, body: RunPayloadBase):
        _require_mode(ctx.app, *route.modes)
        stream = _stream(ctx, _generate_args(ctx, body))
        for layer in route.hints:
            stream = layer(stream, route.op, ctx.app.id)
        return _respond(ctx, stream)

    resource = type(route.resource, (Resource,), {"post": post, "__module__": __name__})
    return openapi_ns.route(f"/apps/<string:app_id>/{route.segment}:run")(resource)


WorkflowRunApi, ChatRunApi, AdvancedChatRunApi, CompletionRunApi = (_run_api(route) for route in _RUN_ROUTES)


@openapi_ns.route("/apps/<string:app_id>/tasks/<string:task_id>:stop")
class AppRunTaskStopApi(Resource):
    @endpoint(
        op="run.stop",
        kind=Kind.OBJECT,
        summary="Stop a running task",
        examples=(Example(title="Stop a running task", input={"app_id": "<app_id>", "task_id": "<task_id>"}),),
        requirements=_RUN_GUARDS,
        returns=(200, TaskStopResponse, "Task stopped"),
    )
    def post(self, ctx: Context, app_id: str, task_id: str):
        AppQueueManager.set_stop_flag_no_user_check(task_id)
        GraphEngineManager(redis_client).send_stop_command(task_id)
        return TaskStopResponse(result="success")
