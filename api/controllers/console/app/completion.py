import json
import logging
from collections.abc import Generator, Iterator, Mapping
from typing import Any, Literal, NoReturn, Protocol, runtime_checkable
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

import services
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import AgentId, PlainApp, RBACCheck
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.agent.app_helpers import resolve_agent_runtime_app_model
from controllers.console.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.app.wraps import get_app_model, with_session
from controllers.console.wraps import (
    RBACPermission,
    account_initialization_required,
    edit_permission_required,
    model_validate,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
    with_current_user_id,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting.rate_limit import RateLimitGenerator
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.helper.trace_id_helper import get_external_trace_id
from core.logging.context import get_request_id, get_trace_id
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.exception import RelayedHTTPError
from libs.external_api import error_responses
from libs.helper import uuid_value
from libs.login import login_required
from models import Account
from models.agent import AgentConfigDraftType
from models.model import App, AppMode
from services.agent.errors import AgentNotFoundError
from services.agent.roster_service import AgentRosterService
from services.app_generate_service import AppGenerateService
from services.app_task_service import AppTaskService
from services.errors.llm import InvokeRateLimitError

logger = logging.getLogger(__name__)


@runtime_checkable
class _ClosableStream(Protocol):
    def close(self) -> None: ...


def _resolve_debugger_chat_streaming(
    *, app_mode: AppMode, response_mode: str, response_mode_provided: bool = True
) -> bool:
    """Agent App runtime is SSE-only until backend blocking runs are supported."""
    if app_mode != AppMode.AGENT:
        return response_mode != "blocking"
    if response_mode_provided and response_mode == "blocking":
        raise BadRequest("Agent App only supports streaming response mode.")
    return True


class BaseMessagePayload(BaseModel):
    inputs: dict[str, Any]
    # Agent Apps (AppMode.AGENT) derive their model + prompt from the bound Agent
    # Soul, so no override ``model_config`` is sent; chat / agent-chat / completion
    # debugging still pass it. Optional here, required in practice by those modes
    # downstream when their config is built from args.
    model_config_data: dict[str, Any] = Field(
        default_factory=dict,
        alias="model_config",
    )
    files: list[Any] | None = Field(
        default=None,
        description="Uploaded files",
    )
    response_mode: Literal["blocking", "streaming"] = Field(default="blocking", description="Response mode")
    retriever_from: str = Field(default="dev", description="Retriever source")


class CompletionMessagePayload(BaseMessagePayload):
    query: str = Field(default="", description="Query text")


class ChatMessagePayload(BaseMessagePayload):
    query: str = Field(..., description="User query")
    conversation_id: str | None = Field(default=None, description="Conversation ID")
    parent_message_id: str | None = Field(default=None, description="Parent message ID")
    draft_type: Literal["draft", "debug_build"] = Field(
        default="draft",
        description="Agent App debug config source. Use debug_build while the Agent is in build mode.",
    )

    @field_validator("conversation_id", "parent_message_id")
    @classmethod
    def validate_uuid(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


_BUILD_CHAT_FINALIZATION_QUERY = """Finalize this Build chat configuration for the agent.

This step is only for persisting Agent config changes discovered in the current Build chat. Do not install packages,
edit workspace files, run validation or debugging commands, make exploratory checks, or perform other work.

Use only the current Build chat message history to identify changes that need to be persisted. Do not inspect, test, or
validate old config unless the message history already shows that the old config is invalid.

Only update the build-draft config note when the current Build chat contains durable context that later runs need.
Write the config note in the language used by the message history.
Do not create, update, delete, inspect, or fill gaps in other Agent config resources, including config files, config
skills, config env, tools, models, knowledge, or prompt settings.

When updating the config note with the Agent config CLI usage provided in the runtime prompt, record only durable
context needed by later runs, such as:

- what you installed or configured outside the workspace for this agent,
- where those external updates live, including CLI tools, packages, and persistent $HOME paths,
- how the agent should use it in later runs,
- any setup, authentication, or user action still required.

After config persistence completes, respond FINISHED."""


register_schema_models(console_ns, CompletionMessagePayload, ChatMessagePayload)
register_response_schema_models(console_ns, SimpleResultResponse)


# define completion message api for user
@console_ns.route("/apps/<uuid:app_id>/completion-messages")
class CompletionMessageApi(Resource):
    @error_responses(
        AppUnavailableError,
        CompletionRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @console_ns.doc("create_completion_message")
    @console_ns.doc(description="Generate completion message for debugging")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[CompletionMessagePayload.__name__])
    @console_ns.response(200, "Completion generated successfully")
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(404, "App not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @rbac_permission_required(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp()))
    @with_session
    @get_app_model(mode=AppMode.COMPLETION)
    @model_validate(CompletionMessagePayload)
    def post(self, req_data: CompletionMessagePayload, session: Session, current_user: Account, app_model: App):
        args = req_data.model_dump(exclude_none=True, by_alias=True)

        streaming = req_data.response_mode != "blocking"
        args["auto_generate_name"] = False

        try:
            response = AppGenerateService.generate(
                session=session,
                app_model=app_model,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER,
                streaming=streaming,
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
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
        except InvokeError as e:
            raise CompletionRequestError(e.description) from e
        except ValueError as e:
            raise e
        except Exception as e:
            logger.exception("internal server error.")
            raise InternalServerError() from e


@console_ns.route("/apps/<uuid:app_id>/completion-messages/<string:task_id>/stop")
class CompletionMessageStopApi(Resource):
    @console_ns.doc("stop_completion_message")
    @console_ns.doc(description="Stop a running completion message generation")
    @console_ns.doc(params={"app_id": "Application ID", "task_id": "Task ID to stop"})
    @console_ns.response(200, "Task stopped successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user_id
    @get_app_model(mode=AppMode.COMPLETION)
    def post(self, current_user_id: str, app_model: App, task_id: str):
        AppTaskService.stop_task(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            task_id=task_id,
            invoke_from=InvokeFrom.DEBUGGER,
            user_id=current_user_id,
            app_mode=AppMode.value_of(app_model.mode),
        )

        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/apps/<uuid:app_id>/chat-messages")
class ChatMessageApi(Resource):
    @error_responses(
        AgentNotFoundError,
        AppUnavailableError,
        CompletionRequestError,
        InvokeRateLimitHttpError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
        RelayedHTTPError,
    )
    @console_ns.doc("create_chat_message")
    @console_ns.doc(description="Generate chat message for debugging")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[ChatMessagePayload.__name__])
    @console_ns.response(200, "Chat message generated successfully")
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(404, "App or conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp()))
    @with_session
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.AGENT])
    def post(self, session: Session, current_tenant_id: str, current_user: Account, app_model: App):
        return _create_chat_message(
            session=session, current_tenant_id=current_tenant_id, current_user=current_user, app_model=app_model
        )


@console_ns.route("/agent/<uuid:agent_id>/chat-messages")
class AgentChatMessageApi(Resource):
    @error_responses(
        AgentNotFoundError,
        AppUnavailableError,
        CompletionRequestError,
        InvokeRateLimitHttpError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
        RelayedHTTPError,
    )
    @console_ns.doc("create_agent_chat_message")
    @console_ns.doc(description="Generate an Agent App chat message for debugging")
    @console_ns.doc(params={"agent_id": "Agent ID"})
    @console_ns.expect(console_ns.models[ChatMessagePayload.__name__])
    @console_ns.response(200, "Chat message generated successfully")
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(404, "Agent or conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session
    def post(self, session: Session, current_tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = AgentRosterService(session).get_agent_runtime_app_model(
            tenant_id=current_tenant_id, agent_id=str(agent_id)
        )
        return _create_chat_message(
            session=session,
            current_tenant_id=current_tenant_id,
            current_user=current_user,
            app_model=app_model,
            agent_id=str(agent_id),
        )


@console_ns.route("/agent/<uuid:agent_id>/build-chat/finalize")
class AgentBuildChatFinalizeApi(Resource):
    @error_responses(
        AgentNotFoundError,
        AppUnavailableError,
        CompletionRequestError,
        InvokeRateLimitHttpError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
        RelayedHTTPError,
    )
    @console_ns.doc("finalize_agent_build_chat")
    @console_ns.doc(description="Run a build-draft Agent App turn that asks the agent to push config updates")
    @console_ns.doc(params={"agent_id": "Agent ID"})
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(404, "Agent, build draft, or conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session
    def post(self, session: Session, current_tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = AgentRosterService(session).get_agent_runtime_app_model(
            tenant_id=current_tenant_id, agent_id=str(agent_id)
        )
        return _create_build_chat_finalization_message(
            session=session,
            current_tenant_id=current_tenant_id,
            current_user=current_user,
            app_model=app_model,
            agent_id=str(agent_id),
        )


@console_ns.route("/apps/<uuid:app_id>/chat-messages/<string:task_id>/stop")
class ChatMessageStopApi(Resource):
    @console_ns.doc("stop_chat_message")
    @console_ns.doc(description="Stop a running chat message generation")
    @console_ns.doc(params={"app_id": "Application ID", "task_id": "Task ID to stop"})
    @console_ns.response(200, "Task stopped successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user_id
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
    def post(self, current_user_id: str, app_model: App, task_id: str):
        return _stop_chat_message(current_user_id=current_user_id, app_model=app_model, task_id=task_id)


@console_ns.route("/agent/<uuid:agent_id>/chat-messages/<string:task_id>/stop")
class AgentChatMessageStopApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.doc("stop_agent_chat_message")
    @console_ns.doc(description="Stop a running Agent App chat message generation")
    @console_ns.doc(params={"agent_id": "Agent ID", "task_id": "Task ID to stop"})
    @console_ns.response(200, "Task stopped successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId()))
    @with_current_user_id
    @with_current_tenant_id
    @with_session(write=False)
    def post(self, session: Session, current_tenant_id: str, current_user_id: str, agent_id: UUID, task_id: str):
        app_model = resolve_agent_runtime_app_model(
            session=session,
            tenant_id=current_tenant_id,
            agent_id=agent_id,
        )
        return _stop_chat_message(current_user_id=current_user_id, app_model=app_model, task_id=task_id)


def _resolve_current_user_agent_debug_conversation_id(
    *,
    session: Session,
    current_tenant_id: str,
    current_user: Account,
    app_model: App,
    agent_id: str | None,
    draft_type: AgentConfigDraftType,
    start_new: bool = False,
) -> str:
    """Resolve the current editor's Build or Preview conversation."""

    roster_service = AgentRosterService(session)
    resolved_agent_id = agent_id
    if not resolved_agent_id:
        agent = roster_service.get_app_backing_agent(tenant_id=current_tenant_id, app_id=str(app_model.id))
        if agent is None:
            raise AgentNotFoundError()
        resolved_agent_id = agent.id

    if draft_type == AgentConfigDraftType.DEBUG_BUILD:
        return roster_service.get_or_create_build_conversation(
            tenant_id=current_tenant_id,
            agent_id=resolved_agent_id,
            account_id=current_user.id,
        )
    if start_new:
        return roster_service.rotate_preview_conversation(
            tenant_id=current_tenant_id,
            agent_id=resolved_agent_id,
            account_id=current_user.id,
        )
    conversation_id = roster_service.get_current_preview_conversation(
        tenant_id=current_tenant_id,
        agent_id=resolved_agent_id,
        account_id=current_user.id,
    )
    if conversation_id is None:
        raise NotFound("Conversation Not Exists.")
    return conversation_id


def _create_chat_message(
    *,
    session: Session,
    current_user: Account,
    app_model: App,
    current_tenant_id: str | None = None,
    agent_id: str | None = None,
):
    """Validate a Console chat payload and generate a turn for the editor's conversation.

    Agent Build chat keeps its stable conversation, while Preview can start a new one.
    Immediate Agent stream failures are relayed before the HTTP SSE response starts.
    """
    raw_payload = console_ns.payload or {}
    args_model = ChatMessagePayload.model_validate(raw_payload)
    args = args_model.model_dump(exclude_none=True, by_alias=True)

    if AppMode.value_of(app_model.mode) == AppMode.AGENT:
        draft_type = AgentConfigDraftType(args_model.draft_type)
        # Preview follows the normal chat contract: an omitted/empty conversation ID starts a new
        # conversation. Build chat keeps its stable mapping so build drafts and finalization stay continuous.
        debug_conversation_id = _resolve_current_user_agent_debug_conversation_id(
            session=session,
            current_tenant_id=current_tenant_id or app_model.tenant_id,
            current_user=current_user,
            app_model=app_model,
            agent_id=agent_id,
            draft_type=draft_type,
            start_new=draft_type == AgentConfigDraftType.DRAFT and not args_model.conversation_id,
        )
        if args_model.conversation_id and args_model.conversation_id != debug_conversation_id:
            raise NotFound("Conversation Not Exists.")
        args["conversation_id"] = debug_conversation_id

    streaming = _resolve_debugger_chat_streaming(
        app_mode=AppMode.value_of(app_model.mode),
        response_mode=args_model.response_mode,
        response_mode_provided=isinstance(raw_payload, dict) and "response_mode" in raw_payload,
    )
    if AppMode.value_of(app_model.mode) == AppMode.AGENT:
        args["response_mode"] = "streaming"
    args["auto_generate_name"] = False

    external_trace_id = get_external_trace_id(request)
    if external_trace_id:
        args["external_trace_id"] = external_trace_id

    return _generate_chat_message_response(
        session=session,
        current_user=current_user,
        app_model=app_model,
        args=args,
        streaming=streaming,
        agent_id=agent_id,
    )


def _create_build_chat_finalization_message(
    *, session: Session, current_user: Account, app_model: App, current_tenant_id: str, agent_id: str
):
    """Finalize the editor's stable Build conversation, succeeding only after message end.

    Applying the finalized draft remains a separate Console operation. Generation failures
    raise HTTP errors with their original status/code and the available correlation IDs.
    """
    debug_conversation_id = _resolve_current_user_agent_debug_conversation_id(
        session=session,
        current_tenant_id=current_tenant_id,
        current_user=current_user,
        app_model=app_model,
        agent_id=agent_id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
    )
    args: dict[str, Any] = {
        "query": _BUILD_CHAT_FINALIZATION_QUERY,
        "inputs": {},
        "response_mode": "streaming",
        "draft_type": "debug_build",
        "conversation_id": debug_conversation_id,
        "auto_generate_name": False,
    }
    external_trace_id = get_external_trace_id(request)
    if external_trace_id:
        args["external_trace_id"] = external_trace_id

    response = _generate_chat_message(
        session=session,
        current_user=current_user,
        app_model=app_model,
        args=args,
        streaming=True,
    )
    _drain_streaming_generate_response(
        response,
        context_details={
            "agent_id": agent_id,
            "app_id": app_model.id,
            "conversation_id": debug_conversation_id,
            "trace_id": external_trace_id,
        },
    )
    return {"result": "success"}, 200


def _drain_streaming_generate_response(
    response: RateLimitGenerator | Generator[str], *, context_details: Mapping[str, Any]
) -> None:
    """Consume a streamed app-generate response until a terminal message event arrives.

    Finalize keeps the normal Agent App streaming path so the existing queue,
    persistence, and runtime-session behavior stay intact. The console API only
    changes the HTTP boundary: it drains the SSE stream server-side and returns
    success after the generated build-chat message reaches ``message_end``. Stream
    errors retain their status/code and correlation; premature exhaustion is a 502.
    The source stream is closed on success and failure.
    """
    details = dict(context_details)
    last_event: str | None = None
    try:
        for chunk in response:
            for event_name, payload in _iter_sse_event_payloads(chunk):
                payload_event = (payload or {}).get("event") or event_name
                if payload_event == "message_end":
                    return
                if payload_event == "error":
                    _raise_http_error_from_sse_error(
                        payload or {},
                        fallback_message="Build chat finalization failed.",
                        context_details=details,
                    )
                if payload_event:
                    last_event = payload_event
                if payload:
                    for key in ("task_id", "message_id", "conversation_id"):
                        if payload.get(key):
                            details[key] = payload[key]
    finally:
        if isinstance(response, _ClosableStream):
            response.close()

    _raise_http_error_from_sse_error(
        {
            "status": 502,
            "code": "agent_stream_incomplete",
            "details": {
                "error_source": "console_stream",
                "reason": "missing_terminal_event",
                "last_event": last_event,
            },
        },
        fallback_message="Build chat finalization did not complete.",
        context_details=details,
    )


def _generate_chat_message(
    *,
    session: Session,
    current_user: Account,
    app_model: App,
    args: dict[str, Any],
    streaming: bool,
):
    try:
        return AppGenerateService.generate(
            session=session,
            app_model=app_model,
            user=current_user,
            args=args,
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=streaming,
        )
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
    except InvokeRateLimitError as ex:
        raise InvokeRateLimitHttpError(ex.description) from ex
    except CompletionRequestError:
        raise
    except InvokeError as e:
        raise CompletionRequestError(e.description) from e
    except ValueError as e:
        raise e
    except Exception as e:
        logger.exception("internal server error.")
        raise InternalServerError() from e


def _generate_chat_message_response(
    *,
    session: Session,
    current_user: Account,
    app_model: App,
    args: dict[str, Any],
    streaming: bool,
    agent_id: str | None = None,
):
    """Generate a debugger response, relaying immediate Agent errors before SSE starts.

    The optional Agent ID identifies the agent-owned route; app-owned routes use the
    app and resolved conversation context. Other app modes keep their response behavior.
    """
    response = _generate_chat_message(
        session=session,
        current_user=current_user,
        app_model=app_model,
        args=args,
        streaming=streaming,
    )
    if AppMode.value_of(app_model.mode) == AppMode.AGENT and streaming:
        response = _raise_agent_stream_error_before_response(
            response,
            context_details={
                "agent_id": agent_id,
                "app_id": app_model.id,
                "conversation_id": args.get("conversation_id"),
                "trace_id": args.get("external_trace_id"),
            },
        )
    return helper.compact_generate_response(response)


def _stop_chat_message(*, current_user_id: str, app_model: App, task_id: str):
    AppTaskService.stop_task(
        tenant_id=app_model.tenant_id,
        app_id=app_model.id,
        task_id=task_id,
        invoke_from=InvokeFrom.DEBUGGER,
        user_id=current_user_id,
        app_mode=AppMode.value_of(app_model.mode),
    )

    return SimpleResultResponse(result="success").model_dump(mode="json"), 200


def _raise_agent_stream_error_before_response(response, *, context_details: Mapping[str, Any]):
    """Surface immediate Agent App stream errors as HTTP errors before SSE starts.

    The shared streaming helper always returns HTTP 200 once the SSE response is
    created. Agent v2 configuration errors, such as an invalid model API key,
    can be the first real stream event after the initial ping; pre-reading that
    first non-ping event lets the console API relay the stream's status/code and
    diagnostics as an HTTP error. Successful streams replay every buffered chunk.
    """
    if isinstance(response, Mapping):
        return response

    buffered: list[str] = []
    iterator = iter(response)
    while True:
        try:
            chunk = next(iterator)
        except StopIteration:
            return iter(buffered)

        if not isinstance(chunk, str):
            return _prepend_stream_chunks(buffered, chunk, iterator)

        if _is_sse_ping(chunk):
            buffered.append(chunk)
        else:
            error_payload = _extract_sse_error_payload(chunk)
            if error_payload is not None:
                if isinstance(response, _ClosableStream):
                    response.close()
                _raise_http_error_from_sse_error(
                    error_payload, fallback_message="Agent App chat failed.", context_details=context_details
                )
            return _prepend_stream_chunks(buffered, chunk, iterator)


def _prepend_stream_chunks(buffered: list[Any], first: Any, iterator: Iterator[Any]) -> Generator[Any]:
    yield from buffered
    yield first
    yield from iterator


def _is_sse_ping(chunk: str) -> bool:
    return chunk.strip() == "event: ping"


def _iter_sse_event_payloads(chunk: str) -> Iterator[tuple[str | None, dict[str, Any] | None]]:
    """Parse complete SSE chunks from app generation, ignoring malformed/non-object JSON data.

    Event names are retained for ping and named events; multiline data follows SSE semantics.
    This consumes the complete frames emitted by the app response serializer.
    """
    raw_events = chunk.replace("\r\n", "\n").split("\n\n")
    for raw_event in (event for event in raw_events if event.strip()):
        event_name: str | None = None
        data_lines: list[str] = []
        for line in raw_event.splitlines():
            if line.startswith("event:"):
                event_name = line.removeprefix("event:").strip()
            elif line.startswith("data:"):
                data_lines.append(line.removeprefix("data:").removeprefix(" "))
        payload = None
        if data_lines:
            try:
                parsed = json.loads("\n".join(data_lines))
                if isinstance(parsed, dict):
                    payload = parsed
            except json.JSONDecodeError:
                pass
        yield event_name, payload


def _extract_sse_error_payload(chunk: str) -> dict[str, Any] | None:
    """Return the first serialized error in a complete chunk, if one is present."""
    for event_name, payload in _iter_sse_event_payloads(chunk):
        if payload is not None and (payload.get("event") or event_name) == "error":
            return payload
    return None


def _raise_http_error_from_sse_error(
    payload: Mapping[str, Any], *, fallback_message: str, context_details: Mapping[str, Any]
) -> NoReturn:
    """Relay a serialized generation failure through the standard Console error contract.

    Nonempty stream IDs enrich request context; request/trace IDs remain local to this HTTP
    request. The legacy completion error keeps its class, while all other status/code pairs
    use the open downstream-error contract. Every failure is logged with its correlation.
    """
    details = dict(context_details)
    stream_details = payload.get("details")
    if isinstance(stream_details, Mapping):
        details.update({key: value for key, value in stream_details.items() if value is not None and value != ""})
    for key in ("conversation_id", "message_id", "task_id"):
        if payload.get(key):
            details[key] = payload[key]
    details["trace_id"] = context_details.get("trace_id") or get_trace_id()
    details["request_id"] = get_request_id()
    details = {key: value for key, value in details.items() if value is not None and value != ""}

    status = int(payload.get("status") or 400)
    code = str(payload.get("code") or "completion_request_error")
    message = str(payload.get("message") or fallback_message)
    log = logger.error if status >= 500 else logger.warning
    log(
        "Agent stream failed: agent_id=%s app_id=%s conversation_id=%s message_id=%s task_id=%s "
        "agent_run_id=%s trace_id=%s request_id=%s status=%s code=%s error_source=%s reason=%s message=%s",
        details.get("agent_id"),
        details.get("app_id"),
        details.get("conversation_id"),
        details.get("message_id"),
        details.get("task_id"),
        details.get("agent_run_id"),
        details.get("trace_id"),
        details.get("request_id"),
        status,
        code,
        details.get("error_source"),
        details.get("reason"),
        message,
    )
    if status == 400 and code == "completion_request_error":
        exc = CompletionRequestError(message)
        if details:
            assert exc.data is not None
            exc.data["details"] = details
        raise exc
    raise RelayedHTTPError(status=status, error_code=code, message=message, details=details or None)
