from typing import Any


from core.tools.provider.builtin_tool_provider import (
    BuiltinToolProviderController,
)


class GrowiProvider(BuiltinToolProviderController):
    def validate_credentials(self, credentials: dict[str, Any]) -> None:
        return None
