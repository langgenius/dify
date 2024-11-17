from typing import Any, Dict
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError

from core.tools.provider.builtin.transcript.tools.transcript import YouTubeTranscriptTool

class YouTubeTranscriptProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        """
        No credentials needed for YouTube Transcript API
        """
        pass 