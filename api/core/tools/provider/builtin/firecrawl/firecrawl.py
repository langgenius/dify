from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.firecrawl.tools.crawl import CrawlTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class FirecrawlProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            # Example validation using the Crawl tool
            CrawlTool().fork_tool_runtime(
                runtime={"credentials": credentials}
            ).invoke(
                user_id='',
                tool_parameters={
                    "url": "https://example.com",
                    "includes": '', 
                    "excludes": '', 
                    "limit": 1,
                    "onlyMainContent": True,
                }
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        