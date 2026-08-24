from typing import Any

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    model_validate,
    rbac_permission_required,
    setup_required,
)
from fields.base import ResponseModel
from libs.helper import uuid_value
from libs.login import login_required
from models.model import App, AppMode
from services.agent_service import AgentService


class AgentLogQuery(BaseModel):
    message_id: str = Field(..., description="Message UUID")
    conversation_id: str = Field(..., description="Conversation UUID")

    @field_validator("message_id", "conversation_id")
    @classmethod
    def validate_uuid(cls, value: str) -> str:
        return uuid_value(value)


class AgentLogMetaResponse(ResponseModel):
    status: str
    executor: str
    start_time: str
    elapsed_time: float | None = None
    total_tokens: int
    agent_mode: str
    iterations: int


class AgentToolCallResponse(ResponseModel):
    status: str
    error: str | None = None
    time_cost: float | int
    tool_name: str
    tool_label: str
    tool_input: dict[str, Any]
    tool_output: dict[str, Any]
    tool_parameters: dict[str, Any]
    tool_icon: Any = Field(default=None)


class AgentIterationLogResponse(ResponseModel):
    tokens: int
    tool_calls: list[AgentToolCallResponse]
    tool_raw: dict[str, Any]
    thought: str | None = None
    created_at: str
    files: list[Any] = Field(default_factory=list)


class AgentLogResponse(ResponseModel):
    meta: AgentLogMetaResponse
    iterations: list[AgentIterationLogResponse]
    files: list[Any] = Field(default_factory=list)


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
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @with_session(write=False)
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    @model_validate(AgentLogQuery)
    def get(self, req_data: AgentLogQuery, session: Session, app_model: App):
        """Get agent logs."""

        return AgentService.get_agent_logs(app_model, req_data.conversation_id, req_data.message_id, session)
