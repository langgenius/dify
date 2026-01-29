from flask import abort
from flask_restx import Resource
from pydantic import BaseModel

from controllers.cli_api import cli_api_ns
from controllers.cli_api.dify_cli.wraps import get_cli_user_tenant, plugin_data
from controllers.cli_api.wraps import cli_api_only
from controllers.console.wraps import setup_required
from core.app.entities.app_invoke_entities import InvokeFrom
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
from core.sandbox.bash.dify_cli import DifyCliToolConfig
from core.session.cli_api import CliContext
from core.skill.entities import ToolInvocationRequest
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.tool_manager import ToolManager
from libs.helper import length_prefixed_response
from models.account import Account
from models.model import EndUser, Tenant


class FetchToolItem(BaseModel):
    tool_type: str
    tool_provider: str
    tool_name: str
    credential_id: str | None = None


class FetchToolBatchRequest(BaseModel):
    tools: list[FetchToolItem]


@cli_api_ns.route("/invoke/llm")
class CliInvokeLLMApi(Resource):
    @cli_api_only
    @get_cli_user_tenant
    @setup_required
    @plugin_data(payload_type=RequestInvokeLLM)
    def post(
        self,
        user_model: Account | EndUser,
        tenant_model: Tenant,
        payload: RequestInvokeLLM,
        cli_context: CliContext,
    ):
        def generator():
            response = PluginModelBackwardsInvocation.invoke_llm(user_model.id, tenant_model, payload)
            return PluginModelBackwardsInvocation.convert_to_event_stream(response)

        return length_prefixed_response(0xF, generator())


@cli_api_ns.route("/invoke/tool")
class CliInvokeToolApi(Resource):
    @cli_api_only
    @get_cli_user_tenant
    @setup_required
    @plugin_data(payload_type=RequestInvokeTool)
    def post(
        self,
        user_model: Account | EndUser,
        tenant_model: Tenant,
        payload: RequestInvokeTool,
        cli_context: CliContext,
    ):
        tool_type = ToolProviderType.value_of(payload.tool_type)

        request = ToolInvocationRequest(
            tool_type=tool_type,
            provider=payload.provider,
            tool_name=payload.tool,
            credential_id=payload.credential_id,
        )
        if cli_context.tool_access and not cli_context.tool_access.is_allowed(request):
            abort(403, description=f"Access denied for tool: {payload.provider}/{payload.tool}")

        def generator():
            return PluginToolBackwardsInvocation.convert_to_event_stream(
                PluginToolBackwardsInvocation.invoke_tool(
                    tenant_id=tenant_model.id,
                    user_id=user_model.id,
                    tool_type=tool_type,
                    provider=payload.provider,
                    tool_name=payload.tool,
                    tool_parameters=payload.tool_parameters,
                    credential_id=payload.credential_id,
                ),
            )

        return length_prefixed_response(0xF, generator())


@cli_api_ns.route("/invoke/app")
class CliInvokeAppApi(Resource):
    @cli_api_only
    @get_cli_user_tenant
    @setup_required
    @plugin_data(payload_type=RequestInvokeApp)
    def post(
        self,
        user_model: Account | EndUser,
        tenant_model: Tenant,
        payload: RequestInvokeApp,
        cli_context: CliContext,
    ):
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
    @cli_api_only
    @get_cli_user_tenant
    @setup_required
    @plugin_data(payload_type=RequestRequestUploadFile)
    def post(
        self,
        user_model: Account | EndUser,
        tenant_model: Tenant,
        payload: RequestRequestUploadFile,
        cli_context: CliContext,
    ):
        url = get_signed_file_url_for_plugin(
            filename=payload.filename,
            mimetype=payload.mimetype,
            tenant_id=tenant_model.id,
            user_id=user_model.id,
        )
        return BaseBackwardsInvocationResponse(data={"url": url}).model_dump()


@cli_api_ns.route("/fetch/tools/batch")
class CliFetchToolsBatchApi(Resource):
    @cli_api_only
    @get_cli_user_tenant
    @setup_required
    @plugin_data(payload_type=FetchToolBatchRequest)
    def post(
        self,
        user_model: Account | EndUser,
        tenant_model: Tenant,
        payload: FetchToolBatchRequest,
        cli_context: CliContext,
    ):
        tools: list[dict] = []

        for item in payload.tools:
            provider_type = ToolProviderType.value_of(item.tool_type)

            request = ToolInvocationRequest(
                tool_type=provider_type,
                provider=item.tool_provider,
                tool_name=item.tool_name,
                credential_id=item.credential_id,
            )
            if cli_context.tool_access and not cli_context.tool_access.is_allowed(request):
                abort(403, description=f"Access denied for tool: {item.tool_provider}/{item.tool_name}")

            try:
                tool_runtime = ToolManager.get_tool_runtime(
                    tenant_id=tenant_model.id,
                    provider_type=provider_type,
                    provider_id=item.tool_provider,
                    tool_name=item.tool_name,
                    invoke_from=InvokeFrom.AGENT,
                    credential_id=item.credential_id,
                )
                tool_config = DifyCliToolConfig.create_from_tool(tool_runtime)
                tools.append(tool_config.model_dump())
            except Exception:
                continue

        return BaseBackwardsInvocationResponse(data={"tools": tools}).model_dump()
