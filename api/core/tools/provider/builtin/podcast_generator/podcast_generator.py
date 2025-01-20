from typing import Any

from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class PodcastGeneratorProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        # No credentials validation needed as models are selected in the tool
        pass
