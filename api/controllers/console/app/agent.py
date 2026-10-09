from typing import Any
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response, uuid_value
from machinery.context import RequestContext
from services.agent.log_contracts import AgentLogAppNotFoundError


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
    tool_input: Any
    tool_output: Any
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
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())])
    @model_validate(AgentLogQuery)
    def get(self, req_data: AgentLogQuery, request_context: RequestContext, app_id: UUID):
        """Get agent logs."""

        try:
            result = application_services().agent_apps.logs.get(
                request_context,
                app_id=str(app_id),
                conversation_id=req_data.conversation_id,
                message_id=req_data.message_id,
            )
        except AgentLogAppNotFoundError as error:
            raise AppNotFoundError() from error
        return dump_response(AgentLogResponse, result)
