from flask_restx import Resource
from pydantic import RootModel

from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.plugin.entities.plugin_daemon import PluginAgentProviderEntity
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from models import Account
from services.agent_service import AgentService


class AgentProviderResponse(PluginAgentProviderEntity, ResponseModel):
    pass


class AgentProviderListResponse(RootModel[list[AgentProviderResponse]]):
    pass


register_response_schema_models(console_ns, AgentProviderListResponse, AgentProviderResponse)


@console_ns.route("/workspaces/current/agent-providers")
class AgentProviderListApi(Resource):
    @console_ns.doc("list_agent_providers")
    @console_ns.doc(description="Get list of available agent providers")
    @console_ns.response(
        200,
        "Success",
        console_ns.models[AgentProviderListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        providers = AgentService.list_agent_providers(current_user.id, current_tenant_id)
        return AgentProviderListResponse.model_validate(providers, from_attributes=True).model_dump(mode="json")


@console_ns.route("/workspaces/current/agent-provider/<path:provider_name>")
class AgentProviderApi(Resource):
    @console_ns.doc("get_agent_provider")
    @console_ns.doc(description="Get specific agent provider details")
    @console_ns.doc(params={"provider_name": "Agent provider name"})
    @console_ns.response(
        200,
        "Success",
        console_ns.models[AgentProviderResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account, provider_name: str):
        provider = AgentService.get_agent_provider(current_user.id, current_tenant_id, provider_name)
        return dump_response(AgentProviderResponse, provider)
