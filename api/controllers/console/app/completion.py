import logging
from typing import Any, Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

import services
from controllers.common.fields import GeneratedAppResponse, SimpleResultResponse
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
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
    with_current_user_id,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.helper.trace_id_helper import get_external_trace_id
from extensions.ext_database import db
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.helper import uuid_value
from libs.login import login_required
from models import Account
from models.model import App, AppMode
from services.agent.errors import AgentNotFoundError
from services.agent.roster_service import AgentRosterService
from services.app_generate_service import AppGenerateService
from services.app_task_service import AppTaskService
from services.errors.llm import InvokeRateLimitError

logger = logging.getLogger(__name__)


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

Inspect the current build-draft config and shell state, then summarize the changes made during this Build chat.

You must update the build-draft config as needed:

- Update config files for reusable artifacts that should be available later.
- Update config skills for reusable procedures or tools that should be available later.
- Update config env when environment keys or values need to be recorded.
- Update the config note with useful new build context when available. This is strongly recommended even if no files,
  skills, or env changed, because each Build chat usually discovers information worth preserving.

When you update the config note, it should clearly state:

- what you installed or configured outside the workspace for this agent,
- where those external updates live, including CLI tools, packages, and persistent $HOME paths,
- how the agent should use it in later runs,
- any setup, authentication, or user action still required.

Do not repeat details already managed through `dify-agent config push` for config files, skills, or env.
Persist the build-draft config by piping the JSON push spec to `dify-agent config push`.
Local file edits alone are not saved as config. Always include the config note in the JSON push spec, even when the
note content did not change.

After the push completes, respond FINISHED."""


register_schema_models(console_ns, CompletionMessagePayload, ChatMessagePayload)
register_response_schema_models(console_ns, GeneratedAppResponse, SimpleResultResponse)


# define completion message api for user
@console_ns.route("/apps/<uuid:app_id>/completion-messages")
class CompletionMessageApi(Resource):
    @console_ns.doc("create_completion_message")
    @console_ns.doc(description="Generate completion message for debugging")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[CompletionMessagePayload.__name__])
    @console_ns.response(200, "Completion generated successfully", console_ns.models[GeneratedAppResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(404, "App not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=AppMode.COMPLETION)
    def post(self, current_user: Account, app_model: App):
        args_model = CompletionMessagePayload.model_validate(console_ns.payload)
        args = args_model.model_dump(exclude_none=True, by_alias=True)

        streaming = args_model.response_mode != "blocking"
        args["auto_generate_name"] = False

        try:
            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.DEBUGGER, streaming=streaming
            )

            return helper.compact_generate_response(response)
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
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception as e:
            logger.exception("internal server error.")
            raise InternalServerError()


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
            task_id=task_id,
            invoke_from=InvokeFrom.DEBUGGER,
            user_id=current_user_id,
            app_mode=AppMode.value_of(app_model.mode),
        )

        return {"result": "success"}, 200


@console_ns.route("/apps/<uuid:app_id>/chat-messages")
class ChatMessageApi(Resource):
    @console_ns.doc("create_chat_message")
    @console_ns.doc(description="Generate chat message for debugging")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[ChatMessagePayload.__name__])
    @console_ns.response(200, "Chat message generated successfully", console_ns.models[GeneratedAppResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(404, "App or conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.AGENT])
    def post(self, current_tenant_id: str, current_user: Account, app_model: App):
        return _create_chat_message(current_tenant_id=current_tenant_id, current_user=current_user, app_model=app_model)


@console_ns.route("/agent/<uuid:agent_id>/chat-messages")
class AgentChatMessageApi(Resource):
    @console_ns.doc("create_agent_chat_message")
    @console_ns.doc(description="Generate an Agent App chat message for debugging")
    @console_ns.doc(params={"agent_id": "Agent ID"})
    @console_ns.expect(console_ns.models[ChatMessagePayload.__name__])
    @console_ns.response(200, "Chat message generated successfully", console_ns.models[GeneratedAppResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(404, "Agent or conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = resolve_agent_runtime_app_model(tenant_id=current_tenant_id, agent_id=agent_id)
        return _create_chat_message(
            current_tenant_id=current_tenant_id,
            current_user=current_user,
            app_model=app_model,
            agent_id=str(agent_id),
        )


@console_ns.route("/agent/<uuid:agent_id>/build-chat/finalize")
class AgentBuildChatFinalizeApi(Resource):
    @console_ns.doc("finalize_agent_build_chat")
    @console_ns.doc(description="Run a build-draft Agent App turn that asks the agent to push config updates")
    @console_ns.doc(params={"agent_id": "Agent ID"})
    @console_ns.response(200, "Build chat finalization started", console_ns.models[GeneratedAppResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(404, "Agent, build draft, or conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = resolve_agent_runtime_app_model(tenant_id=current_tenant_id, agent_id=agent_id)
        return _create_build_chat_finalization_message(
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
    @console_ns.doc("stop_agent_chat_message")
    @console_ns.doc(description="Stop a running Agent App chat message generation")
    @console_ns.doc(params={"agent_id": "Agent ID", "task_id": "Task ID to stop"})
    @console_ns.response(200, "Task stopped successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user_id: str, agent_id: UUID, task_id: str):
        app_model = resolve_agent_runtime_app_model(tenant_id=current_tenant_id, agent_id=agent_id)
        return _stop_chat_message(current_user_id=current_user_id, app_model=app_model, task_id=task_id)


def _resolve_current_user_agent_debug_conversation_id(
    *, current_tenant_id: str, current_user: Account, app_model: App, agent_id: str | None
) -> str:
    roster_service = AgentRosterService(db.session)
    if agent_id:
        return roster_service.get_or_create_agent_app_debug_conversation_id(
            tenant_id=current_tenant_id,
            agent_id=agent_id,
            account_id=current_user.id,
        )

    agent = roster_service.get_app_backing_agent(tenant_id=current_tenant_id, app_id=str(app_model.id))
    if agent is None:
        raise AgentNotFoundError()
    return roster_service.get_or_create_agent_app_debug_conversation_id(
        tenant_id=current_tenant_id,
        agent_id=agent.id,
        account_id=current_user.id,
    )


def _create_chat_message(
    *,
    current_user: Account,
    app_model: App,
    current_tenant_id: str | None = None,
    agent_id: str | None = None,
):
    raw_payload = console_ns.payload or {}
    args_model = ChatMessagePayload.model_validate(raw_payload)
    args = args_model.model_dump(exclude_none=True, by_alias=True)

    if AppMode.value_of(app_model.mode) == AppMode.AGENT:
        debug_conversation_id = _resolve_current_user_agent_debug_conversation_id(
            current_tenant_id=current_tenant_id or app_model.tenant_id,
            current_user=current_user,
            app_model=app_model,
            agent_id=agent_id,
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
        current_user=current_user,
        app_model=app_model,
        args=args,
        streaming=streaming,
    )


def _create_build_chat_finalization_message(
    *, current_user: Account, app_model: App, current_tenant_id: str, agent_id: str
):
    debug_conversation_id = _resolve_current_user_agent_debug_conversation_id(
        current_tenant_id=current_tenant_id,
        current_user=current_user,
        app_model=app_model,
        agent_id=agent_id,
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

    return _generate_chat_message_response(
        current_user=current_user,
        app_model=app_model,
        args=args,
        streaming=True,
    )


def _generate_chat_message_response(
    *,
    current_user: Account,
    app_model: App,
    args: dict[str, Any],
    streaming: bool,
):
    try:
        response = AppGenerateService.generate(
            app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.DEBUGGER, streaming=streaming
        )

        return helper.compact_generate_response(response)
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
    except ValueError as e:
        raise e
    except Exception as e:
        logger.exception("internal server error.")
        raise InternalServerError()


def _stop_chat_message(*, current_user_id: str, app_model: App, task_id: str):
    AppTaskService.stop_task(
        task_id=task_id,
        invoke_from=InvokeFrom.DEBUGGER,
        user_id=current_user_id,
        app_mode=AppMode.value_of(app_model.mode),
    )

    return {"result": "success"}, 200
