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
)

import services
from constants.oauth_bearer import Scope
from controllers.common.fields import EventStreamResponse
from controllers.common.rbac import PlainApp, RBACCheck, RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._audit import emit_app_run
from controllers.openapi._contract import Effect, Example, Kind, endpoint
from controllers.openapi._errors import AppModeMismatch, RunNotFound, RunNotStoppable
from controllers.openapi._files import end_read_transaction, materialize, merge_files
from controllers.openapi._hints import attach_stream_hints
from controllers.openapi._models import (
    AdvancedChatRunPayload,
    ChatRunPayload,
    CompletionRunPayload,
    DraftWorkflowRunPayload,
    Hint,
    RunPayloadBase,
    TaskStopResponse,
    WorkflowRunPayload,
)
from controllers.openapi.app_workflow import require_uuid
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    EDITOR_ROLES,
    CheckAppAccess,
    CheckAppApiEnabled,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    Requirement,
    account_app_guards,
)
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject, ResourceAccessSubject
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
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import MessageEndStreamResponse, StreamEvent
from core.errors.error import (
    AppInvokeQuotaExceededError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from extensions.ext_application_services import application_services
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from models.model import App, AppMode
from services.app_generate_service import AppGenerateService
from services.app_task_service import WorkflowStopOutcome
from services.errors.app import (
    IsDraftWorkflowError,
    WorkflowIdFormatError,
    WorkflowNotFoundError,
)
from services.errors.app import (
    TriggerWorkflowServiceModeUnavailableError as TriggerWorkflowServiceModeUnavailableServiceError,
)
from services.errors.llm import InvokeRateLimitError
from services.workflow.graph_check import GRAPH_MODES

logger = logging.getLogger(__name__)

# The service raises ValueError for a body the generator cannot run; its message names
# internals (variable ids, config keys), so the caller gets a fixed text and the log the detail.
_INVALID_RUN_INPUT: Final = "invalid run input"


@contextmanager
def _translate_service_errors() -> Generator[None]:
    try:
        yield
    except WorkflowNotFoundError as ex:
        raise NotFound(str(ex)) from ex
    except (IsDraftWorkflowError, WorkflowIdFormatError) as ex:
        raise BadRequest(str(ex)) from ex
    except TriggerWorkflowServiceModeUnavailableServiceError as caught_error:
        raise TriggerWorkflowServiceModeUnavailableError() from caught_error
    except services.errors.conversation.ConversationNotExistsError as caught_error:
        raise NotFound("Conversation Not Exists.") from caught_error
    except services.errors.conversation.ConversationCompletedError as caught_error:
        raise ConversationCompletedError() from caught_error
    except services.errors.app_model_config.AppModelConfigBrokenError as caught_error:
        logger.exception("App model config broken.")
        raise AppUnavailableError() from caught_error
    except ProviderTokenNotInitError as ex:
        raise ProviderNotInitializeError(ex.description) from ex
    except QuotaExceededError as caught_error:
        raise ProviderQuotaExceededError() from caught_error
    except ModelCurrentlyNotSupportError as caught_error:
        raise ProviderModelCurrentlyNotSupportError() from caught_error
    except AppInvokeQuotaExceededError as caught_error:
        # App concurrency limit. Without this it falls through to the bare `except Exception`
        # below and surfaces as a 500. Render as the canonical 429 (code "too_many_requests");
        # the source message is dropped since it carries internal detail (client_id / limits).
        raise TooManyRequests() from caught_error
    except InvokeRateLimitError as ex:
        raise InvokeRateLimitHttpError(ex.description) from ex
    except InvokeError as e:
        raise CompletionRequestError(e.description) from e
    except ValueError as caught_error:
        logger.warning("run input refused by the service.", exc_info=True)
        raise BadRequest(_INVALID_RUN_INPUT) from caught_error
    except HTTPException:
        raise
    except Exception as caught_error:
        logger.exception("internal server error.")
        raise InternalServerError() from caught_error


_RUN_GUARDS: Final = (
    CheckSubject(allowed=(AccountSubject, ExternalSsoSubject, ResourceAccessSubject)),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_RUN),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp())),
    CheckAppAccess(),
)
_DRAFT_FORM_NOTE: Final = "A human-input pause in a draft run cannot be resumed over openapi."
_STREAM_RESULT: Final = (200, EventStreamResponse, "Run result (SSE stream)")


def _generate(app: App, caller: Any, args: dict[str, Any], session: Session, invoke_from: InvokeFrom):
    return AppGenerateService.generate(
        session=session,
        app_model=app,
        user=caller,
        args=args,
        invoke_from=invoke_from,
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


def _stream(ctx: Context, args: dict[str, Any], invoke_from: InvokeFrom):
    with _translate_service_errors():
        return _generate(ctx.app, ctx.caller, args, ctx.session, invoke_from)


def _require_mode(app: App, *modes: AppMode) -> None:
    """In the handler, not a guard: an external caller the access check refuses must not learn the app's mode."""
    if app.mode not in modes:
        raise AppModeMismatch()


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


def with_reply_hints(events: Iterable[str], *, op: str, app_id: str) -> Generator[str]:
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


HintLayer = Callable[[Iterable[str], str, str], Generator[str]]


def _reply_layer(events: Iterable[str], op: str, app_id: str) -> Generator[str]:
    return with_reply_hints(events, op=op, app_id=app_id)


def _form_layer(events: Iterable[str], op: str, app_id: str) -> Generator[str]:
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
    invoke_from: InvokeFrom = InvokeFrom.OPENAPI

    @property
    def draft(self) -> bool:
        return self.invoke_from is InvokeFrom.DEBUGGER

    @property
    def requirements(self) -> tuple[Requirement, ...]:
        """Draft runs are account-only, so their guards check the mode before RBAC as other account routes do."""
        if self.draft:
            return account_app_guards(
                RBACPermission.APP_TEST_AND_RUN, scope=Scope.APPS_RUN, roles=EDITOR_ROLES, modes=self.modes
            )
        return _RUN_GUARDS


_RUN_ROUTES: Final = (
    _RunRoute(
        resource="WorkflowRunApi",
        segment="workflow",
        op="run.console_app.workflow",
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
                input={"app_id": "<app_id>", "files": {"document": "./report.pdf"}},
            ),
            Example(
                title="Run a workflow with a list of local files for a file-list variable",
                input={"app_id": "<app_id>", "files": {"pages": ["./page-1.png", "./page-2.png"]}},
            ),
            Example(
                title="Run a pinned published workflow version",
                input={"app_id": "<app_id>", "workflow_id": "<workflow_id>"},
            ),
        ),
    ),
    _RunRoute(
        resource="ChatRunApi",
        segment="chat",
        op="run.console_app.chat",
        summary="Run a chat or agent-chat app; streams message events",
        payload=ChatRunPayload,
        modes=(AppMode.CHAT, AppMode.AGENT_CHAT),
        hints=(_reply_layer,),
        examples=(
            Example(
                title="Start a new conversation",
                input={"app_id": "<app_id>", "query": "Summarise the latest release"},
            ),
            Example(
                title="Reply in an existing conversation",
                input={
                    "app_id": "<app_id>",
                    "query": "Make it shorter",
                    "conversation_id": "<conversation_id>",
                },
            ),
            Example(
                title="Ask about a local file attached to the message",
                input={
                    "app_id": "<app_id>",
                    "query": "What is in this file?",
                    "attachments": ["./report.pdf"],
                },
            ),
            Example(
                title="Fill a file variable with a local file",
                input={"app_id": "<app_id>", "query": "Summarise the document", "files": {"document": "./report.pdf"}},
            ),
        ),
    ),
    _RunRoute(
        resource="AdvancedChatRunApi",
        segment="advanced-chat",
        op="run.console_app.advanced_chat",
        summary="Run an advanced-chat (chatflow) app; streams message and workflow events",
        payload=AdvancedChatRunPayload,
        modes=(AppMode.ADVANCED_CHAT,),
        hints=(_reply_layer, _form_layer),
        examples=(
            Example(
                title="Start a new conversation",
                input={"app_id": "<app_id>", "query": "Summarise the latest release"},
            ),
            Example(
                title="Reply in an existing conversation",
                input={
                    "app_id": "<app_id>",
                    "query": "Make it shorter",
                    "conversation_id": "<conversation_id>",
                },
            ),
            Example(
                title="Fill a file variable with a local file",
                input={"app_id": "<app_id>", "query": "Summarise the document", "files": {"document": "./report.pdf"}},
            ),
        ),
    ),
    _RunRoute(
        resource="CompletionRunApi",
        segment="completion",
        op="run.console_app.completion",
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
                input={"app_id": "<app_id>", "query": "Write a haiku about the sea"},
            ),
            Example(
                title="Fill a file variable with a local file",
                input={"app_id": "<app_id>", "files": {"document": "./report.pdf"}},
            ),
        ),
    ),
    _RunRoute(
        resource="WorkflowDraftRunApi",
        segment="draft/workflow",
        op="test.console_app.workflow",
        summary="Test-run the draft of a workflow app; streams workflow events. " + _DRAFT_FORM_NOTE,
        payload=DraftWorkflowRunPayload,
        modes=(AppMode.WORKFLOW,),
        examples=(
            Example(title="Test the draft with one input", input={"app_id": "<app_id>", "inputs": {"topic": "test"}}),
            Example(
                title="Test the draft with a local file variable",
                input={"app_id": "<app_id>", "files": {"document": "./report.pdf"}},
            ),
        ),
        invoke_from=InvokeFrom.DEBUGGER,
    ),
    _RunRoute(
        resource="AdvancedChatDraftRunApi",
        segment="draft/advanced-chat",
        op="test.console_app.advanced_chat",
        summary="Test-run the draft of an advanced-chat app; streams message and workflow events. " + _DRAFT_FORM_NOTE,
        payload=ChatRunPayload,
        modes=(AppMode.ADVANCED_CHAT,),
        hints=(_reply_layer,),
        examples=(
            Example(title="Test the draft with one message", input={"app_id": "<app_id>", "query": "hello"}),
            Example(
                title="Test the draft with a local file variable",
                input={"app_id": "<app_id>", "query": "Summarise the document", "files": {"document": "./report.pdf"}},
            ),
        ),
        invoke_from=InvokeFrom.DEBUGGER,
    ),
)

_DRAFT_TEST_ROUTES: Final = {mode: route for route in _RUN_ROUTES if route.draft for mode in route.modes}


def draft_test_hint(mode: AppMode, *, app_id: str, summary: str) -> Hint:
    """Test-run the draft of an app in `mode`, every required field of that route's payload null."""
    route = _DRAFT_TEST_ROUTES[mode]
    required = {name: None for name, field in route.payload.model_fields.items() if field.is_required()}
    return Hint(summary=summary, op=route.op, input={"app_id": app_id} | required)


def _run_api(route: _RunRoute) -> type[Resource]:
    @endpoint(
        op=route.op,
        kind=Kind.SSE,
        summary=route.summary,
        requirements=route.requirements,
        body=route.payload,
        examples=route.examples,
        returns=_STREAM_RESULT,
    )
    def post(self: Resource, ctx: Context, app_id: str, *, body: RunPayloadBase):
        if not route.draft:
            _require_mode(ctx.app, *route.modes)
        stream = _stream(ctx, _generate_args(ctx, body), route.invoke_from)
        for layer in route.hints:
            stream = layer(stream, route.op, ctx.app.id)
        return _respond(ctx, stream)

    resource = type(route.resource, (Resource,), {"post": post, "__module__": __name__})
    return openapi_ns.route(f"/apps/<string:app_id>/{route.segment}:run")(resource)


(
    WorkflowRunApi,
    ChatRunApi,
    AdvancedChatRunApi,
    CompletionRunApi,
    WorkflowDraftRunApi,
    AdvancedChatDraftRunApi,
) = (_run_api(route) for route in _RUN_ROUTES)


@openapi_ns.route("/apps/<string:app_id>/runs/<string:run_id>:stop")
class AppRunStopApi(Resource):
    @endpoint(
        op="stop.run",
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Stop a running or paused run of a workflow or advanced-chat app",
        examples=(Example(title="Stop a run", input={"app_id": "<app_id>", "run_id": "<run_id>"}),),
        requirements=_RUN_GUARDS,
        returns=(200, TaskStopResponse, "Run stopped"),
    )
    def post(self, ctx: Context, app_id: str, run_id: str):
        _require_mode(ctx.app, *GRAPH_MODES)
        outcome = application_services().app_tasks.stop_workflow_run(
            tenant_id=ctx.app.tenant_id,
            app_id=ctx.app.id,
            run_id=require_uuid(run_id, not_found=RunNotFound),
            app_mode=AppMode.value_of(ctx.app.mode),
            caller_role=ctx.subject.caller_role,
            caller_id=ctx.caller.id,
        )
        if outcome == WorkflowStopOutcome.NOT_FOUND:
            raise RunNotFound()
        if outcome == WorkflowStopOutcome.NOT_STOPPABLE:
            raise RunNotStoppable()
        return TaskStopResponse(result="success")


@openapi_ns.route("/apps/<string:app_id>/tasks/<string:task_id>:stop")
class AppTaskStopApi(Resource):
    @endpoint(
        op="stop.task",
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary=(
            "Stop a streaming reply of a chat, agent-chat or completion app; "
            "`task_id` is the stream's task_id. An unknown task id is accepted"
        ),
        examples=(Example(title="Stop a streaming reply", input={"app_id": "<app_id>", "task_id": "<task_id>"}),),
        requirements=_RUN_GUARDS,
        returns=(200, TaskStopResponse, "Task stopped"),
    )
    def post(self, ctx: Context, app_id: str, task_id: str):
        _require_mode(ctx.app, AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION)
        if not application_services().app_tasks.stop_message_task(
            task_id=task_id, caller_role=ctx.subject.caller_role, caller_id=ctx.caller.id
        ):
            raise NotFound("Task not found")
        return TaskStopResponse(result="success")
