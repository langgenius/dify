import json
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GaodeRepositoriesTool(BuiltinTool):
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
            return self.create_text_message("Gaode API key is required.")

        try:
            s = requests.session()
            api_domain = "https://restapi.amap.com/v3"
            city_response = s.request(
                method="GET",
                headers={"Content-Type": "application/json; charset=utf-8"},
                url="{url}/config/district?keywords={keywords}&subdistrict=0&extensions=base&key={apikey}".format(
                    url=api_domain, keywords=city, apikey=self.runtime.credentials.get("api_key")
                ),
            )
            City_data = city_response.json()
            if city_response.status_code == 200 and City_data.get("info") == "OK":
                if len(City_data.get("districts")) > 0:
                    CityCode = City_data["districts"][0]["adcode"]
                    weatherInfo_response = s.request(
                        method="GET",
                        url="{url}/weather/weatherInfo?city={citycode}&extensions=all&key={apikey}&output=json".format(
                            url=api_domain, citycode=CityCode, apikey=self.runtime.credentials.get("api_key")
                        ),
                    )
                    weatherInfo_data = weatherInfo_response.json()
                    if weatherInfo_response.status_code == 200 and weatherInfo_data.get("info") == "OK":
                        contents = []
                        if len(weatherInfo_data.get("forecasts")) > 0:
                            for item in weatherInfo_data["forecasts"][0]["casts"]:
                                content = {}
                                content["date"] = item.get("date")
                                content["week"] = item.get("week")
                                content["dayweather"] = item.get("dayweather")
                                content["daytemp_float"] = item.get("daytemp_float")
                                content["daywind"] = item.get("daywind")
                                content["nightweather"] = item.get("nightweather")
                                content["nighttemp_float"] = item.get("nighttemp_float")
                                contents.append(content)
                            s.close()
                            return self.create_text_message(
                                self.summary(user_id=user_id, content=json.dumps(contents, ensure_ascii=False))
                            )
            s.close()
            return self.create_text_message(f"No weather information for {city} was found.")
        except Exception as e:
            return self.create_text_message("Gaode API Key and Api Version is invalid. {}".format(e))
