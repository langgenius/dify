from typing import Literal

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    account_initialization_required,
    model_validate,
    rbac_permission_required,
    setup_required,
)
from core.tools.entities.tool_entities import EmojiIconDict
from fields.base import ResponseModel
from graphon.file import FileTransferMethod, FileType
from libs.helper import dump_response, uuid_value
from libs.login import login_required
from models.enums import MessageFileBelongsTo
from models.model import App, AppMode
from services.agent_service import AgentService

type AgentLogJsonValue = str | int | float | bool | None | list[AgentLogJsonValue] | dict[str, AgentLogJsonValue]


class AgentLogQuery(BaseModel):
    message_id: str = Field(..., description="Message UUID")
    conversation_id: str = Field(..., description="Conversation UUID")

    @field_validator("message_id", "conversation_id")
    @classmethod
    def validate_uuid(cls, value: str) -> str:
        return uuid_value(value)


class AgentLogMetaResponse(ResponseModel):
    status: Literal["success"]
    executor: str
    start_time: str
    elapsed_time: float
    total_tokens: int
    agent_mode: str | None
    iterations: int


class AgentToolCallResponse(ResponseModel):
    status: Literal["success", "error"]
    error: str | None
    time_cost: float
    tool_name: str
    tool_label: str | dict[str, str]
    tool_input: AgentLogJsonValue
    tool_output: AgentLogJsonValue
    tool_parameters: dict[str, AgentLogJsonValue]
    tool_icon: str | EmojiIconDict


class AgentToolRawResponse(ResponseModel):
    inputs: str | None
    outputs: str | None


class AgentIterationLogResponse(ResponseModel):
    tokens: int | None
    tool_calls: list[AgentToolCallResponse]
    tool_raw: AgentToolRawResponse
    thought: str | None
    created_at: str
    files: list[str]


class AgentLogFileResponse(ResponseModel):
    id: str
    type: FileType
    transfer_method: FileTransferMethod
    remote_url: str | None
    reference: str | None
    filename: str | None
    extension: str | None
    mime_type: str | None
    size: int
    dify_model_identity: Literal["__dify__file__"]
    related_id: str | None
    url: str | None
    belongs_to: MessageFileBelongsTo | None
    upload_file_id: str | None


class AgentLogResponse(ResponseModel):
    meta: AgentLogMetaResponse
    iterations: list[AgentIterationLogResponse]
    files: list[AgentLogFileResponse]


register_response_schema_models(console_ns, AgentLogResponse)


@console_ns.route("/apps/<uuid:app_id>/agent/logs")
class AgentLogApi(Resource):
    @console_ns.doc("get_agent_logs")
    @console_ns.doc(description="Get agent execution logs for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(AgentLogQuery))
    @console_ns.response(200, "Agent logs retrieved successfully", console_ns.models[AgentLogResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()))
    @with_session(write=False)
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    @model_validate(AgentLogQuery)
    def get(self, req_data: AgentLogQuery, session: Session, app_model: App):
        """Get agent logs."""

        result = AgentService.get_agent_logs(app_model, req_data.conversation_id, req_data.message_id, session)
        return dump_response(AgentLogResponse, result)
