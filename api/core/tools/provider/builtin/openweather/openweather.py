import requests

from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


def query_weather(city="Beijing", units="metric", language="zh_cn", api_key=None):

    url = "https://api.openweathermap.org/data/2.5/weather"
    params = {"q": city, "appid": api_key, "units": units, "lang": language}

    return requests.get(url, params=params)


class OpenweatherProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            if "api_key" not in credentials or not credentials.get("api_key"):
                raise ToolProviderCredentialValidationError(
                    "Open weather API key is required."
                )
            apikey = credentials.get("api_key")
            try:
                response = query_weather(api_key=apikey)
                if response.status_code == 200:
                    pass
                else:
                    raise ToolProviderCredentialValidationError(
                        (response.json()).get("info")
                    )
            except Exception as e:
                raise ToolProviderCredentialValidationError(
                    "Open weather API Key is invalid. {}".format(e)
                )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))

    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.WEATHER
        ]