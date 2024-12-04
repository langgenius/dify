from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.aliyun.tools.eas import EasTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController

class AliYunProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            EasTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "query": "misaka mikoto",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        