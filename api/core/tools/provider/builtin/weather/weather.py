import urllib.parse

import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController

def query_weather(city="Beijing", units="metric", language="zh_cn",api_key=None):
    # 构建请求URL
    url = "https://api.openweathermap.org/data/2.5/weather"
    

    # 设置查询参数
    params = {
        "q": city,  # 查询的城市，默认为北京
        "appid": api_key,  # API密钥
        "units": units,  # 测量单位，默认为摄氏度
        "lang": language  # 输出语言，默认为简体中文
    }

    # 发送GET请求
    return requests.get(url, params=params)

   


class OpenweatherProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            if 'api_key' not in credentials or not credentials.get('api_key'):
                raise ToolProviderCredentialValidationError("Openweather API key is required.")
            apikey=credentials.get('api_key')
            try:
                response = query_weather(api_key=apikey)
                if response.status_code == 200 :
                    pass
                else:
                    raise ToolProviderCredentialValidationError((response.json()).get('info'))
            except Exception as e:
                raise ToolProviderCredentialValidationError("Openweather API Key is invalid. {}".format(e))
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
