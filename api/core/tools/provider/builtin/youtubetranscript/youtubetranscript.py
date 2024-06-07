from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.youtubetranscript.tools.transcription import YoutubeVideoTranscriptionTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class YoutubeVideoTranscriptionProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            YoutubeVideoTranscriptionTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "link": "https://www.youtube.com/watch?v=abcdefgh",
                    "max_output_length": "1",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        