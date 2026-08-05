from typing import Any, override

from core.tools.builtin_tool.provider import BuiltinToolProviderController


class WikiPediaProvider(BuiltinToolProviderController):
    @override
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]):
        pass
