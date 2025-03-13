from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.regex.tools.regex_extract import RegexExpressionTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class RegexProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            RegexExpressionTool().invoke(
                user_id="",
                tool_parameters={
                    "content": "1+(2+3)*4",
                    "expression": r"(\d+)",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
