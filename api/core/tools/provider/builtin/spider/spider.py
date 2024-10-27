from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.spider.spiderApp import Spider
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class SpiderProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            app = Spider(api_key=credentials['spider_api_key'])
            app.scrape_url(url='https://spider.cloud')
        except AttributeError as e:
            # Handle cases where NoneType is not iterable, which might indicate API issues
            if 'NoneType' in str(e) and 'not iterable' in str(e):
                raise ToolProviderCredentialValidationError('API is currently down, try again in 15 minutes', str(e))
            else:
                raise ToolProviderCredentialValidationError('An unexpected error occurred.', str(e))
        except Exception as e:
            raise ToolProviderCredentialValidationError('An unexpected error occurred.', str(e))
