from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.openai.tools.tts import OpenAITTSTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class OpenAIToolsProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            OpenAITTSTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "text": "Hello world",
                    "voice": "alloy",
                    "model": "tts-1"
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        