from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.scrapegraph.tools.scrape import ScrapeGraphTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class ScrapeGraphProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            ScrapeGraphTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={"url": "https://example.com", "prompt": "Extract the main heading, description, and summary of the webpage"},
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
