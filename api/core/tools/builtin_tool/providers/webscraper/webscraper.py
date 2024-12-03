from typing import Any

from core.tools.builtin_tool.provider import BuiltinToolProviderController


class WebscraperProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        pass
