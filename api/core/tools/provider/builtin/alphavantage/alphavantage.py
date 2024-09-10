from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.alphavantage.tools.query_stock import QueryStockTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AlphaVantageProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            QueryStockTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "code": "AAPL",  # Apple Inc.
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
