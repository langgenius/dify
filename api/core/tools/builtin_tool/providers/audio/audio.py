from typing import Any

from core.tools.builtin_tool.provider import BuiltinToolProviderController


class AudioToolProvider(BuiltinToolProviderController):
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        pass
