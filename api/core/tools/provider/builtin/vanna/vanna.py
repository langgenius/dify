from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.vanna.tools.vanna import VannaTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class VannaProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            VannaTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "model": "chinook",
                    "db_type": "SQLite",
                    "url": "https://vanna.ai/Chinook.sqlite",
                    "query": "What are the top 10 customers by sales?",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
