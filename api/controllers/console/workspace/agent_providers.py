from flask_login import current_user
from flask_restful import Resource

from controllers.console import api
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.login import login_required
from services.agent_service import AgentService


class AgentProviderListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user = current_user

        user_id = user.id
        tenant_id = user.current_tenant_id

        return jsonable_encoder(AgentService.list_agent_providers(user_id, tenant_id))


class AgentProviderApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_name: str):
        user = current_user
        user_id = user.id
        tenant_id = user.current_tenant_id
        return jsonable_encoder(AgentService.get_agent_provider(user_id, tenant_id, provider_name))


api.add_resource(AgentProviderListApi, "/workspaces/current/agent-providers")
api.add_resource(AgentProviderApi, "/workspaces/current/agent-provider/<path:provider_name>")
