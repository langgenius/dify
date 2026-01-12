from flask_restx import Resource

from controllers.cli_api import cli_api_ns
from controllers.cli_api.plugin.wraps import get_user_tenant, plugin_data
from controllers.cli_api.wraps import cli_api_only
from controllers.console.wraps import setup_required
from core.file.helpers import get_signed_file_url_for_plugin
from core.plugin.backwards_invocation.app import PluginAppBackwardsInvocation
from core.plugin.backwards_invocation.base import BaseBackwardsInvocationResponse
from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.backwards_invocation.tool import PluginToolBackwardsInvocation
from core.plugin.entities.request import (
    RequestInvokeApp,
    RequestInvokeLLM,
    RequestInvokeTool,
    RequestRequestUploadFile,
)
from core.tools.entities.tool_entities import ToolProviderType
from libs.helper import length_prefixed_response
from models import Account, Tenant
from models.model import EndUser


@cli_api_ns.route("/invoke/llm")
class CliInvokeLLMApi(Resource):
    @get_user_tenant
    @setup_required
    @cli_api_only
    @plugin_data(payload_type=RequestInvokeLLM)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeLLM):
        def generator():
            response = PluginModelBackwardsInvocation.invoke_llm(user_model.id, tenant_model, payload)
            return PluginModelBackwardsInvocation.convert_to_event_stream(response)

        return length_prefixed_response(0xF, generator())


@cli_api_ns.route("/invoke/tool")
class CliInvokeToolApi(Resource):
    @get_user_tenant
    @setup_required
    @cli_api_only
    @plugin_data(payload_type=RequestInvokeTool)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeTool):
        def generator():
            return PluginToolBackwardsInvocation.convert_to_event_stream(
                PluginToolBackwardsInvocation.invoke_tool(
                    tenant_id=tenant_model.id,
                    user_id=user_model.id,
                    tool_type=ToolProviderType.value_of(payload.tool_type),
                    provider=payload.provider,
                    tool_name=payload.tool,
                    tool_parameters=payload.tool_parameters,
                    credential_id=payload.credential_id,
                ),
            )

        return length_prefixed_response(0xF, generator())


@cli_api_ns.route("/invoke/app")
class CliInvokeAppApi(Resource):
    @get_user_tenant
    @setup_required
    @cli_api_only
    @plugin_data(payload_type=RequestInvokeApp)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestInvokeApp):
        response = PluginAppBackwardsInvocation.invoke_app(
            app_id=payload.app_id,
            user_id=user_model.id,
            tenant_id=tenant_model.id,
            conversation_id=payload.conversation_id,
            query=payload.query,
            stream=payload.response_mode == "streaming",
            inputs=payload.inputs,
            files=payload.files,
        )

        return length_prefixed_response(0xF, PluginAppBackwardsInvocation.convert_to_event_stream(response))


@cli_api_ns.route("/upload/file/request")
class CliUploadFileRequestApi(Resource):
    @get_user_tenant
    @setup_required
    @cli_api_only
    @plugin_data(payload_type=RequestRequestUploadFile)
    def post(self, user_model: Account | EndUser, tenant_model: Tenant, payload: RequestRequestUploadFile):
        # generate signed url
        url = get_signed_file_url_for_plugin(
            filename=payload.filename,
            mimetype=payload.mimetype,
            tenant_id=tenant_model.id,
            user_id=user_model.id,
        )
        return BaseBackwardsInvocationResponse(data={"url": url}).model_dump()


@cli_api_ns.route("/fetch/tools/list")
class CliFetchToolsListApi(Resource):
    @get_user_tenant
    @setup_required
    @cli_api_only
    def post(self, user_model: Account | EndUser, tenant_model: Tenant):
        from sqlalchemy.orm import Session

        from extensions.ext_database import db
        from services.tools.api_tools_manage_service import ApiToolManageService
        from services.tools.builtin_tools_manage_service import BuiltinToolManageService
        from services.tools.mcp_tools_manage_service import MCPToolManageService
        from services.tools.workflow_tools_manage_service import WorkflowToolManageService

        providers = []

        # Get builtin tools
        builtin_providers = BuiltinToolManageService.list_builtin_tools(user_model.id, tenant_model.id)
        for provider in builtin_providers:
            providers.append(provider.to_dict())

        # Get API tools
        api_providers = ApiToolManageService.list_api_tools(tenant_model.id)
        for provider in api_providers:
            providers.append(provider.to_dict())

        # Get workflow tools
        workflow_providers = WorkflowToolManageService.list_tenant_workflow_tools(user_model.id, tenant_model.id)
        for provider in workflow_providers:
            providers.append(provider.to_dict())

        # Get MCP tools
        with Session(db.engine) as session:
            mcp_service = MCPToolManageService(session)
            mcp_providers = mcp_service.list_providers(tenant_id=tenant_model.id, for_list=True)
            for provider in mcp_providers:
                providers.append(provider.to_dict())

        return BaseBackwardsInvocationResponse(data={"providers": providers}).model_dump()
