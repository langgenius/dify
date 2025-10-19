from flask_restx import Resource, fields, reqparse

from controllers.console import api, console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from libs.helper import uuid_value
from libs.login import login_required
from models.model import AppMode
from services.agent_service import AgentService


@console_ns.route("/apps/<uuid:app_id>/agent/logs")
class AgentLogApi(Resource):
    @api.doc("get_agent_logs")
    @api.doc(description="Get agent execution logs for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.parser()
        .add_argument("message_id", type=str, required=True, location="args", help="Message UUID")
        .add_argument("conversation_id", type=str, required=True, location="args", help="Conversation UUID")
    )
    @api.response(200, "Agent logs retrieved successfully", fields.List(fields.Raw(description="Agent log entries")))
    @api.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    def get(self, app_model):
        """Get agent logs"""
        parser = (
            reqparse.RequestParser()
            .add_argument("message_id", type=uuid_value, required=True, location="args")
            .add_argument("conversation_id", type=uuid_value, required=True, location="args")
        )

        args = parser.parse_args()

        return AgentService.get_agent_logs(app_model, args["conversation_id"], args["message_id"])
