from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.helper import uuid_value
from libs.login import login_required
from models.model import AppMode
from services.agent_service import AgentService


class AgentLogApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    def get(self, app_model):
        """Get agent logs"""
        parser = reqparse.RequestParser()
        parser.add_argument('message_id', type=uuid_value, required=True, location='args')
        parser.add_argument('conversation_id', type=uuid_value, required=True, location='args')

        args = parser.parse_args()

        return AgentService.get_agent_logs(
            app_model,
            args['conversation_id'],
            args['message_id']
        )
    
api.add_resource(AgentLogApi, '/apps/<uuid:app_id>/agent/logs')