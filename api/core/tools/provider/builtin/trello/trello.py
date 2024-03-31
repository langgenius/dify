from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.trello.tools.fetch_all_boards import FetchAllBoardsTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class TrelloProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            FetchAllBoardsTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "boards": "open",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))