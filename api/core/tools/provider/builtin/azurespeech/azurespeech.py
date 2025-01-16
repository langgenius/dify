from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.azurespeech.tools.tts import AzureTTSTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AzureSpeechProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            AzureTTSTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "text": "This is a test text",
                    "speech_synthesis_voice_name": "en-US-AvaMultilingualNeural",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
