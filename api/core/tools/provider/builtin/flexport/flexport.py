from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.flexport.tools.flexport_graphql import FlexportGrpahqlTool
from core.tools.provider.builtin.flexport.tools.flexport_grpc import FlexportGrpcTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class FlexportProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            # Validate gRPC tool
            grpc_tool = FlexportGrpcTool(credentials=credentials)
            grpc_tool.invoke(
                user_id="",
                tool_parameters={
                    "host": "localhost:50051",
                    "service": "flexport.actionlog.action.v1beta1.ActionService",
                    "method": "GetAction",
                    "method_parameters": '{"id": "test"}',
                },
            )

            # Validate GraphQL tool
            graphql_tool = FlexportGrpahqlTool(credentials=credentials)
            graphql_tool.invoke(
                user_id="",
                tool_parameters={"query": "test", "result_type": "link"},
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
