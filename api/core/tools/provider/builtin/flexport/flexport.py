from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.flexport.tools.flexport_graphql import FlexportGrpahqlTool
from core.tools.provider.builtin.flexport.tools.flexport_grpc import FlexportGrpcTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class FlexportProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            
            FlexportGrpcTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "proto_content": "test",
                    "service": "test",
                    "method": "test",
                    "method_parameters": "test", 
                },
            )

            FlexportGrpahqlTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "query": "test",
                    "result_type": "link"
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))