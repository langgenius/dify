from flask_restx import Resource, fields

from controllers.console import api, console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.login import current_account_with_tenant, login_required
from services.agent_service import AgentService


@console_ns.route("/workspaces/current/agent-providers")
class AgentProviderListApi(Resource):
    @api.doc("list_agent_providers")
    @api.doc(description="Get list of available agent providers")
    @api.response(
        200,
        "Success",
        fields.List(fields.Raw(description="Agent provider information")),
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        user = current_user

        user_id = user.id
        tenant_id = current_tenant_id

        return jsonable_encoder(AgentService.list_agent_providers(user_id, tenant_id))


@console_ns.route("/workspaces/current/agent-provider/<path:provider_name>")
class AgentProviderApi(Resource):
    @api.doc("get_agent_provider")
    @api.doc(description="Get specific agent provider details")
    @api.doc(params={"provider_name": "Agent provider name"})
    @api.response(
        200,
        "Success",
        fields.Raw(description="Agent provider details"),
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_name: str):
        current_user, current_tenant_id = current_account_with_tenant()
        return jsonable_encoder(AgentService.get_agent_provider(current_user.id, current_tenant_id, provider_name))
