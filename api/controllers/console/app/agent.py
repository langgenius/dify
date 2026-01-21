from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field, field_validator

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from libs.helper import uuid_value
from libs.login import login_required
from models.model import AppMode
from services.agent_service import AgentService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class AgentLogQuery(BaseModel):
    message_id: str = Field(..., description="Message UUID")
    conversation_id: str = Field(..., description="Conversation UUID")

    @field_validator("message_id", "conversation_id")
    @classmethod
    def validate_uuid(cls, value: str) -> str:
        return uuid_value(value)


console_ns.schema_model(
    AgentLogQuery.__name__, AgentLogQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)


@console_ns.route("/apps/<uuid:app_id>/agent/logs")
class AgentLogApi(Resource):
    @console_ns.doc("get_agent_logs")
    @console_ns.doc(description="Get agent execution logs for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AgentLogQuery.__name__])
    @console_ns.response(
        200, "Agent logs retrieved successfully", fields.List(fields.Raw(description="Agent log entries"))
    )
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    def get(self, app_model):
        """Get agent logs"""
        args = AgentLogQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        return AgentService.get_agent_logs(app_model, args.conversation_id, args.message_id)
