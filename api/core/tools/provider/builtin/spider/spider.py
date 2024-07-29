from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.spider.spiderApp import Spider
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class SpiderProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            app = Spider(api_key=credentials["spider_api_key"])
            app.scrape_url(url="https://spider.cloud")
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
