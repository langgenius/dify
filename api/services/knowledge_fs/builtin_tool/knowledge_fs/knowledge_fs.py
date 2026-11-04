from os import path
from typing import Any, override

from core.tools.builtin_tool.provider import BuiltinToolProviderController


class KnowledgeFSProvider(BuiltinToolProviderController):
    @property
    @override
    def provider_directory(self) -> str:
        return path.dirname(path.realpath(__file__))

    @override
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        _ = (user_id, credentials)
