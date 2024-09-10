import json
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GeocoderTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        base_url = "http://api.tianditu.gov.cn/geocoder"

        keyword = tool_parameters.get("keyword", "")
        if not keyword:
            return self.create_text_message("Invalid parameter keyword")

        tk = self.runtime.credentials["tianditu_api_key"]

        params = {
            "keyWord": keyword,
        }

        result = requests.get(base_url + "?ds=" + json.dumps(params, ensure_ascii=False) + "&tk=" + tk).json()

        return self.create_json_message(result)
