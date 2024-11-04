from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.dalle.tools.dalle2 import DallE2Tool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class FileExtractorProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        pass
