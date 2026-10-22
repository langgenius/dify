from flask_restx import Resource
from pydantic import RootModel

from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from core.plugin.entities.plugin_daemon import PluginAgentProviderEntity
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from services.agent_provider_service import AgentProviderUnavailableError


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
    @console_account_admission()
    def get(self, request_context: RequestContext):
        providers = application_services().agent_providers.list_providers(request_context)
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
    @console_account_admission()
    def get(self, request_context: RequestContext, provider_name: str):
        try:
            provider = application_services().agent_providers.get_provider(request_context, provider_name)
        except AgentProviderUnavailableError as error:
            # Preserve the legacy ValueError -> 400 invalid_param contract.
            raise ValueError(str(error)) from error
        return dump_response(AgentProviderResponse, provider)
