import urllib.parse

import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class GaodeProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            if 'api_key' not in credentials or not credentials.get('api_key'):
                raise ToolProviderCredentialValidationError("Wpush API key is required.")

            try:
                response = requests.get(url="https://api.wpush.cn/api/v1/send/?apikey={apikey}&title=Dify测试消息"
                                            "".format(apikey=credentials.get('api_key')))
                if response.status_code == 200 and (response.json()).get('code') == 0:
                    pass
                else:
                    raise ToolProviderCredentialValidationError((response.json()).get('message'))
            except Exception as e:
                raise ToolProviderCredentialValidationError("Wpush API Key is invalid. {}".format(e))
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
