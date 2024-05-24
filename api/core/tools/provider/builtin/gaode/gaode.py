import urllib.parse

import requests

from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class GaodeProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            if 'api_key' not in credentials or not credentials.get('api_key'):
                raise ToolProviderCredentialValidationError("Gaode API key is required.")

            try:
                response = requests.get(url="https://restapi.amap.com/v3/geocode/geo?address={address}&key={apikey}"
                                            "".format(address=urllib.parse.quote('广东省广州市天河区广州塔'),
                                                      apikey=credentials.get('api_key')))
                if response.status_code == 200 and (response.json()).get('info') == 'OK':
                    pass
                else:
                    raise ToolProviderCredentialValidationError((response.json()).get('info'))
            except Exception as e:
                raise ToolProviderCredentialValidationError("Gaode API Key is invalid. {}".format(e))
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))

    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.UTILITIES, ToolLabelEnum.PRODUCTIVITY, 
            ToolLabelEnum.WEATHER, ToolLabelEnum.TRAVEL
        ]