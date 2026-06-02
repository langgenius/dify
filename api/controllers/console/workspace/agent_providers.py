from flask_restx import Resource, fields

from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from graphon.model_runtime.utils.encoders import jsonable_encoder
from libs.login import login_required
from models import Account
from services.agent_service import AgentService


@console_ns.route("/workspaces/current/agent-providers")
class AgentProviderListApi(Resource):
    @console_ns.doc("list_agent_providers")
    @console_ns.doc(description="Get list of available agent providers")
    @console_ns.response(
        200,
        "Success",
        fields.List(fields.Raw(description="Agent provider information")),
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        return jsonable_encoder(AgentService.list_agent_providers(current_user.id, current_tenant_id))


@console_ns.route("/workspaces/current/agent-provider/<path:provider_name>")
class AgentProviderApi(Resource):
    @console_ns.doc("get_agent_provider")
    @console_ns.doc(description="Get specific agent provider details")
    @console_ns.doc(params={"provider_name": "Agent provider name"})
    @console_ns.response(
        200,
        "Success",
        fields.Raw(description="Agent provider details"),
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account, provider_name: str):
        return jsonable_encoder(AgentService.get_agent_provider(current_user.id, current_tenant_id, provider_name))
