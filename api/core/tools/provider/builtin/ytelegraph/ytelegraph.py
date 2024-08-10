import time
from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.ytelegraph.tools.ytg_create_page import YTGCreatePage
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class YTelegraphProviderController(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            YTGCreatePage().fork_tool_runtime(runtime={'credentials': credentials}).invoke(
                user_id='',
                tool_parameters={
                    'title': 'My First Page',
                    'content': f'# Hello, Telegraph!\n\nThis is my first Telegraph page using YTelegraph with Dify.\n---Now is {time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())}---',
                    'author_url': 'https://dify.ai',
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))