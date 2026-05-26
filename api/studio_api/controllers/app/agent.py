from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field, field_validator

from controllers.common.schema import register_schema_models
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from libs.helper import uuid_value
from libs.login import login_required
from models.model import AppMode
from services.agent_service import AgentService
from studio_api.blueprint import studio_ns


class AgentLogQuery(BaseModel):
    message_id: str = Field(..., description="Message UUID")
    conversation_id: str = Field(..., description="Conversation UUID")

    @field_validator("message_id", "conversation_id")
    @classmethod
    def validate_uuid(cls, value: str) -> str:
        return uuid_value(value)


register_schema_models(studio_ns, AgentLogQuery)


@studio_ns.route("/apps/<uuid:app_id>/agent/logs")
class AgentLogApi(Resource):
    @studio_ns.doc("get_agent_logs")
    @studio_ns.doc(description="Get agent execution logs for an application")
    @studio_ns.doc(params={"app_id": "Application ID"})
    @studio_ns.expect(studio_ns.models[AgentLogQuery.__name__])
    @studio_ns.response(
        200, "Agent logs retrieved successfully", fields.List(fields.Raw(description="Agent log entries"))
    )
    @studio_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    def get(self, app_model):
        """Get agent logs"""
        args = AgentLogQuery.model_validate(request.args.to_dict(flat=True))

        return AgentService.get_agent_logs(app_model, args.conversation_id, args.message_id)
