import json
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class PoiSearchTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        geocoder_base_url = "http://api.tianditu.gov.cn/geocoder"
        base_url = "http://api.tianditu.gov.cn/v2/search"

        keyword = tool_parameters.get("keyword", "")
        if not keyword:
            return self.create_text_message("Invalid parameter keyword")

        baseAddress = tool_parameters.get("baseAddress", "")
        if not baseAddress:
            return self.create_text_message("Invalid parameter baseAddress")

        tk = self.runtime.credentials["tianditu_api_key"]

        base_coords = requests.get(
            geocoder_base_url
            + "?ds="
            + json.dumps(
                {
                    "keyWord": baseAddress,
                },
                ensure_ascii=False,
            )
            + "&tk="
            + tk
        ).json()

        params = {
            "keyWord": keyword,
            "queryRadius": 5000,
            "queryType": 3,
            "pointLonlat": base_coords["location"]["lon"] + "," + base_coords["location"]["lat"],
            "start": 0,
            "count": 100,
        }

        result = requests.get(
            base_url + "?postStr=" + json.dumps(params, ensure_ascii=False) + "&type=query&tk=" + tk
        ).json()

        return self.create_json_message(result)
