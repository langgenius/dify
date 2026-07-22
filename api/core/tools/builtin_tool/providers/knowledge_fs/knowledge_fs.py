from typing import Any, override

from core.tools.builtin_tool.provider import BuiltinToolProviderController


class KnowledgeFSProvider(BuiltinToolProviderController):
    @override
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        _ = (user_id, credentials)
