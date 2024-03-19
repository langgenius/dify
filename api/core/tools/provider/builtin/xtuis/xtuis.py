from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.xtuis.tools.xtuis_push import xtuis_push_tool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class XtuisProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            xtuis_push_tool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "title": "mytitle",
                    "desp": "mydesp"
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
