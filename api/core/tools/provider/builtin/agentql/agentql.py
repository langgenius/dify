from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.agentql.tools.query_data import QueryDataTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AgentQlProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            QueryDataTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={"url": "https://scrapeme.live/shop", "query": "{ title }"},
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError() from e
