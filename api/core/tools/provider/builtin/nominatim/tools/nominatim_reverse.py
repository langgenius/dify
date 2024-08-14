import json
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class NominatimReverseTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        lat = tool_parameters.get('lat')
        lon = tool_parameters.get('lon')
        
        if lat is None or lon is None:
            return self.create_text_message('Please provide both latitude and longitude')

        params = {
            'lat': lat,
            'lon': lon,
            'format': 'json',
            'addressdetails': 1
        }
        
        return self._make_request(user_id, 'reverse', params)

    def _make_request(self, user_id: str, endpoint: str, params: dict) -> ToolInvokeMessage:
        base_url = self.runtime.credentials.get('base_url', 'https://nominatim.openstreetmap.org')
        
        try:
            headers = {
                "User-Agent": "DifyNominatimTool/1.0"
            }
            s = requests.session()
            response = s.request(
                method='GET',
                headers=headers,
                url=f"{base_url}/{endpoint}",
                params=params
            )
            response_data = response.json()
            
            if response.status_code == 200:
                s.close()
                return self.create_text_message(self.summary(user_id=user_id, content=json.dumps(response_data, ensure_ascii=False)))
            else:
                return self.create_text_message(f"Error: {response.status_code} - {response.text}")
        except Exception as e:
            return self.create_text_message(f"An error occurred: {str(e)}")