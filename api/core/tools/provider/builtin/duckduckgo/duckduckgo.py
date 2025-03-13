from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.duckduckgo.tools.ddgo_search import DuckDuckGoSearchTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class DuckDuckGoProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            DuckDuckGoSearchTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "query": "John Doe",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
