"""Workflow Copilot console API.

Multi-turn, memory-backed sibling of ``/workflow-generate``. Where the latter
is a single-shot cmd+k generation, this endpoint threads a persistent
conversation (stored in ``workflow_copilot_*`` tables) so the in-editor copilot
panel can refine a graph across turns with compressed memory.

Registration is import-driven: this module is listed in
``controllers.console.__init__.RESOURCE_MODULES`` so its route decorators run.
Errors are mapped to the same envelope as ``/rule-generate``.
"""

from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, RootModel

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.wraps import account_initialization_required, setup_required, with_current_tenant_id
from core.app.app_config.entities import ModelConfig
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeError
from libs.login import current_user, login_required
from services.workflow_copilot_service import WorkflowCopilotService

# Mirrors the generator's instruction cap; keeps a single oversized message
# from blowing the planner context before it ever reaches the LLM.
_MAX_MESSAGE_LENGTH = 10_000


class WorkflowCopilotPayload(BaseModel):
    """Body for ``POST /console/api/workflow-copilot``."""

    app_id: str = Field(..., description="Workflow app id the copilot is editing")
    conversation_id: str | None = Field(default=None, description="Existing conversation id; null starts a new one")
    mode: str = Field(default="workflow", description="Target app mode: workflow | advanced-chat")
    message: str = Field(
        ...,
        min_length=1,
        max_length=_MAX_MESSAGE_LENGTH,
        description="User instruction for this turn",
    )
    model_config_data: ModelConfig = Field(..., alias="model_config", description="Model configuration")
    current_graph: dict | None = Field(default=None, description="Live canvas graph to refine; omit for create")
    context_node_ids: list[str] = Field(
        default_factory=list,
        description="Node ids the user pinned as focus context; resolved to full structure server-side",
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class CopilotResponse(RootModel[Any]):
    root: Any


register_schema_models(console_ns, WorkflowCopilotPayload, ModelConfig)
register_response_schema_models(console_ns, CopilotResponse)


@console_ns.route("/workflow-copilot")
class WorkflowCopilotApi(Resource):
    @console_ns.doc("workflow_copilot_generate")
    @console_ns.doc(description="Multi-turn workflow generation with persistent, compressed memory")
    @console_ns.expect(console_ns.models[WorkflowCopilotPayload.__name__])
    @console_ns.response(200, "Generated", console_ns.models[CopilotResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(402, "Provider quota exceeded")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        args = WorkflowCopilotPayload.model_validate(console_ns.payload)
        mode = "advanced-chat" if args.mode == "advanced-chat" else "workflow"

        try:
            conversation_id, result = WorkflowCopilotService.generate(
                tenant_id=current_tenant_id,
                app_id=args.app_id,
                account_id=current_user.id,
                conversation_id=args.conversation_id,
                mode=mode,
                message=args.message,
                model_config=args.model_config_data,
                current_graph=args.current_graph,
                context_node_ids=args.context_node_ids,
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)

        return {
            "conversation_id": conversation_id,
            "reply": result.get("message", ""),
            "graph": result.get("graph"),
            "error": result.get("error", ""),
            "errors": result.get("errors", []),
        }


@console_ns.route("/workflow-copilot/<string:conversation_id>/messages")
class WorkflowCopilotMessagesApi(Resource):
    @console_ns.doc("workflow_copilot_messages")
    @console_ns.doc(description="List messages of a copilot conversation for panel reload")
    @console_ns.response(200, "Messages", console_ns.models[CopilotResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, conversation_id: str):
        messages = WorkflowCopilotService.list_messages(
            tenant_id=current_tenant_id,
            conversation_id=conversation_id,
        )
        return {
            "conversation_id": conversation_id,
            "messages": [
                {"id": m.id, "role": m.role, "content": m.content, "created_at": int(m.created_at.timestamp())}
                for m in messages
            ],
        }


@console_ns.route("/workflow-copilot/conversations")
class WorkflowCopilotConversationsApi(Resource):
    @console_ns.doc("workflow_copilot_conversations")
    @console_ns.doc(description="List the current account's copilot conversations for an app")
    @console_ns.response(200, "Conversations", console_ns.models[CopilotResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        app_id = request.args.get("app_id", type=str)
        if not app_id:
            return {"conversations": []}
        conversations = WorkflowCopilotService.list_conversations(
            tenant_id=current_tenant_id,
            app_id=app_id,
            account_id=current_user.id,
        )
        return {
            "conversations": [
                {
                    "id": c.id,
                    "title": c.title or "",
                    "updated_at": int(c.updated_at.timestamp()),
                }
                for c in conversations
            ],
        }


@console_ns.route("/workflow-copilot/<string:conversation_id>")
class WorkflowCopilotConversationApi(Resource):
    @console_ns.doc("workflow_copilot_delete_conversation")
    @console_ns.doc(description="Delete a copilot conversation and its messages")
    @console_ns.response(204, "Deleted")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, conversation_id: str):
        WorkflowCopilotService.delete_conversation(
            tenant_id=current_tenant_id,
            conversation_id=conversation_id,
        )
        return "", 204
