import json
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class OpenweatherTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        city = tool_parameters.get("city", "")
        if not city:
            return self.create_text_message("Please tell me your city")
        if "api_key" not in self.runtime.credentials or not self.runtime.credentials.get("api_key"):
            return self.create_text_message("OpenWeather API key is required.")

        units = tool_parameters.get("units", "metric")
        lang = tool_parameters.get("lang", "zh_cn")
        try:
            # request URL
            url = "https://api.openweathermap.org/data/2.5/weather"

            # request params
            params = {
                "q": city,
                "appid": self.runtime.credentials.get("api_key"),
                "units": units,
                "lang": lang,
            }
            response = requests.get(url, params=params)

            if response.status_code == 200:
                data = response.json()
                return self.create_text_message(
                    self.summary(user_id=user_id, content=json.dumps(data, ensure_ascii=False))
                )
            else:
                error_message = {
                    "error": f"failed:{response.status_code}",
                    "data": response.text,
                }
                # return error
                return json.dumps(error_message)

        except Exception as e:
            return self.create_text_message("Openweather API Key is invalid. {}".format(e))
