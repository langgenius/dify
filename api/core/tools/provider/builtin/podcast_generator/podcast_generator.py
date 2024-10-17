from typing import Any

import openai

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class PodcastGeneratorProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        tts_service = credentials.get("tts_service")
        api_key = credentials.get("api_key")

        if not tts_service:
            raise ToolProviderCredentialValidationError("TTS service is not specified")

        if not api_key:
            raise ToolProviderCredentialValidationError("API key is missing")

        if tts_service == "openai":
            self._validate_openai_credentials(api_key)
        else:
            raise ToolProviderCredentialValidationError(f"Unsupported TTS service: {tts_service}")

    def _validate_openai_credentials(self, api_key: str) -> None:
        client = openai.OpenAI(api_key=api_key)
        try:
            # We're using a simple API call to validate the credentials
            client.models.list()
        except openai.AuthenticationError:
            raise ToolProviderCredentialValidationError("Invalid OpenAI API key")
        except Exception as e:
            raise ToolProviderCredentialValidationError(f"Error validating OpenAI API key: {str(e)}")
