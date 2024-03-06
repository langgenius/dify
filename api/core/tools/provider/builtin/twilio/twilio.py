from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class TwilioProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            """
            SendMessageTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "message": "Credential validation message",
                    "to_number": "+14846624384",
                },
            )
            """
            pass
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
