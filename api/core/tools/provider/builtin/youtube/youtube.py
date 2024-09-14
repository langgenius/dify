from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.youtube.tools.videos import YoutubeVideosAnalyticsTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class YahooFinanceProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            YoutubeVideosAnalyticsTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "channel": "TOKYO GIRLS COLLECTION",
                    "start_date": "2020-01-01",
                    "end_date": "2024-12-31",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
