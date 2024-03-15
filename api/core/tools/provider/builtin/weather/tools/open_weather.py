import json
from typing import Any, Union
import requests
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

class OpenweatherTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[
        ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        city = tool_parameters.get('city', '')
        if not city:
            return self.create_text_message('Please tell me your city')

        if 'api_key' not in self.runtime.credentials or not self.runtime.credentials.get('api_key'):
            return self.create_text_message("OpenWeather API key is required.")

        units = tool_parameters.get('units','metric')
        lang = tool_parameters.get('lang','zh_cn') 
        try:
            """
                使用OpenWeather API查询指定城市的实时天气信息，并将结果以JSON格式的字符串返回。

                参数:
                city (str): 必填参数。需要查询天气的城市，默认为北京,如果输入的地区是中国的中文字符，就换成对应的英文名称，如北京市，正确的输入应该为"beijing"
                units (str): 计量单位，默认为摄氏度（metric）。
                language (str): 输出信息的语言，默认为简体中文（zh_cn）。
                api_key (str): 用于访问OpenWeather的API密钥。

                返回:
                str: 查询到的天气信息，以JSON格式的字符串返回。如果查询失败，返回包含错误信息的JSON格式字符串。
                """
            # 构建请求的URL
            url = "https://api.openweathermap.org/data/2.5/weather"

            # 设置查询参数
            params = {
                "q": city,
                "appid": self.runtime.credentials.get('api_key'),
                "units": units,
                "lang": lang
            }

            # 发送GET请求
            response = requests.get(url, params=params)

            # 检查响应状态
            if response.status_code == 200:
                # 解析响应数据， #将结果转换为JSON格式的字符串
                data = response.json()
                return self.create_text_message(
                    self.summary(user_id=user_id, content=json.dumps(data, ensure_ascii=False)))
            else:
                # 创建一个错误消息
                error_message = {
                    "错误": f"查询失败，状态码：{response.status_code}",
                    "响应数据": response.text
                }

                # 将错误消息转换为JSON格式的字符串
                return json.dumps(error_message)

        except Exception as e:
            return self.create_text_message("Openweather API Key is invalid. {}".format(e))
